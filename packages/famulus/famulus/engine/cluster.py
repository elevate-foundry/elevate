"""Pure-stdlib k-means for clustering model behavioral fingerprints.

No third-party deps (no numpy/sklearn) -- this keeps the engine offline-minimal
and dependency-light, consistent with the rest of famulus. The problem is tiny
(tens of models, a handful of features), so naive k-means is more than fast
enough and stays trivially auditable.

The clustering operates on behavioral feature vectors produced by
``famulus.engine.probe`` -- so two models land in the same cluster when they
*behave* alike (accuracy, refusal propensity, latency), not merely when their
declared metadata matches.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass


def _euclidean(a: list[float], b: list[float]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def zscore_normalize(points: list[list[float]]) -> list[list[float]]:
    """Standardize each feature to zero mean / unit variance.

    Essential because raw features live on wildly different scales (e.g. a
    latency of 6.0 seconds vs an accuracy of 0.83). Without normalization the
    large-magnitude feature would dominate the Euclidean distance.
    """
    if not points:
        return []
    dim = len(points[0])
    n = len(points)
    means = [0.0] * dim
    for p in points:
        for i in range(dim):
            means[i] += p[i]
    means = [m / n for m in means]
    stds = [0.0] * dim
    for p in points:
        for i in range(dim):
            stds[i] += (p[i] - means[i]) ** 2
    # A zero-variance feature would divide by zero; clamp its std to 1.0 so the
    # normalized value is simply 0 everywhere for that feature.
    stds = [math.sqrt(s / n) or 1.0 for s in stds]
    return [[(p[i] - means[i]) / stds[i] for i in range(dim)] for p in points]


def _plus_plus_init(points: list[list[float]], k: int, rng: random.Random) -> list[list[float]]:
    """k-means++ seeding: spread initial centroids out to avoid poor local minima."""
    centroids = [list(points[rng.randrange(len(points))])]
    while len(centroids) < k:
        d2 = [min(_euclidean(p, c) ** 2 for c in centroids) for p in points]
        total = sum(d2)
        if total == 0:
            centroids.append(list(points[rng.randrange(len(points))]))
            continue
        r = rng.random() * total
        acc = 0.0
        for p, d in zip(points, d2):
            acc += d
            if acc >= r:
                centroids.append(list(p))
                break
    return centroids


@dataclass
class ClusterResult:
    """Outcome of a k-means run."""
    labels: list[int]
    centroids: list[list[float]]
    k: int
    inertia: float


def kmeans(points: list[list[float]], k: int, max_iter: int = 100, seed: int = 0) -> ClusterResult:
    """Cluster ``points`` into (at most) ``k`` groups via Lloyd's algorithm.

    Deterministic for a fixed ``seed``. ``k`` is clamped to ``len(points)``.
    """
    if k <= 0:
        raise ValueError("k must be >= 1")
    n = len(points)
    if n == 0:
        return ClusterResult(labels=[], centroids=[], k=k, inertia=0.0)
    k = min(k, n)
    rng = random.Random(seed)
    centroids = _plus_plus_init(points, k, rng)
    labels = [0] * n

    for _ in range(max_iter):
        changed = False
        for idx, p in enumerate(points):
            best, best_d = 0, float("inf")
            for ci, c in enumerate(centroids):
                d = _euclidean(p, c)
                if d < best_d:
                    best_d, best = d, ci
            if labels[idx] != best:
                labels[idx] = best
                changed = True

        new_centroids: list[list[float]] = []
        for ci in range(k):
            members = [points[i] for i in range(n) if labels[i] == ci]
            if not members:
                # Keep the old centroid for an emptied cluster (rare with ++ init).
                new_centroids.append(centroids[ci])
                continue
            dim = len(members[0])
            new_centroids.append([sum(m[d] for m in members) / len(members) for d in range(dim)])
        centroids = new_centroids

        if not changed:
            break

    inertia = sum(_euclidean(points[i], centroids[labels[i]]) ** 2 for i in range(n))
    return ClusterResult(labels=labels, centroids=centroids, k=k, inertia=inertia)


def silhouette_score(points: list[list[float]], labels: list[int]) -> float:
    """Mean silhouette coefficient in [-1, 1]; higher means better-separated clusters."""
    n = len(points)
    if n <= 1:
        return 0.0
    clusters: dict[int, list[int]] = {}
    for i, lab in enumerate(labels):
        clusters.setdefault(lab, []).append(i)
    if len(clusters) <= 1:
        return 0.0

    total = 0.0
    for i in range(n):
        same = clusters[labels[i]]
        if len(same) > 1:
            a = sum(_euclidean(points[i], points[j]) for j in same if j != i) / (len(same) - 1)
        else:
            a = 0.0
        b = float("inf")
        for lab, members in clusters.items():
            if lab == labels[i]:
                continue
            mean_d = sum(_euclidean(points[i], points[j]) for j in members) / len(members)
            b = min(b, mean_d)
        denom = max(a, b)
        total += 0.0 if denom == 0 else (b - a) / denom
    return total / n


def choose_k(points: list[list[float]], k_min: int = 2, k_max: int = 6, seed: int = 0) -> ClusterResult:
    """Pick the k (in [k_min, k_max]) maximizing the silhouette score.

    Falls back to a single cluster when there are fewer than 2 points.
    """
    n = len(points)
    if n < 2:
        return kmeans(points, 1, seed=seed)
    best: tuple[float, ClusterResult] | None = None
    upper = min(k_max, n)
    for k in range(max(2, k_min), upper + 1):
        res = kmeans(points, k, seed=seed)
        score = silhouette_score(points, res.labels)
        if best is None or score > best[0]:
            best = (score, res)
    return best[1] if best else kmeans(points, 1, seed=seed)
