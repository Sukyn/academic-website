// Committed witnesses use readable wire strings and [rule, row, column] moves.
// Arrangement moves need only ["arrange", wireString]; their coordinates are 0.
export const encodeCircuit = circuit => circuit.map(row => row.join(' ')).join(' / ');
export const decodeCircuit = text => text.split(' / ').map(row => row.split(' '));
export const encodeSequence = sequence => sequence.map(move => move.rule === 'arrange'
  ? ['arrange', encodeCircuit(move.circuit)] : [move.rule, move.row, move.column]);
export const decodeSequence = sequence => sequence.map(([rule, row, column]) => rule === 'arrange'
  ? { rule, row: 0, column: 0, circuit: decodeCircuit(row) } : { rule, row, column });
