/**
 * Behavioral Feature Collector
 *
 * Captures the behavioral biometric vector B from live user interaction.
 * The spec defines B as the behavioral subspace of the composite feature
 * vector X = [H; B], where H is hardware signals and B is behavioral signals.
 *
 * For open-web deployments, the spec (Section 1.5.3) recommends treating H
 * as a "semi-deterministic coarse filter" and deriving primary identity from B.
 *
 * Features collected (spec Section 1.2-1.4):
 *   - Keystroke dynamics: flight time, dwell time, digraph latency
 *   - Mouse kinematics: velocity, acceleration, jerk, curvature
 *   - Scroll/touch dynamics: velocity, direction change frequency
 *
 * Zero state is stored. The collector runs in ephemeral memory and produces
 * a single feature vector when enough samples are gathered.
 */

// --- Types ---

export interface KeystrokeEvent {
  key: string;
  timestamp: number; // performance.now() ms
  type: 'down' | 'up';
}

export interface MouseEvent {
  x: number;
  y: number;
  timestamp: number;
}

export interface ScrollEvent {
  deltaY: number;
  timestamp: number;
}

export interface FeatureVector {
  /** The raw float64 behavioral feature values, length = FEATURE_DIM */
  values: Float64Array;
  /** Number of keystroke samples collected */
  keystrokeSamples: number;
  /** Number of mouse samples collected */
  mouseSamples: number;
  /** Number of scroll samples collected */
  scrollSamples: number;
  /** Whether enough data was collected for a reliable vector */
  sufficient: boolean;
}

// --- Constants ---

/** Behavioral feature vector dimensionality d_B */
export const FEATURE_DIM = 32;

/** Minimum samples before the vector is considered sufficient */
const MIN_KEYSTROKE_PAIRS = 15;
const MIN_MOUSE_POINTS = 30;
const MIN_SCROLL_EVENTS = 5;

// --- Feature indices ---
// Keystroke features (0-11)
const KS_FLIGHT_MEAN = 0;
const KS_FLIGHT_STD = 1;
const KS_DWELL_MEAN = 2;
const KS_DWELL_STD = 3;
const KS_FLIGHT_MEDIAN = 4;
const KS_DWELL_MEDIAN = 5;
const KS_DIGRAPH_MEAN = 6;
const KS_DIGRAPH_STD = 7;
const KS_FLIGHT_SKEW = 8;
const KS_DWELL_SKEW = 9;
const KS_RATE = 10;
const KS_PAUSE_RATIO = 11;

// Mouse features (12-23)
const MS_VEL_MEAN = 12;
const MS_VEL_STD = 13;
const MS_ACCEL_MEAN = 14;
const MS_ACCEL_STD = 15;
const MS_JERK_MEAN = 16;
const MS_JERK_STD = 17;
const MS_CURVATURE_MEAN = 18;
const MS_CURVATURE_STD = 19;
const MS_ANGLE_MEAN = 20;
const MS_ANGLE_STD = 21;
const MS_STRAIGHTNESS = 22;
const MS_CLICK_PRECISION = 23;

// Scroll features (24-29)
const SC_VEL_MEAN = 24;
const SC_VEL_STD = 25;
const SC_DIR_CHANGE_FREQ = 26;
const SC_INTERVAL_MEAN = 27;
const SC_INTERVAL_STD = 28;
const SC_BURST_RATIO = 29;

// Combined features (30-31)
const INTERACTION_ENTROPY = 30;
const CADENCE_REGULARITY = 31;

// --- Stats helpers ---

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  return sum / arr.length;
}

function std(arr: number[], mu?: number): number {
  if (arr.length < 2) return 0;
  const m = mu ?? mean(arr);
  let sumSq = 0;
  for (let i = 0; i < arr.length; i++) sumSq += (arr[i] - m) ** 2;
  return Math.sqrt(sumSq / (arr.length - 1));
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function skewness(arr: number[]): number {
  if (arr.length < 3) return 0;
  const m = mean(arr);
  const s = std(arr, m);
  if (s === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += ((arr[i] - m) / s) ** 3;
  return (sum * arr.length) / ((arr.length - 1) * (arr.length - 2));
}

/**
 * BehavioralCollector accumulates raw interaction events and computes
 * the d_B-dimensional behavioral feature vector B.
 *
 * Usage:
 *   const collector = new BehavioralCollector();
 *   // feed events as they happen...
 *   collector.addKeystroke({ key: 'a', timestamp: 100.5, type: 'down' });
 *   collector.addKeystroke({ key: 'a', timestamp: 150.2, type: 'up' });
 *   // ...
 *   const vector = collector.extract();
 *   if (vector.sufficient) { // proceed with SRP-LSH }
 */
export class BehavioralCollector {
  private keyDowns: Map<string, number> = new Map();
  private flightTimes: number[] = [];
  private dwellTimes: number[] = [];
  private digraphLatencies: number[] = [];
  private lastKeyUpTime: number = -1;
  private lastKeyUpKey: string = '';
  private keystrokeTimestamps: number[] = [];

  private mousePoints: MouseEvent[] = [];
  private scrollEvents: ScrollEvent[] = [];

  /** Feed a keystroke event. */
  addKeystroke(evt: KeystrokeEvent): void {
    if (evt.type === 'down') {
      this.keyDowns.set(evt.key, evt.timestamp);
      this.keystrokeTimestamps.push(evt.timestamp);

      // Flight time: time from previous key-up to this key-down
      if (this.lastKeyUpTime > 0) {
        const flight = evt.timestamp - this.lastKeyUpTime;
        if (flight > 0 && flight < 2000) {
          this.flightTimes.push(flight);
        }
      }

      // Digraph latency: time between consecutive key-downs of different keys
      if (this.lastKeyUpKey && this.lastKeyUpKey !== evt.key && this.lastKeyUpTime > 0) {
        const digraph = evt.timestamp - this.lastKeyUpTime;
        if (digraph > 0 && digraph < 2000) {
          this.digraphLatencies.push(digraph);
        }
      }
    } else if (evt.type === 'up') {
      const downTime = this.keyDowns.get(evt.key);
      if (downTime !== undefined) {
        const dwell = evt.timestamp - downTime;
        if (dwell > 0 && dwell < 1000) {
          this.dwellTimes.push(dwell);
        }
        this.keyDowns.delete(evt.key);
      }
      this.lastKeyUpTime = evt.timestamp;
      this.lastKeyUpKey = evt.key;
    }
  }

  /** Feed a mouse move event. */
  addMouseMove(evt: MouseEvent): void {
    this.mousePoints.push(evt);
  }

  /** Feed a scroll event. */
  addScroll(evt: ScrollEvent): void {
    this.scrollEvents.push(evt);
  }

  /** Reset all collected data. */
  reset(): void {
    this.keyDowns.clear();
    this.flightTimes = [];
    this.dwellTimes = [];
    this.digraphLatencies = [];
    this.lastKeyUpTime = -1;
    this.lastKeyUpKey = '';
    this.keystrokeTimestamps = [];
    this.mousePoints = [];
    this.scrollEvents = [];
  }

  /** Extract the behavioral feature vector B. */
  extract(): FeatureVector {
    const values = new Float64Array(FEATURE_DIM);

    // --- Keystroke features ---
    const flightMu = mean(this.flightTimes);
    const dwellMu = mean(this.dwellTimes);
    values[KS_FLIGHT_MEAN] = flightMu;
    values[KS_FLIGHT_STD] = std(this.flightTimes, flightMu);
    values[KS_DWELL_MEAN] = dwellMu;
    values[KS_DWELL_STD] = std(this.dwellTimes, dwellMu);
    values[KS_FLIGHT_MEDIAN] = median(this.flightTimes);
    values[KS_DWELL_MEDIAN] = median(this.dwellTimes);
    values[KS_DIGRAPH_MEAN] = mean(this.digraphLatencies);
    values[KS_DIGRAPH_STD] = std(this.digraphLatencies);
    values[KS_FLIGHT_SKEW] = skewness(this.flightTimes);
    values[KS_DWELL_SKEW] = skewness(this.dwellTimes);

    // Typing rate: keystrokes per second
    if (this.keystrokeTimestamps.length >= 2) {
      const span = this.keystrokeTimestamps[this.keystrokeTimestamps.length - 1] - this.keystrokeTimestamps[0];
      values[KS_RATE] = span > 0 ? (this.keystrokeTimestamps.length / (span / 1000)) : 0;
    }

    // Pause ratio: fraction of flight times > 500ms
    if (this.flightTimes.length > 0) {
      values[KS_PAUSE_RATIO] = this.flightTimes.filter(f => f > 500).length / this.flightTimes.length;
    }

    // --- Mouse features ---
    if (this.mousePoints.length >= 3) {
      const velocities: number[] = [];
      const accelerations: number[] = [];
      const jerks: number[] = [];
      const angles: number[] = [];
      const curvatures: number[] = [];
      let totalStraight = 0;
      let totalActual = 0;

      // Segment-level analysis
      let segStart = 0;
      for (let i = 1; i < this.mousePoints.length; i++) {
        const p0 = this.mousePoints[i - 1];
        const p1 = this.mousePoints[i];
        const dt = (p1.timestamp - p0.timestamp) / 1000; // seconds
        if (dt <= 0 || dt > 2) {
          // Gap — new segment
          if (i - segStart > 2) {
            const segStraight = Math.hypot(
              this.mousePoints[i - 1].x - this.mousePoints[segStart].x,
              this.mousePoints[i - 1].y - this.mousePoints[segStart].y
            );
            totalStraight += segStraight;
          }
          segStart = i;
          continue;
        }

        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        const dist = Math.hypot(dx, dy);
        const vel = dist / dt;
        velocities.push(vel);
        totalActual += dist;

        if (velocities.length >= 2) {
          const accel = (vel - velocities[velocities.length - 2]) / dt;
          accelerations.push(accel);

          if (accelerations.length >= 2) {
            const jerk = (accel - accelerations[accelerations.length - 2]) / dt;
            jerks.push(jerk);
          }
        }

        // Angle between consecutive segments
        if (i >= 2) {
          const p_2 = this.mousePoints[i - 2];
          const dt2 = (p0.timestamp - p_2.timestamp) / 1000;
          if (dt2 > 0 && dt2 < 2) {
            const dx0 = p0.x - p_2.x;
            const dy0 = p0.y - p_2.y;
            const dot = dx0 * dx + dy0 * dy;
            const cross = dx0 * dy - dy0 * dx;
            const angle = Math.atan2(cross, dot);
            angles.push(Math.abs(angle));

            // Curvature = |angle| / segment_length
            if (dist > 0) curvatures.push(Math.abs(angle) / dist);
          }
        }
      }

      // Handle last segment for straightness
      if (this.mousePoints.length - segStart > 2) {
        const segStraight = Math.hypot(
          this.mousePoints[this.mousePoints.length - 1].x - this.mousePoints[segStart].x,
          this.mousePoints[this.mousePoints.length - 1].y - this.mousePoints[segStart].y
        );
        totalStraight += segStraight;
      }

      const velMu = mean(velocities);
      values[MS_VEL_MEAN] = velMu;
      values[MS_VEL_STD] = std(velocities, velMu);
      const accelMu = mean(accelerations);
      values[MS_ACCEL_MEAN] = accelMu;
      values[MS_ACCEL_STD] = std(accelerations, accelMu);
      const jerkMu = mean(jerks);
      values[MS_JERK_MEAN] = jerkMu;
      values[MS_JERK_STD] = std(jerks, jerkMu);
      const curvMu = mean(curvatures);
      values[MS_CURVATURE_MEAN] = curvMu;
      values[MS_CURVATURE_STD] = std(curvatures, curvMu);
      const angleMu = mean(angles);
      values[MS_ANGLE_MEAN] = angleMu;
      values[MS_ANGLE_STD] = std(angles, angleMu);
      values[MS_STRAIGHTNESS] = totalActual > 0 ? totalStraight / totalActual : 1;
      // Click precision: average distance between consecutive clicks (lower = more precise)
      values[MS_CLICK_PRECISION] = velMu > 0 ? std(velocities, velMu) / velMu : 0; // coefficient of variation
    }

    // --- Scroll features ---
    if (this.scrollEvents.length >= 2) {
      const scrollVelocities: number[] = [];
      const scrollIntervals: number[] = [];
      let dirChanges = 0;
      let lastDir = 0;
      let burstCount = 0;

      for (let i = 1; i < this.scrollEvents.length; i++) {
        const dt = (this.scrollEvents[i].timestamp - this.scrollEvents[i - 1].timestamp) / 1000;
        if (dt <= 0 || dt > 5) continue;

        scrollIntervals.push(dt * 1000); // ms
        scrollVelocities.push(Math.abs(this.scrollEvents[i].deltaY) / dt);

        const dir = Math.sign(this.scrollEvents[i].deltaY);
        if (dir !== 0 && lastDir !== 0 && dir !== lastDir) dirChanges++;
        if (dir !== 0) lastDir = dir;

        if (dt < 0.05) burstCount++; // < 50ms between events = burst
      }

      const scrollVelMu = mean(scrollVelocities);
      values[SC_VEL_MEAN] = scrollVelMu;
      values[SC_VEL_STD] = std(scrollVelocities, scrollVelMu);
      const totalTime = (this.scrollEvents[this.scrollEvents.length - 1].timestamp - this.scrollEvents[0].timestamp) / 1000;
      values[SC_DIR_CHANGE_FREQ] = totalTime > 0 ? dirChanges / totalTime : 0;
      const intMu = mean(scrollIntervals);
      values[SC_INTERVAL_MEAN] = intMu;
      values[SC_INTERVAL_STD] = std(scrollIntervals, intMu);
      values[SC_BURST_RATIO] = scrollIntervals.length > 0 ? burstCount / scrollIntervals.length : 0;
    }

    // --- Combined features ---
    // Interaction entropy: distribution of event types
    const total = this.keystrokeTimestamps.length + this.mousePoints.length + this.scrollEvents.length;
    if (total > 0) {
      const pK = this.keystrokeTimestamps.length / total;
      const pM = this.mousePoints.length / total;
      const pS = this.scrollEvents.length / total;
      let entropy = 0;
      if (pK > 0) entropy -= pK * Math.log2(pK);
      if (pM > 0) entropy -= pM * Math.log2(pM);
      if (pS > 0) entropy -= pS * Math.log2(pS);
      values[INTERACTION_ENTROPY] = entropy;
    }

    // Cadence regularity: how consistent is the interval between any interaction events
    const allTimestamps = [
      ...this.keystrokeTimestamps,
      ...this.mousePoints.map(p => p.timestamp),
      ...this.scrollEvents.map(s => s.timestamp),
    ].sort((a, b) => a - b);

    if (allTimestamps.length >= 3) {
      const intervals: number[] = [];
      for (let i = 1; i < allTimestamps.length; i++) {
        const dt = allTimestamps[i] - allTimestamps[i - 1];
        if (dt > 0 && dt < 5000) intervals.push(dt);
      }
      const intMu = mean(intervals);
      const intStd = std(intervals, intMu);
      values[CADENCE_REGULARITY] = intMu > 0 ? 1 - Math.min(intStd / intMu, 1) : 0;
    }

    const sufficient =
      this.flightTimes.length >= MIN_KEYSTROKE_PAIRS &&
      this.mousePoints.length >= MIN_MOUSE_POINTS &&
      this.scrollEvents.length >= MIN_SCROLL_EVENTS;

    return {
      values,
      keystrokeSamples: this.flightTimes.length,
      mouseSamples: this.mousePoints.length,
      scrollSamples: this.scrollEvents.length,
      sufficient,
    };
  }
}
