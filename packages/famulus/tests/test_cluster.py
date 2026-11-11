"""Tests for the pure-stdlib k-means clustering module."""

from __future__ import annotations

from famulus.engine.cluster import (
    ClusterResult,
    choose_k,
    kmeans,
    silhouette_score,
    zscore_normalize,
)


# --- zscore_normalize ------------------------------------------------------

def test_zscore_empty():
    assert zscore_normalize([]) == []


def test_zscore_zero_variance_feature_does_not_divide_by_zero():
    # Second feature is constant -> std clamps to 1.0, normalized value 0.
    pts = [[1.0, 5.0], [3.0, 5.0]]
    out = zscore_normalize(pts)
    assert all(row[1] == 0.0 for row in out)


def test_zscore_mean_zero():
    pts = [[0.0], [10.0], [20.0]]
    out = zscore_normalize(pts)
    assert abs(sum(r[0] for r in out)) < 1e-9


# --- kmeans ----------------------------------------------------------------

def test_kmeans_empty():
    res = kmeans([], 3)
    assert isinstance(res, ClusterResult)
    assert res.labels == []


def test_kmeans_invalid_k():
    import pytest
    with pytest.raises(ValueError):
        kmeans([[1.0]], 0)


def test_kmeans_k_clamped_to_n():
    res = kmeans([[0.0], [1.0]], 5)
    assert res.k == 2


def test_kmeans_separates_two_obvious_groups():
    # Two tight, well-separated clusters along one axis.
    pts = [[0.0], [0.1], [0.2], [10.0], [10.1], [10.2]]
    res = kmeans(pts, 2, seed=0)
    # The first three share a label and the last three share the other label.
    assert len(set(res.labels[:3])) == 1
    assert len(set(res.labels[3:])) == 1
    assert res.labels[0] != res.labels[3]


def test_kmeans_deterministic_for_seed():
    pts = [[0.0], [0.1], [9.0], [9.1]]
    a = kmeans(pts, 2, seed=42)
    b = kmeans(pts, 2, seed=42)
    assert a.labels == b.labels
    assert a.inertia == b.inertia


# --- silhouette + choose_k -------------------------------------------------

def test_silhouette_single_cluster_is_zero():
    assert silhouette_score([[0.0], [1.0]], [0, 0]) == 0.0


def test_silhouette_high_for_well_separated():
    pts = [[0.0], [0.1], [10.0], [10.1]]
    score = silhouette_score(pts, [0, 0, 1, 1])
    assert score > 0.8


def test_choose_k_finds_two_clusters():
    pts = [[0.0], [0.2], [0.4], [9.0], [9.2], [9.4]]
    res = choose_k(pts, k_min=2, k_max=4, seed=0)
    assert res.k == 2


def test_choose_k_single_point():
    res = choose_k([[1.0]], k_min=2, k_max=4)
    assert res.k == 1
