export interface Vector2 {
  x: number;
  y: number;
}

export interface OrderParticle extends Vector2 {
  vx: number;
  vy: number;
}

export interface CollectiveOrder {
  cohesion: number;
  polarization: number;
  motionEntropy: number;
  clusters: number;
  meanSpeed: number;
}

export function nearestFieldPoint(origin: Vector2, points: readonly Vector2[]): Vector2 {
  let nearest = points[0] ?? origin;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    const distance = dx * dx + dy * dy;
    if (distance < nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/** Sample a contour field without permanently assigning a particle to one point. */
export function contourField(
  origin: Vector2,
  points: readonly Vector2[],
  probe: Vector2,
  distribution: number,
  strength: number,
): Vector2 {
  const nearest = nearestFieldPoint(origin, points);
  const blend = Math.max(0, Math.min(1, distribution));
  const targetX = nearest.x * (1 - blend) + probe.x * blend;
  const targetY = nearest.y * (1 - blend) + probe.y * blend;
  return { x: (targetX - origin.x) * strength, y: (targetY - origin.y) * strength };
}

/** Divergence-free seeded current derived from the curl of a scalar field. */
export function curlField(origin: Vector2, time: number, phase: number, strength: number): Vector2 {
  const fieldTime = time * 0.11 + phase;
  const coupled = origin.x * 0.17 + origin.y * 0.19 - fieldTime * 0.7;
  const dPsiDx = 0.23 * Math.cos(origin.x * 0.23 + fieldTime)
    + 0.17 * Math.cos(coupled) * 0.17;
  const dPsiDy = -0.27 * Math.sin(origin.y * 0.27 - fieldTime * 0.83)
    + 0.17 * Math.cos(coupled) * 0.19;
  return { x: dPsiDy * strength, y: -dPsiDx * strength };
}

/** A rotating pressure wave suitable for one voice or one external signal. */
export function vortexField(
  origin: Vector2,
  center: Vector2,
  phase: number,
  strength: number,
): Vector2 {
  const dx = origin.x - center.x;
  const dy = origin.y - center.y;
  const distance = Math.hypot(dx, dy) || 1;
  const wave = Math.sin(distance * 1.35 - phase);
  return {
    x: strength * (-dy / distance * 0.11 + dx / distance * wave * 0.055),
    y: strength * (dx / distance * 0.11 + dy / distance * wave * 0.055),
  };
}

export function measureCollectiveOrder(particles: readonly OrderParticle[], clusterRadius = 0.12): CollectiveOrder {
  if (particles.length === 0) {
    return { cohesion: 0, polarization: 0, motionEntropy: 0, clusters: 0, meanSpeed: 0 };
  }

  const center = particles.reduce((total, particle) => ({
    x: total.x + particle.x,
    y: total.y + particle.y,
  }), { x: 0, y: 0 });
  center.x /= particles.length;
  center.y /= particles.length;

  let meanDistance = 0;
  let directionX = 0;
  let directionY = 0;
  let speedTotal = 0;
  const directionBins = Array<number>(8).fill(0);
  for (const particle of particles) {
    meanDistance += Math.hypot(particle.x - center.x, particle.y - center.y);
    const speed = Math.hypot(particle.vx, particle.vy);
    speedTotal += speed;
    if (speed > 0.00001) {
      directionX += particle.vx / speed;
      directionY += particle.vy / speed;
      const angle = (Math.atan2(particle.vy, particle.vx) + Math.PI * 2) % (Math.PI * 2);
      directionBins[Math.min(7, Math.floor(angle / (Math.PI * 2) * 8))]++;
    }
  }
  meanDistance /= particles.length;
  const cohesion = Math.max(0, Math.min(1, 1 - meanDistance / Math.SQRT1_2));
  const polarization = Math.min(1, Math.hypot(directionX, directionY) / particles.length);
  const meanSpeed = speedTotal / particles.length;
  let entropy = 0;
  for (const count of directionBins) {
    if (count === 0) continue;
    const probability = count / particles.length;
    entropy -= probability * Math.log2(probability);
  }
  const motionEntropy = Math.min(1, entropy / 3);

  const visited = new Set<number>();
  let clusters = 0;
  const radiusSquared = clusterRadius * clusterRadius;
  for (let start = 0; start < particles.length; start++) {
    if (visited.has(start)) continue;
    clusters++;
    const queue = [start];
    visited.add(start);
    while (queue.length) {
      const currentIndex = queue.pop()!;
      const current = particles[currentIndex];
      for (let candidate = 0; candidate < particles.length; candidate++) {
        if (visited.has(candidate)) continue;
        const other = particles[candidate];
        const dx = current.x - other.x;
        const dy = current.y - other.y;
        if (dx * dx + dy * dy <= radiusSquared) {
          visited.add(candidate);
          queue.push(candidate);
        }
      }
    }
  }

  return { cohesion, polarization, motionEntropy, clusters, meanSpeed };
}
