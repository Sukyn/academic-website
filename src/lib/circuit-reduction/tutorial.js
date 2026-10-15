// Worked solution of paper mission 12 (campaign lesson 17), with free gaps aligned.
export const TUTORIAL_CIRCUIT = [
  ['X', '.', 'XU', '.', 'X', 'XU'],
  ['.', '.', 'ZD', '.', '.', 'ZD'],
];

export const TUTORIAL_STEPS = [
  { text: 'Expand the CNOT into H–CZ–H, with both H gates on the target wire.',
    move: { rule: 'basis-up', row: 0, column: 1 } },
  { text: 'Expand the second CNOT. Empty slots are aligned for you; spacing costs no moves.',
    layout: [['X', 'H', 'ZU', 'H', 'X', '.', 'XU', '.'], ['.', '.', 'ZD', '.', '.', '.', 'ZD', '.']],
    move: { rule: 'basis-up', row: 0, column: 5 } },
  { text: 'Replace H–X–H with Z.',
    move: { rule: 'basis-z', row: 0, column: 3 } },
  { text: 'Move Z past CZ; they commute. This brings the two CZ gates together.',
    layout: [['X', 'H', 'ZU', 'Z', 'ZU', '.', 'H'], ['.', '.', 'ZD', '.', 'ZD', '.', '.']],
    move: { rule: 'phase-up', row: 0, column: 3 } },
  { text: 'Cancel the two CZ gates: applying CZ twice changes nothing.',
    layout: [['X', 'H', 'ZU', 'ZU', 'Z', 'H'], ['.', '.', 'ZD', 'ZD', '.', '.']],
    move: { rule: 'cancel-cz', row: 0, column: 2 } },
  { text: 'Replace H–Z–H with X.',
    layout: [['X', 'H', 'Z', 'H'], ['.', '.', '.', '.']],
    move: { rule: 'basis-x', row: 0, column: 1 } },
  { text: 'Cancel the two X gates. Empty wires are the identity: every input stays unchanged.',
    layout: [['X', 'X'], ['.', '.']],
    move: { rule: 'cancel-x', row: 0, column: 0 } },
];
