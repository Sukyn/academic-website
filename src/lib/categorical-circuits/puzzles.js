import { seededRandom } from '../games/random.js';
import { goalState, stateEqual as signalsStateEqual } from '../quantum-signals/engine.js';
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

function alternatingCnot(targets, controls = []) {
  const [first, second] = targets;
  const cx = (control, target) => op('X', [target], [control, ...controls]);
  return [cx(first, second), cx(second, first), cx(first, second)];
}

function cnotSwap(targets = [0, 1], controls = [], wires = 2) {
  return { circuit: { wires, columns: [...alternatingCnot(targets, controls).map(operation => [operation]), [op('SWAP', targets, controls)]] },
    solution: [move('swap-cnot', 0, targets, controls), tidyMove(), move('cancel-swap', 0, targets, controls), tidyMove()] };
}

const simplificationLevels = profile => profile === 'controlled' ? [
  ['Control the square', cancel('H', [1], [0], 2)],
  ['Lift a basis change', basis([0], 1, 2)],
  ['Two controls', cancel('X', [2], [0, 1], 3)],
  ['Controlled crossing', naturality('H', [0], [1, 2], 3)],
  ['Controlled braid', braid([1, 2, 3], [0], 4)],
] : [
  ['Cross twice', cancel('SWAP', [0, 1], [], 2)],
  ['Three CNOTs make a swap', cnotSwap()],
  ['Carry the square', naturality()],
  ['Three crossings', braid()],
  ['Carry the phase', naturality('Z')],
  ['Carry the flip', naturality('X')],
];

function signalPuzzle(wires, holes, solution, profile = 'controlled') {
  // Finish by recombining paths, without offering a final unconditional bit flip.
  if (solution.at(-1) === 'H') holes = [...holes.slice(0, -1), {
    ...holes.at(-1), choices: holes.at(-1).choices.filter(gate => gate !== 'X'),
  }];
  const operations = [...Array.from({ length: wires }, (_, wire) => op('X', [wire])),
    ...holes.map((hole, index) => holeOperation(hole, solution[index])).filter(Boolean).reverse()];
  const stack = [];
  for (const operation of operations) {
    if (JSON.stringify(stack.at(-1)) === JSON.stringify(operation)) stack.pop();
    else stack.push(operation);
  }
  return { ...validateSignals({ wires, columns: stack.map(operation => [operation]), holes }, profile), solution };
}
const hole = (wires, choices, controls = []) => ({ wires, choices, ...(controls.length ? { controls } : {}) });
const single = (wire, controls = []) => hole([wire], ['I', 'H', 'X', 'Z'], controls);
const crossing = (first, second, controls = []) => hole([first, second], ['I', 'SWAP'], controls);
const paired = (first, second) => hole([first, second], ['I', 'CX', 'XC', 'CZ',
  ...(Math.abs(first - second) === 1 ? ['SWAP'] : [])]);

function cnotSignalPuzzle(profile, { wires = 3, targets = [0, 1], spectator = 2, controls = [] } = {}) {
  const [first] = targets;
  // Entangle the moved qubit with a spectator so all three CNOTs affect the target.
  const holes = alternatingCnot(targets, controls).map(operation => profile === 'prop' ?
    hole(targets, ['I', 'CX', 'XC']) : hole(operation.wires, ['I', 'X'], operation.controls));
  holes.push(profile === 'prop' ? paired(first, spectator) : single(spectator, [first]), single(first));
  const solution = [...(profile === 'prop' ? ['CX', 'XC', 'CX'] : ['X', 'X', 'X']), profile === 'prop' ? 'CX' : 'X', 'H'];
  if (controls.length) { holes.push(single(controls[0])); solution.push('H'); }
  return signalPuzzle(wires, holes, solution, profile);
}

function signalLevels(profile) {
  const puzzle = (...args) => signalPuzzle(...args, profile);
  return profile === 'controlled' ? [
    ['Unequal branches', puzzle(2, [single(1, [0]), single(0)], ['H', 'H'])],
    ['Two control bits', puzzle(3, [single(2, [0, 1]), single(0), single(1)], ['X', 'H', 'H'])],
    ['Choose which crossing', puzzle(3, [crossing(1, 2, [0]), single(2), single(0)], ['SWAP', 'H', 'H'])],
    ['A controlled interference', puzzle(3, [crossing(1, 2, [0]), single(2, [0]), single(1), single(0)], ['SWAP', 'H', 'X', 'H'])],
    ['Control three CNOTs', cnotSignalPuzzle(profile, { wires: 4, targets: [1, 2], spectator: 3, controls: [0] })],
  ] : [
    ['Move the excitation', puzzle(2, [crossing(0, 1), single(0)], ['SWAP', 'H'])],
    ['Move a superposition', puzzle(2, [crossing(0, 1), single(1)], ['SWAP', 'H'])],
    ['Move a correlation', puzzle(3, [crossing(1, 2), paired(0, 1), single(1), single(2), single(0)], ['SWAP', 'CX', 'X', 'X', 'H'])],
    ['Return to one path', puzzle(3, [crossing(1, 2), paired(0, 1), single(0), single(2)], ['SWAP', 'CX', 'H', 'H'])],
    ['Three CNOTs make a swap', cnotSignalPuzzle(profile)],
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
    if (profile === 'controlled') return {
      ...signalPuzzle(3, [crossing(1, 2, [0]), single(2, [0]), single(0)], ['SWAP', 'H', 'H'], profile),
      steps: [
        { text: 'The first qubit controls SWAP. The last two bits exchange places when the first bit is 1.', hole: 0, gate: 'SWAP' },
        { text: 'With the same control, H acts on the third qubit only in basis states whose first bit is 1.', hole: 1, gate: 'H' },
        { text: 'H on the first qubit recombines the amplitudes, leaving only basis state 111.', hole: 2, gate: 'H' },
      ],
    };
    return {
      ...signalPuzzle(3, [crossing(0, 1), ...Array.from({ length: 3 }, () => hole([0, 1], ['I', 'CX', 'XC'])), paired(0, 2), single(0)],
        ['SWAP', 'CX', 'XC', 'CX', 'CX', 'H'], profile),
      steps: [
        { text: 'SWAP exchanges the first two qubits. In each basis label, the first two bits exchange positions.', hole: 0, gate: 'SWAP' },
        { text: 'Three CNOT gates with alternating controls equal SWAP. The first uses the upper qubit as control.', hole: 1, gate: 'CX' },
        { text: 'Control and target exchange roles for the second gate.', hole: 2, gate: 'XC' },
        { text: 'The third gate restores the original control direction, completing SWAP.', hole: 3, gate: 'CX' },
        { text: 'This CNOT removes entanglement between the first and third qubits.', hole: 4, gate: 'CX' },
        { text: 'H on the first qubit produces the target basis state 111.', hole: 5, gate: 'H' },
      ],
    };
  }
  const first = basis([], 0, 2), second = profile === 'controlled' ? basis([0], 1, 2) : naturality('H', [], [0, 1], 2);
  const blocks = [first, second, ...(profile === 'prop' ? [cnotSwap()] : [])];
  const columns = blocks.flatMap(block => block.circuit.columns);
  // Each solved block is tidied away before the next starts at column 0.
  const solution = blocks.flatMap(block => block.solution);
  return { circuit: { wires: 2, columns }, solution,
    steps: solution.map((action, index) => ({ move: action, text: action.rule === 'tidy' ? 'Tidy removes the empty columns.' :
      index === 0 ? 'Hadamard conjugation gives H–Z–H = X. Removing all gates leaves the identity circuit.' :
      index === 2 ? 'The two X gates cancel.' : action.rule === 'basis-x' ?
        'The conjugation equation applies to the target gates under a shared, unchanged control condition.' : action.rule === 'swap-h' ?
          'H follows its wire through SWAP, moving to the other row. This is the naturality equation.' :
          action.rule === 'swap-cnot' ? 'Three alternating CNOT gates equal SWAP.' :
          action.rule === 'cancel-swap' ? 'SWAP is self-inverse: two consecutive crossings cancel.' : 'Two identical self-inverse gates cancel.' })),
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
  const adjacent = () => {
    const start = Math.floor(random() * (targets.length - 1));
    return targets.slice(start, start + 2);
  };
  const cnotBlock = () => {
    const pair = adjacent();
    if (random() < .5) pair.reverse();
    return cnotSwap(pair, controls, wires);
  };
  const factories = [() => naturality(['H', 'X', 'Z'][Math.floor(random() * 3)], controls, adjacent(), wires)];
  if (targets.length > 2) factories.push(() => braid(targets.slice(0, 3), controls, wires));
  if (profile === 'controlled' && difficulty === 3) factories.push(() => basis(labels.slice(0, 2), labels[2], wires));
  if (difficulty === 1) factories.push(cnotBlock);
  const cnotIndex = difficulty > 1 ? Math.floor(random() * (difficulty + 1)) : -1;
  const blocks = Array.from({ length: difficulty + 1 }, (_, index) => index === cnotIndex ? cnotBlock() :
    factories[Math.floor(random() * factories.length)]());
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
  const target = goalState(circuit.wires);
  if (Object.hasOwn(input, 'targetCircuit') || (Object.hasOwn(input, 'target') && !signalsStateEqual(input.target, target))) {
    throw new RangeError('The goal is fixed: make every bit 1.');
  }
  return { wires: circuit.wires, columns: input.columns.length ? circuit.columns : [], holes, target };
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

export function signalsData(input, profile = 'controlled') {
  const puzzle = validateSignals(input, profile);
  if (!solveSignals(puzzle, { profile }).length) throw new RangeError('Make every bit 1 before sharing.');
  return { wires: puzzle.wires, columns: puzzle.columns, holes: puzzle.holes };
}

export function generateSignals(profile, { seed, difficulty = 2 } = {}) {
  profileCheck(profile);
  if ((typeof seed !== 'string' && !Number.isSafeInteger(seed)) || String(seed).length > 100 || !Number.isInteger(difficulty) || difficulty < 1 || difficulty > 3) throw new RangeError('Choose a seed and difficulty 1–3.');
  const random = seededRandom(seed), wires = difficulty === 1 ? 2 : difficulty === 2 ? 3 : 4;
  if ((profile === 'prop' && difficulty > 1 || profile === 'controlled' && difficulty === 3) && random() < .5) {
    const first = Math.floor(random() * (wires - 1)), targets = [first, first + 1];
    if (random() < .5) targets.reverse();
    const others = Array.from({ length: wires }, (_, index) => index).filter(wire => !targets.includes(wire));
    const spectator = others.splice(Math.floor(random() * others.length), 1)[0];
    return cnotSignalPuzzle(profile, { wires, targets, spectator, controls: profile === 'controlled' ? others : [] });
  }
  for (let attempt = 0; attempt < 64; attempt++) {
    const holes = [], solution = [], count = difficulty + 2;
    const bait = random() < .5 ? Math.floor(random() * count) : -1;
    for (let index = 0; index < count + Number(bait >= 0); index++) {
      const wire = Math.floor(random() * wires), other = wire === wires - 1 ? wire - 1 : wire + 1;
      const closing = index === count + Number(bait >= 0) - 1;
      const entry = closing ? single(wire) : index === 1 ? crossing(Math.min(wire, other), Math.max(wire, other)) :
        index > 1 && profile === 'prop' && random() < .4 ? paired(wire, other) :
          single(wire, profile === 'controlled' && random() < .5 ? [other] : []);
      holes.push(entry);
      solution.push(closing ? 'H' : index === bait ? 'I' : index === 0 ? 'H' : entry.choices[1 + Math.floor(random() * (entry.choices.length - 1))]);
    }
    const puzzle = signalPuzzle(wires, holes, solution, profile);
    const withoutClosingH = { ...puzzle, holes: [...puzzle.holes.slice(0, -1), { ...puzzle.holes.at(-1), choices: ['I', 'Z'] }] };
    if (!solveSignals(withoutClosingH, { profile }).length) return puzzle;
  }
  return signalPuzzle(wires, [crossing(0, 1), single(0)], ['SWAP', 'H'], profile);
}

export function verifySolution(circuit, solution, profile = 'controlled') {
  return isSolved(solution.reduce((current, action) => applyMove(current, action, { profile }), circuit));
}
