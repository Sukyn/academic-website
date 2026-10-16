// Worked solution of paper mission 12 (campaign lesson 17). Layout actions are free.
export const TUTORIAL_CIRCUIT = [
  ['X', '.', 'XU', '.', 'X', 'XU'],
  ['.', '.', 'ZD', '.', '.', 'ZD'],
];

export const TUTORIAL_STEPS = [
  { text: 'Expand the CNOT into H–CZ–H, with both H gates on the target wire.',
    move: { rule: 'basis-up', row: 0, column: 1 } },
  { text: 'Add space between X and CNOT. Empty slots cost no moves.',
    target: '[data-space="0:5"]',
    layout: [['X', 'H', 'ZU', 'H', 'X', 'XU', '.'], ['.', '.', 'ZD', '.', '.', 'ZD', '.']],
    move: { rule: 'insert-column', row: 0, column: 5 } },
  { text: 'Expand the second CNOT into H–CZ–H.',
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
  { text: 'Use Tidy to remove empty slots and bring the two X gates together.',
    target: '#compact-identities',
    move: { rule: 'compact-identities', row: 0, column: 0 } },
  { text: 'Cancel the two X gates. Empty wires are the identity: every input stays unchanged.',
    move: { rule: 'cancel-x', row: 0, column: 0 } },
];
