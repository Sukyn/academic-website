import { applyGate, validatePlacements, validatePuzzle } from './engine.js';

const EPSILON = 1e-9;

// Edges carry signed amplitude contributions, not probabilities. They must be
// added at their destination before the next column so interference is visible.
export function flowTrace(input, placements = {}) {
  const puzzle = validatePuzzle(input), chosen = validatePlacements(puzzle, placements);
  const size = 2 ** puzzle.wires;
  const snapshots = [[1, ...Array(size - 1).fill(0)]], columns = [], cancellations = [];
  for (const column of puzzle.columns) {
    const incoming = snapshots.at(-1), outgoing = Array(size).fill(0), phases = Array(size).fill(0), edges = [];
    for (let from = 0; from < size; from++) {
      if (Math.abs(incoming[from]) < EPSILON) continue;
      const contribution = Array(size).fill(0);
      contribution[from] = incoming[from];
      for (const entry of column) {
        const gate = entry.gate ?? (Object.hasOwn(chosen, entry.id) ? chosen[entry.id] : 'I');
        applyGate(contribution, gate, entry.wires, puzzle.wires);
      }
      for (let to = 0; to < size; to++) {
        const amplitude = contribution[to];
        if (Math.abs(amplitude) < EPSILON) continue;
        edges.push({ from, to, amplitude });
        outgoing[to] += amplitude;
        phases[to] |= amplitude > 0 ? 1 : 2; // Positive, negative, or both (3).
      }
    }
    columns.push(edges);
    cancellations.push(phases.flatMap((phase, basis) =>
      phase === 3 && Math.abs(outgoing[basis]) < EPSILON ? [basis] : []));
    snapshots.push(outgoing);
  }
  return { snapshots, columns, cancellations };
}
