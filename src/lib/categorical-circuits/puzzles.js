import { seededRandom } from '../games/random.js';
import { stateEqual as signalsStateEqual } from '../quantum-signals/engine.js';
import { validateCircuit, validateOperation, holeOperation, simulate, applyOperation, applyMove, isSolved, MAX_COLUMNS, MAX_OPERATIONS } from './engine.js';

const op = (gate, wires, controls = []) => ({ gate, wires, ...(controls.length ? { controls } : {}) });
const move = (rule, column, wires, controls = []) => ({ rule, column, wires, ...(controls.length ? { controls } : {}) });
const tidyMove = () => ({ rule: 'tidy' });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const profileCheck = profile => { if (profile !== 'prop' && profile !== 'controlled') throw new RangeError('Choose PROP or controlled PROP.'); };

function naturality(name = 'H', controls = [], targets = [0, 1], wires = 2) {
  const [first, second] = targets, swap = op('SWAP', targets, controls);
  return { circuit: { wires, columns: [[swap], [op(name, [first], controls)], [swap], [op(name, [second], controls)]] },
    solution: [move('swap-' + name.toLowerCase(), 0, targets, controls), move('cancel-swap', 1, targets, controls),
      tidyMove(), move('cancel-' + name.toLowerCase(), 0, [second], controls), tidyMove()] };
}

function braid(targets = [0, 1, 2], controls = [], wires = 3) {
  const [a, b, c] = targets, swap = (first, second) => [op('SWAP', [first, second], controls)];
  return { circuit: { wires, columns: [swap(a, b), swap(b, c), swap(a, b), swap(b, c), swap(a, b), swap(b, c)] },
    solution: [move('swap-braid', 0, targets, controls), move('cancel-swap', 2, [b, c], controls), tidyMove(),
      move('cancel-swap', 1, [a, b], controls), tidyMove(), move('cancel-swap', 0, [b, c], controls), tidyMove()] };
}

function basis(controls = [], wire = 0, wires = 1) {
  return { circuit: { wires, columns: ['H', 'Z', 'H', 'X'].map(name => [op(name, [wire], controls)]) },
    solution: [move('basis-x', 0, [wire], controls), tidyMove(), move('cancel-x', 0, [wire], controls), tidyMove()] };
}

function cancel(name, targets, controls, wires) {
  return { circuit: { wires, columns: [[op(name, targets, controls)], [op(name, targets, controls)]] },
    solution: [move('cancel-' + name.toLowerCase(), 0, targets, controls), tidyMove()] };
}

const simplificationLevels = profile => [
  ['Cross twice', cancel('SWAP', [0, 1], [], 2)],
  ['Carry the square', naturality()],
  ['Three crossings', braid()],
  ['Change the target basis', {
    circuit: { wires: 2, columns: [[op('H', [1])], [op('Z', [1], [0])], [op('H', [1])], [op('X', [1], [0])]] },
    solution: [move('controlled-basis', 0, [0, 1]), tidyMove(), move('cancel-x', 0, [1], [0]), tidyMove()],
  }],
  ...(profile === 'controlled' ? [
    ['Control the square', cancel('H', [1], [0], 2)],
    ['Lift a basis change', basis([0], 1, 2)],
    ['Two controls', cancel('X', [2], [0, 1], 3)],
    ['Controlled crossing', naturality('H', [0], [1, 2], 3)],
    ['Controlled braid', braid([1, 2, 3], [0], 4)],
  ] : [
    ['Carry the phase', naturality('Z')],
    ['Carry the flip', naturality('X')],
  ]),
];

function signalPuzzle(wires, columns, holes, solution, profile = 'controlled') {
  const initial = { wires, columns, holes, target: [1, ...Array(2 ** wires - 1).fill(0)] };
  return { ...initial, target: simulate(fillSignals(initial, solution, profile), undefined, profile), solution };
}
const hole = (wires, choices, controls = []) => ({ wires, choices, ...(controls.length ? { controls } : {}) });
const single = (wire, controls = []) => hole([wire], ['I', 'H', 'X', 'Z'], controls);
const crossing = (first, second, controls = []) => hole([first, second], ['I', 'SWAP'], controls);
const paired = (first, second) => hole([first, second], ['I', 'CX', 'XC', 'CZ',
  ...(Math.abs(first - second) === 1 ? ['SWAP'] : [])]);

function signalLevels(profile) {
  const puzzle = (...args) => signalPuzzle(...args, profile);
  return [
    ['Move the excitation', puzzle(2, [[op('X', [0])]], [crossing(0, 1)], ['SWAP'])],
    ['Move a superposition', puzzle(2, [[op('H', [0])]], [crossing(0, 1), single(0)], ['SWAP', 'X'])],
    ['Move a correlation', puzzle(3, [[op('H', [0])], [op('X', [1], [0])]],
      [crossing(1, 2), single(0)], ['SWAP', 'Z'])],
    ['Return to one path', puzzle(3, [[op('H', [0])], [op('X', [1], [0])], [op('SWAP', [1, 2])]],
      [crossing(1, 2), profile === 'prop' ? paired(0, 1) : single(1, [0]), single(0)],
      ['SWAP', profile === 'prop' ? 'CX' : 'X', 'H'])],
    ...(profile === 'controlled' ? [
      ['Unequal branches', puzzle(2, [[op('H', [0])]], [single(1, [0])], ['H'])],
      ['Two control bits', puzzle(3, [[op('H', [0]), op('H', [1])]], [single(2, [0, 1])], ['X'])],
      ['Choose which crossing', puzzle(3, [[op('H', [0])], [op('X', [1])]], [crossing(1, 2, [0]), single(2)], ['SWAP', 'Z'])],
      ['A controlled interference', puzzle(3, [[op('H', [0])], [op('H', [1], [0])]],
        [crossing(1, 2, [0]), single(2, [0]), single(1)], ['SWAP', 'H', 'X'])],
    ] : []),
  ];
}

export function getLevels(profile, game = 'simplification') {
  profileCheck(profile);
  if (game !== 'simplification' && game !== 'signals') throw new RangeError('Choose a categorical circuit game.');
  return (game === 'signals' ? signalLevels(profile) : simplificationLevels(profile))
    .map(([title, puzzle], index) => ({ id: index + 1, title, ...puzzle }));
}

export function getTutorial(profile, game = 'simplification') {
  profileCheck(profile);
  if (game !== 'simplification' && game !== 'signals') throw new RangeError('Choose a categorical circuit game.');
  if (game === 'signals') {
    const puzzle = profile === 'controlled' ? signalPuzzle(3, [[op('H', [0])], [op('X', [1])]],
      [crossing(1, 2), single(2, [0])], ['SWAP', 'H'], profile) : signalPuzzle(2, [[op('H', [0])]],
      [crossing(0, 1), single(0)], ['SWAP', 'X'], profile);
    return { ...puzzle, steps: [
      { text: 'A crossing exchanges neighbouring wires. Choose SWAP to move the lit paths.', hole: 0, gate: 'SWAP' },
      { text: profile === 'controlled' ? 'A control applies this gate only on paths where its bit is 1. Choose H on that branch.' : 'Choose X to flip the first bit. Match the output paths to the target.', hole: 1, gate: profile === 'controlled' ? 'H' : 'X' },
    ] };
  }
  const first = basis([], 0, 2), second = profile === 'controlled' ? basis([0], 1, 2) : naturality('H', [], [0, 1], 2);
  const columns = [...first.circuit.columns, ...second.circuit.columns];
  // Finish the first block before tidying, then the second block starts at 0.
  const solution = [...first.solution, ...second.solution];
  return { circuit: { wires: 2, columns }, solution,
    steps: solution.map((action, index) => ({ move: action, text: action.rule === 'tidy' ? 'Tidy removes the empty columns.' :
      index === 0 ? 'Replace H–Z–H with X. The goal is empty wires: the identity.' :
      index === 2 ? 'The two X gates cancel.' : action.rule === 'basis-x' ?
        'The same equation works under a shared control. Select only its target gates.' : action.rule === 'swap-h' ?
          'Move H through the crossing. It follows the wire to the other side.' :
          action.rule === 'cancel-swap' ? 'Two crossings cancel.' : 'Cancel the matching pair.' })),
  };
}

export function randomIdentity(profile, { seed, difficulty = 2 } = {}) {
  profileCheck(profile);
  if ((typeof seed !== 'string' && !Number.isSafeInteger(seed)) || String(seed).length > 100 || !Number.isInteger(difficulty) || difficulty < 1 || difficulty > 3) throw new RangeError('Choose a seed and difficulty 1–3.');
  const random = seededRandom(seed), wires = difficulty === 1 ? 2 : profile === 'controlled' && difficulty === 3 ? 4 : 3;
  const labels = Array.from({ length: wires }, (_, index) => index);
  // Reflect the wires without breaking adjacency in crossing and braid rules.
  if (random() < .5) labels.reverse();
  const controlled = profile === 'controlled' && difficulty > 1;
  const controls = controlled ? [labels[0]] : [], targets = controlled ? labels.slice(1) : labels;
  const factories = [() => {
    const start = Math.floor(random() * (targets.length - 1));
    return naturality(['H', 'X', 'Z'][Math.floor(random() * 3)], controls, targets.slice(start, start + 2), wires);
  }];
  if (targets.length > 2) factories.push(() => braid(targets.slice(0, 3), controls, wires));
  if (profile === 'controlled' && difficulty === 3) factories.push(() => basis(labels.slice(0, 2), labels[2], wires));
  const blocks = Array.from({ length: difficulty + 1 }, () => factories[Math.floor(random() * factories.length)]());
  return { circuit: { wires, columns: blocks.flatMap(block => block.circuit.columns) }, solution: blocks.flatMap(block => block.solution) };
}

export function validateSignals(input, profile = 'controlled') {
  profileCheck(profile);
  if (!object(input) || !Array.isArray(input.holes) || input.holes.length < 1 || input.holes.length > 6 ||
      !Array.isArray(input.columns) || input.columns.length + input.holes.length > MAX_COLUMNS) throw new RangeError('Use a fixed circuit followed by 1–6 holes.');
  const circuit = validateCircuit({ wires: input.wires, columns: input.columns.length ? input.columns : [[]] }, profile);
  if (circuit.columns.reduce((count, column) => count + column.length, 0) + input.holes.length > MAX_OPERATIONS) {
    throw new RangeError(`Use at most ${MAX_OPERATIONS} gates, including the holes.`);
  }
  const holes = Array.from(input.holes, entry => {
    const maximum = profile === 'prop' ? 5 : 4;
    if (!object(entry) || !Array.isArray(entry.choices) || entry.choices.length < 2 || entry.choices.length > maximum || new Set(entry.choices).size !== entry.choices.length) throw new RangeError(`Offer 2–${maximum} distinct gates per hole.`);
    if (!Array.isArray(entry.wires) || ![1, 2].includes(entry.wires.length)) throw new RangeError('Choose one or two target wires per hole.');
    if (profile === 'prop' && Object.hasOwn(entry, 'controls')) throw new RangeError('PROP holes use complete gates, without a fixed control.');
    if (entry.controls !== undefined && !Array.isArray(entry.controls)) throw new RangeError('Choose the control wires as an array.');
    const choices = profile === 'prop' && entry.wires.length === 2 ? ['I', 'CX', 'XC', 'CZ', 'SWAP'] : ['I', 'H', 'X', 'Z', 'SWAP'];
    if (entry.choices.some(gate => !choices.includes(gate))) throw new RangeError('Choose gates matching the target wires and circuit language.');
    for (const gate of entry.choices) if (gate !== 'I') validateOperation(holeOperation(entry, gate), input.wires, profile);
    return { wires: [...entry.wires], ...(entry.controls?.length ? { controls: [...entry.controls] } : {}), choices: [...entry.choices] };
  });
  const reference = input.targetCircuit === undefined ? undefined : validateCircuit(input.targetCircuit, profile);
  if (reference && reference.wires !== circuit.wires) throw new RangeError('The target circuit needs the same wires.');
  const referenceState = reference ? simulate(reference) : undefined;
  const target = input.target ?? referenceState;
  if (!Array.isArray(target) || target.length !== 2 ** input.wires || Array.from(target).some(value => !Number.isFinite(value)) ||
      Math.abs(target.reduce((norm, value) => norm + value * value, 0) - 1) > 1e-9) throw new RangeError('Use a normalized real target state.');
  if (reference && !signalsStateEqual(target, referenceState)) throw new RangeError('The target and its circuit disagree.');
  return { wires: circuit.wires, columns: input.columns.length ? circuit.columns : [], holes, target: [...target],
    ...(reference ? { targetCircuit: reference } : {}) };
}

function filledCircuit(puzzle, placements, profile) {
  if (!Array.isArray(placements) || placements.length > puzzle.holes.length) throw new RangeError('Choose a gate for each hole.');
  for (let index = 0; index < placements.length; index++) {
    if (Object.hasOwn(placements, index) && placements[index] !== undefined && !puzzle.holes[index].choices.includes(placements[index])) {
      throw new RangeError('Choose a gate offered by this hole.');
    }
  }
  const columns = puzzle.holes.map((entry, index) => {
    const gate = Object.hasOwn(placements, index) ? placements[index] ?? 'I' : 'I';
    const operation = holeOperation(entry, gate);
    return operation ? [operation] : [];
  });
  return validateCircuit({ wires: puzzle.wires, columns: [...puzzle.columns, ...columns] }, profile);
}

export function fillSignals(input, placements = [], profile = 'controlled') {
  return filledCircuit(validateSignals(input, profile), placements, profile);
}

export const signalsSolved = (puzzle, placements = [], profile = 'controlled') => {
  const normalized = validateSignals(puzzle, profile);
  const circuit = filledCircuit(normalized, placements, profile);
  const complete = normalized.holes.every((hole, index) => hole.choices.includes('I') ||
    (Object.hasOwn(placements, index) && hole.choices.includes(placements[index])));
  return complete && signalsStateEqual(simulate(circuit), normalized.target);
};

export function solveSignals(input, { profile = 'controlled', limit = 1 } = {}) {
  const puzzle = validateSignals(input, profile), solutions = [], placements = [];
  if (!Number.isInteger(limit) || limit < 1 || limit > 4096) throw new RangeError('Choose a solution limit 1–4096.');
  const initial = puzzle.columns.length ? simulate({ wires: puzzle.wires, columns: puzzle.columns }) : [1, ...Array(2 ** puzzle.wires - 1).fill(0)];
  function visit(index, state) {
    if (index === puzzle.holes.length) {
      if (signalsStateEqual(state, puzzle.target)) solutions.push([...placements]);
      return;
    }
    const entry = puzzle.holes[index];
    for (const gate of entry.choices) {
      const next = [...state];
      const operation = holeOperation(entry, gate);
      if (operation) applyOperation(next, operation, puzzle.wires);
      placements[index] = gate; visit(index + 1, next);
      if (solutions.length >= limit) return;
    }
  }
  visit(0, initial); return solutions;
}

export function signalsData(input, referenceCircuit = input.targetCircuit, profile = 'controlled') {
  const puzzle = validateSignals(input, profile);
  if (!referenceCircuit) {
    const solution = solveSignals(puzzle, { profile })[0];
    if (!solution) throw new RangeError('Choose a reachable target before sharing.');
    referenceCircuit = fillSignals(puzzle, solution, profile);
  }
  const checked = validateSignals({ ...puzzle, targetCircuit: referenceCircuit }, profile);
  return { wires: checked.wires, columns: checked.columns, holes: checked.holes, targetCircuit: checked.targetCircuit };
}

export function generateSignals(profile, { seed, difficulty = 2 } = {}) {
  profileCheck(profile);
  if ((typeof seed !== 'string' && !Number.isSafeInteger(seed)) || String(seed).length > 100 || !Number.isInteger(difficulty) || difficulty < 1 || difficulty > 3) throw new RangeError('Choose a seed and difficulty 1–3.');
  const random = seededRandom(seed), wires = difficulty === 1 ? 2 : difficulty === 2 ? 3 : 4;
  const columns = [[op('H', [0])], [op('X', [1])]];
  if (difficulty > 1) columns.push([op('X', [2], [0])]);
  const firstCrossing = Math.floor(random() * (wires - 1));
  const holes = [crossing(firstCrossing, firstCrossing + 1), single(0), profile === 'prop' ? paired(0, 1) : single(1, [wires > 2 ? wires - 1 : 0])];
  if (difficulty > 1) holes.push(profile === 'prop' ? paired(1, 2) : crossing(1, 2, [0]));
  if (difficulty > 2) holes.push(single(3, profile === 'controlled' ? [0, 1] : []));
  for (let attempt = 0; attempt < 24; attempt++) {
    const solution = holes.map(entry => entry.choices[Math.floor(random() * entry.choices.length)]);
    const puzzle = signalPuzzle(wires, columns, holes, solution, profile);
    if (!signalsSolved(puzzle, [], profile)) return puzzle;
  }
  return signalPuzzle(wires, columns, holes, holes.map((_, index) => index ? 'I' : 'SWAP'), profile);
}

export function verifySolution(circuit, solution, profile = 'controlled') {
  return isSolved(solution.reduce((current, action) => applyMove(current, action, { profile }), circuit));
}
