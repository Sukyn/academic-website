export const TUTORIAL_INTRO = 'Circuit equations preserve the operation. The goal is the identity: empty wires that leave every input unchanged.';

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
  { text: 'X is self-inverse: two consecutive X gates equal the identity and can be removed.',
    move: { rule: 'cancel-x', row: 0, column: 0 } },
  { text: 'H is self-inverse too, so the selected pair cancels.',
    move: { rule: 'cancel-h', row: 0, column: 2 } },
  { text: 'Hadamard conjugation changes Z into X: H–Z–H = X. The equation also works in reverse.',
    move: { rule: 'basis-x', row: 0, column: 4 } },
  { text: 'The adjacent X gates cancel.',
    layout: [['X', 'X', ...PAPER_CIRCUIT[0]], ['.', '.', ...PAPER_CIRCUIT[1]]],
    move: { rule: 'cancel-x', row: 0, column: 0 } },
  { text: 'The controlled form of H–Z–H = X expands CNOT into H–CZ–H, with H on the target wire.',
    layout: PAPER_CIRCUIT,
    move: { rule: 'basis-up', row: 0, column: 1 } },
  { text: 'An identity column adds space between X and CNOT. Adding or removing empty columns costs no moves.',
    target: '[data-space="0:5"]',
    layout: [['X', 'H', 'ZU', 'H', 'X', 'XU', '.'], ['.', '.', 'ZD', '.', '.', 'ZD', '.']],
    move: { rule: 'insert-column', row: 0, column: 5 } },
  { text: 'The second CNOT expands by the same controlled conjugation equation.',
    move: { rule: 'basis-up', row: 0, column: 5 } },
  { text: 'Hadamard conjugation also gives H–X–H = Z.',
    move: { rule: 'basis-z', row: 0, column: 3 } },
  { text: 'Z and CZ commute: exchanging their order preserves the circuit.',
    layout: [['X', 'H', 'ZU', 'Z', 'ZU', '.', 'H'], ['.', '.', 'ZD', '.', 'ZD', '.', '.']],
    move: { rule: 'phase-up', row: 0, column: 3 } },
  { text: 'CZ is self-inverse, so the two consecutive CZ gates cancel.',
    layout: [['X', 'H', 'ZU', 'ZU', 'Z', 'H'], ['.', '.', 'ZD', 'ZD', '.', '.']],
    move: { rule: 'cancel-cz', row: 0, column: 2 } },
  { text: 'The remaining H–Z–H block simplifies to X.',
    layout: [['X', 'H', 'Z', 'H'], ['.', '.', '.', '.']],
    move: { rule: 'basis-x', row: 0, column: 1 } },
  { text: 'Tidy removes empty columns, bringing the two X gates together.',
    target: '#compact-identities',
    move: { rule: 'compact-identities', row: 0, column: 0 } },
  { text: 'The last X pair cancels. The empty circuit is the identity.',
    move: { rule: 'cancel-x', row: 0, column: 0 } },
];
