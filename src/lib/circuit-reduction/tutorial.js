// Basic cancellations and a basis change, then paper mission 12 (campaign lesson 17).
// Layout actions are free.
const PAPER_CIRCUIT = [
  ['X', '.', 'XU', '.', 'X', 'XU'],
  ['.', '.', 'ZD', '.', '.', 'ZD'],
];

export const TUTORIAL_CIRCUIT = [
  ['X', 'X', 'H', 'H', 'H', 'Z', 'H', 'X', ...PAPER_CIRCUIT[0]],
  ['.', '.', '.', '.', '.', '.', '.', '.', ...PAPER_CIRCUIT[1]],
];

export const TUTORIAL_STEPS = [
  { text: 'Two neighbouring X gates cancel. Choose the rule that replaces them with empty wire.',
    move: { rule: 'cancel-x', row: 0, column: 0 } },
  { text: 'Two neighbouring H gates cancel too. Match the selected pair to its rule.',
    move: { rule: 'cancel-h', row: 0, column: 2 } },
  { text: 'Replace H–Z–H with X. Rules work in either direction.',
    move: { rule: 'basis-x', row: 0, column: 4 } },
  { text: 'Cancel the two X gates.',
    layout: [['X', 'X', ...PAPER_CIRCUIT[0]], ['.', '.', ...PAPER_CIRCUIT[1]]],
    move: { rule: 'cancel-x', row: 0, column: 0 } },
  { text: 'Some rules have a controlled version. Expand CNOT into H–CZ–H.',
    layout: PAPER_CIRCUIT,
    move: { rule: 'basis-up', row: 0, column: 1 } },
  { text: 'Add space between X and CNOT. Empty slots cost no moves.',
    target: '[data-space="0:5"]',
    layout: [['X', 'H', 'ZU', 'H', 'X', 'XU', '.'], ['.', '.', 'ZD', '.', '.', 'ZD', '.']],
    move: { rule: 'insert-column', row: 0, column: 5 } },
  { text: 'Expand the second CNOT into H–CZ–H.',
    move: { rule: 'basis-up', row: 0, column: 5 } },
  { text: 'Replace H–X–H with Z.',
    move: { rule: 'basis-z', row: 0, column: 3 } },
  { text: 'Move Z past CZ; they commute.',
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
