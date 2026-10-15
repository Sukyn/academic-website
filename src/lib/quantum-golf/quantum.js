// Bloch vectors use [sinθ cosφ, sinθ sinφ, cosθ]. Global phase is irrelevant.
export const START_STATE = Object.freeze([1, 0, 0]);
const ROOT_HALF = Math.SQRT1_2;

export function normalize(vector) {
  if (!vector || vector.length !== 3 || !vector.every(Number.isFinite)) {
    throw new TypeError('Expected a finite three-dimensional vector.');
  }
  const length = Math.hypot(...vector);
  if (!Number.isFinite(length) || length === 0) throw new RangeError('Use a finite, nonzero vector length.');
  return vector.map((value) => value / length);
}

// H swaps x/z and reverses y. T rotates x/y by +π/4.
export function applyGate(state, gate) {
  const [x, y, z] = normalize(state);
  if (gate === 'H') return [z, -y, x];
  if (gate === 'T') return normalize([(x - y) * ROOT_HALF, (x + y) * ROOT_HALF, z]);
  throw new RangeError('Choose H or T.');
}

// Prepare the physical rotation once: H about (x+z)/√2, T about z.
export function gateRotation(state, gate) {
  if (gate !== 'H' && gate !== 'T') throw new RangeError('Choose H or T.');
  const point = normalize(state);
  const [x, y, z] = point;
  const angle = gate === 'H' ? Math.PI : Math.PI / 4;
  const middle = (x + z) / 2, difference = (x - z) / 2;
  return t => {
    if (!Number.isFinite(t) || t < 0 || t > 1) {
      throw new RangeError('Gate progress must be between 0 and 1.');
    }
    if (t === 0) return point;
    if (t === 1) return applyGate(state, gate);
    const cosine = Math.cos(angle * t), sine = Math.sin(angle * t);
    if (gate === 'T') return [x * cosine - y * sine, x * sine + y * cosine, z];
    return [
      middle + difference * cosine - y * ROOT_HALF * sine,
      y * cosine + (x - z) * ROOT_HALF * sine,
      middle - difference * cosine + y * ROOT_HALF * sine,
    ];
  };
}

export function gateTrajectory(state, gate, steps = 80) {
  if (!Number.isInteger(steps) || steps < 1) throw new RangeError('Trajectory steps must be a positive integer.');
  const rotate = gateRotation(state, gate);
  return Array.from({ length: steps + 1 }, (_, i) => rotate(i / steps));
}

// Pure-qubit trace distance is half the Bloch chord, stable near identical states.
export function traceDistance(a, b) {
  const first = normalize(a), second = normalize(b);
  return Math.min(1, Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]) / 2);
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function checkEpsilon(epsilon) {
  if (!Number.isFinite(epsilon) || epsilon < 0 || epsilon > 1) {
    throw new RangeError('Epsilon must be between 0 and 1.');
  }
}

// The winning hole has angular radius 2 asin(ε).
export function targetCap(target, epsilon, steps = 96) {
  checkEpsilon(epsilon);
  if (!Number.isInteger(steps) || steps < 1) throw new RangeError('Cap steps must be a positive integer.');
  const normal = normalize(target);
  const reference = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const tangent = normalize(cross(reference, normal)), bitangent = cross(normal, tangent);
  const angle = 2 * Math.asin(epsilon), cosine = Math.cos(angle), sine = Math.sin(angle);
  const points = Array.from({ length: steps }, (_, i) => {
    const azimuth = 2 * Math.PI * i / steps;
    const cosAzimuth = Math.cos(azimuth), sinAzimuth = Math.sin(azimuth);
    return normal.map((value, j) => value * cosine + sine * (
      cosAzimuth * tangent[j] + sinAzimuth * bitangent[j]
    ));
  });
  points.push([...points[0]]);
  return points;
}

// Uniform sphere area is uniform in x. Exclude the initial |+⟩ winning cap.
export function randomTarget(epsilon, random = Math.random) {
  checkEpsilon(epsilon);
  if (epsilon === 1) throw new RangeError('No target lies outside a hole of size 1.');
  const x = -1 + 2 * (1 - epsilon * epsilon) * random();
  const azimuth = 2 * Math.PI * random();
  const radius = Math.sqrt(Math.max(0, 1 - x * x));
  return [x, radius * Math.cos(azimuth), radius * Math.sin(azimuth)];
}
