import { normalize } from './quantum.js';

// Minimize total H + T button presses, from |0>, for a state target.
// Increasing-depth exhaustive search needs no approximate state deduplication.
// Every shortest word starts with H and excludes HH and T^8: removing any
// of these preserves the state and strictly shortens the word.
export function solveShortest(target, epsilon, { maxDepth = 28, maxNodes = 800000 } = {}) {
  target = normalize(target);
  if (!Number.isFinite(epsilon) || epsilon <= 0 || epsilon > 1) {
    throw new RangeError('Epsilon must be greater than 0 and at most 1.');
  }
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 40 ||
      !Number.isInteger(maxNodes) || maxNodes < 1) {
    throw new RangeError('Choose a depth from 0 to 40 and a positive node budget.');
  }
  let visited = 0, checkedDepth = -1, earliestBoundary = Infinity, stopped = false;
  let sequence = null;
  const word = [];
  const distance = (x, y, z) => {
    const norm = Math.hypot(x, y, z);
    return Math.hypot(x / norm - target[0], y / norm - target[1], z / norm - target[2]) / 2;
  };
  const result = (status, depth = null) => ({
    status, optimalMoves: status === 'optimal' ? depth : null,
    sequence, checkedDepth, visited,
  });
  // Uncertain points on the hole boundary must not certify a shorter failure.
  const test = (x, y, z, depth) => {
    const d = distance(x, y, z);
    if (Math.abs(d - epsilon) <= 1e-12) {
      earliestBoundary = Math.min(earliestBoundary, depth);
    }
    if (d < epsilon - 1e-12) {
      sequence = word.join('');
      return true;
    }
    return false;
  };
  function visit(x, y, z, remaining, tRun, depth) {
    if (visited >= maxNodes) { stopped = true; return false; }
    visited++;
    if (remaining === 0) return test(x, y, z, depth);
    if (tRun > 0) {
      word.push('H');
      if (visit(z, -y, x, remaining - 1, 0, depth)) return true;
      word.pop();
    }
    if (!stopped && tRun < 7) {
      word.push('T');
      if (visit((x - y) * Math.SQRT1_2, (x + y) * Math.SQRT1_2,
        z, remaining - 1, tRun + 1, depth)) return true;
      word.pop();
    }
    return false;
  }
  for (let depth = 0; depth <= maxDepth; depth++) {
    word.length = 0;
    if (depth === 0) {
      visited++;
      if (test(0, 0, 1, 0)) return result('optimal', 0);
    } else {
      word.push('H');
      if (visit(1, 0, 0, depth - 1, 0, depth)) {
        return result(earliestBoundary < depth ? 'boundary' : 'optimal', depth);
      }
    }
    if (stopped) break;
    checkedDepth = depth;
  }
  return result(earliestBoundary <= checkedDepth ? 'boundary' : 'limit');
}
