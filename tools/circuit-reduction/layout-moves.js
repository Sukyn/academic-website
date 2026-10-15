// Browser/controller tests must build witness layouts through the same public
// spacing controls as players: global insertion and individual gap removal.
import { applyMove, circuitKey, compactCircuit } from '../../src/lib/circuit-reduction/engine.js';

const positions = circuit => circuit.map(wire => wire.flatMap((symbol, column) => symbol === '.' ? [] : [column]));

export function layoutMoves(from, target) {
  // Besides validating the input, this checks that gate order and links agree.
  applyMove(from, { rule: 'arrange', row: 0, column: 0, circuit: target });
  if (circuitKey(from) === circuitKey(target)) return [];
  const desired = positions(target), moves = [];
  let current = from;
  const apply = move => { current = applyMove(current, move); moves.push(move); };
  const compact = compactCircuit(current);
  if (circuitKey(current) !== circuitKey(compact)) apply({ rule: 'compact-identities', row: 0, column: 0 });
  const initial = positions(current);
  const padding = Math.max(0, ...desired.flatMap((wire, row) => wire.map((column, index) => column - initial[row][index])));
  if (padding) apply({ rule: 'insert-column', row: 0, column: 0, count: padding });

  while (true) {
    const actual = positions(current);
    let next;
    for (let row = 0; row < actual.length; row++) for (let index = 0; index < actual[row].length; index++) {
      const column = actual[row][index], goal = desired[row][index];
      if (column < goal) throw new Error('Spacing planner moved a gate before its target.');
      if (column > goal && (!next || goal < next.goal)) next = { row, index, column, goal };
    }
    if (!next) break;
    const { row, index, column } = next;
    // A later gate already at its target needs one spare slot before pulling
    // this wire. Global insertion keeps linked endpoints together. A forced
    // predecessor shift cannot cross its target without violating wire order.
    const fixed = actual[row].findIndex((position, i) => i > index && position === desired[row][i]);
    if (fixed >= 0) apply({ rule: 'insert-column', row: 0, column: actual[row][fixed] });
    apply({ rule: 'remove-space', row, column: column - 1 });
  }

  while (current[0].length > target[0].length) apply({ rule: 'remove-space', row: 0, column: current[0].length - 1 });
  if (current[0].length < target[0].length) apply({ rule: 'insert-column', row: 0, column: current[0].length, count: target[0].length - current[0].length });
  if (circuitKey(current) !== circuitKey(target)) throw new Error('Spacing planner did not reproduce the target layout.');
  return moves;
}
