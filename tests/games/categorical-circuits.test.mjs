import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES, applyOperation, applyMove, simulate, validateCircuit, holeOperation, isIdentity, isSolved,
  getLegalMoves, selectionCells, matchesSelection, flowTrace } from '../../src/lib/categorical-circuits/engine.js';
import { getLevels, getTutorial, randomIdentity, generateSignals, validateSignals, fillSignals, signalsSolved, solveSignals, signalsData, verifySolution } from '../../src/lib/categorical-circuits/puzzles.js';
import { applyGate } from '../../src/lib/quantum-signals/engine.js';

const close = (first, second) => {
  assert.equal(first.length, second.length);
  first.forEach((value, index) => assert.ok(Math.abs(value - second[index]) < 1e-9, index + ': ' + value + ' ≠ ' + second[index]));
};
const op = (gate, wires, controls) => ({ gate, wires, ...(controls ? { controls } : {}) });

test('categorical operations implement SWAP, Toffoli, controlled H and controlled SWAP on named wires', () => {
  const basis = index => Array.from({ length: 8 }, (_, current) => Number(index === current));
  close(applyOperation(basis(1), op('SWAP', [1, 2]), 3), basis(2));
  close(applyOperation(basis(6), op('X', [2], [0, 1]), 3), basis(7));
  close(applyOperation(basis(2), op('X', [2], [0, 1]), 3), basis(2));
  close(applyOperation(basis(5), op('SWAP', [1, 2], [0]), 3), basis(6));
  close(applyOperation(basis(1), op('SWAP', [1, 2], [0]), 3), basis(1));
  close(simulate({ wires: 2, columns: [[op('H', [0])], [op('H', [1], [0])]] }),
    [Math.SQRT1_2, 0, .5, .5]);
});

test('standard and advanced signals share gate math while preserving both CNOT wire conventions', () => {
  for (let wires = 1; wires <= 4; wires++) {
    const initial = Array.from({ length: 2 ** wires }, (_, index) => Math.sin(index + .4));
    for (let first = 0; first < wires; first++) {
      for (const gate of ['H', 'X', 'Z']) {
        const standard = [...initial]; applyGate(standard, gate, [first], wires);
        assert.deepEqual(applyOperation([...initial], op(gate, [first]), wires), standard);
      }
      const identity = [...initial]; applyGate(identity, 'I', [first], wires);
      assert.deepEqual(identity, initial);
      for (let second = 0; second < wires; second++) if (first !== second) for (const gate of ['CX', 'XC', 'CZ']) {
        const standard = [...initial]; applyGate(standard, gate, [first, second], wires);
        const control = gate === 'XC' ? second : first, target = gate === 'XC' ? first : second;
        assert.deepEqual(applyOperation([...initial], op(gate === 'CZ' ? 'Z' : 'X', [target], [control]), wires), standard);
      }
    }
  }
});

test('whole PROP hole choices preserve standard paired-gate conventions in either wire order', () => {
  for (const wires of [[0, 1], [1, 0], [0, 2], [2, 0]]) {
    const hole = { wires, choices: ['I', 'CX', 'XC', 'CZ'] };
    const original = structuredClone(hole);
    assert.equal(holeOperation(hole, 'I'), null);
    for (const choice of ['CX', 'XC', 'CZ']) {
      const operation = holeOperation(hole, choice);
      const target = choice === 'XC' ? wires[0] : wires[1], control = choice === 'XC' ? wires[1] : wires[0];
      assert.deepEqual(operation, { gate: choice === 'CZ' ? 'Z' : 'X', wires: [target], controls: [control] });
      for (let input = 0; input < 8; input++) {
        const state = Array.from({ length: 8 }, (_, index) => Number(input === index));
        const expected = [...state]; applyGate(expected, choice, wires, 3);
        assert.deepEqual(applyOperation(state, operation, 3), expected);
      }
    }
    assert.deepEqual(hole, original, 'The ordered pair is not changed when converting a choice');
  }
  assert.deepEqual(holeOperation({ wires: [2, 1], controls: [3, 0] }, 'SWAP'),
    { gate: 'SWAP', wires: [1, 2], controls: [0, 3] });
});

test('PROP Signals validates and solves complete paired holes without fixed controls', () => {
  const choices = ['I', 'CX', 'XC', 'CZ', 'SWAP'];
  const prefix = [[op('H', [0])], [op('X', [1])]], wires = 2;
  const targetCircuit = { wires, columns: [...prefix, [op('X', [1], [0])]] };
  const puzzle = { wires, columns: prefix, holes: [{ wires: [0, 1], choices }], targetCircuit };
  const original = structuredClone(puzzle), normalized = validateSignals(puzzle, 'prop');
  assert.equal(signalsSolved(normalized, ['CX'], 'prop'), true);
  assert.equal(signalsSolved(normalized, ['I'], 'prop'), false);
  assert.ok(solveSignals(normalized, { profile: 'prop', limit: 5 }).some(solution => signalsSolved(normalized, solution, 'prop')));
  for (const choice of choices) {
    const operation = holeOperation(puzzle.holes[0], choice);
    const filled = fillSignals(normalized, [choice], 'prop');
    assert.deepEqual(filled.columns.at(-1), operation ? [operation] : []);
    assert.doesNotThrow(() => validateCircuit(filled, 'prop'));
  }
  const exported = signalsData(normalized, undefined, 'prop');
  assert.equal(Object.hasOwn(exported.holes[0], 'controls'), false);
  assert.equal(signalsSolved(validateSignals(JSON.parse(JSON.stringify(exported)), 'prop'), ['CX'], 'prop'), true);
  assert.deepEqual(puzzle, original);
  for (const controls of [[], [0], undefined]) {
    assert.throws(() => validateSignals({ ...puzzle, holes: [{ wires: [1], choices: ['I', 'X'], controls }] }, 'prop'), /complete gates/);
  }
  for (const hole of [{ wires: [0], choices: ['I', 'CX'] }, { wires: [0, 1], choices: ['I', 'X'] },
    { wires: [0, 0], choices: ['I', 'CZ'] }, { wires: [0, 2], choices: ['I', 'CZ'] }]) {
    assert.throws(() => validateSignals({ ...puzzle, holes: [hole] }, 'prop'), /target|distinct|available/);
  }
  assert.throws(() => validateSignals(puzzle, 'controlled'), /2–4/);
  const remote = { wires: 3, columns: [], holes: [{ wires: [2, 0], choices: ['I', 'CX', 'XC', 'CZ'] }],
    target: [1, ...Array(7).fill(0)] };
  assert.doesNotThrow(() => validateSignals(remote, 'prop'));
  assert.throws(() => validateSignals({ ...remote, holes: [{ ...remote.holes[0], choices }] }, 'prop'), /consecutive/);
});

test('all categorical rules and all permitted controlled liftings are exact matrices', () => {
  for (const rule of RULES) {
    for (let controls = 0; controls <= 4 - rule.wires; controls++) {
      const wires = rule.wires + controls, outer = Array.from({ length: controls }, (_, index) => rule.wires + index);
      const lift = columns => ({ wires, columns: columns.map(column => column.map(operation => ({ ...operation,
        controls: [...(operation.controls ?? []), ...outer] }))) });
      const left = lift(rule.left), right = lift(rule.right), size = 2 ** wires;
      for (let input = 0; input < size; input++) {
        const state = Array.from({ length: size }, (_, index) => Number(input === index));
        close(simulate(left, state), simulate(right, state));
      }
      const arbitrary = Array.from({ length: size }, (_, index) => Math.sin(index * .73 + .4));
      close(simulate(left, arbitrary), simulate(right, arbitrary));
    }
  }
});

test('controlled rewriting selects targets, consumes controls and respects their context', () => {
  const circuit = { wires: 3, columns: [[op('Z', [2], [0, 1])], [op('Z', [2], [0, 1])]] };
  const move = { rule: 'cancel-z', column: 0, wires: [2], controls: [0, 1] };
  assert.deepEqual(selectionCells(move), ['2:0', '2:1']);
  assert.equal(matchesSelection(move, ['2:0', '2:1']), true);
  assert.equal(matchesSelection(move, ['0:0', '0:1', '2:0', '2:1']), false);
  assert.equal(isSolved(applyMove(circuit, move)), true);
  assert.ok(getLegalMoves(circuit, { selection: ['2:0', '2:1'] }).some(candidate => candidate.rule === 'cancel-z'));
  const interrupted = { wires: 2, columns: [[op('H', [1], [0])], [op('X', [0])], [op('H', [1], [0])]] };
  assert.throws(() => applyMove(interrupted, { rule: 'basis-z', column: 0, wires: [1], controls: [0] }), /match|interrupt/);
  const different = { wires: 3, columns: [[op('Z', [2], [0])], [op('Z', [2], [1])]] };
  assert.throws(() => applyMove(different, { ...move, controls: [0] }), /match/);
  const parallel = { wires: 3, columns: Array.from({ length: 2 }, () => [op('H', [1], [0]), op('X', [2], [0])]) };
  const remaining = applyMove(parallel, { rule: 'cancel-h', column: 0, wires: [1], controls: [0] });
  assert.deepEqual(remaining.columns, [[op('X', [2], [0])], [op('X', [2], [0])]]);
  assert.equal(isSolved(applyMove(remaining, { rule: 'cancel-x', column: 0, wires: [2], controls: [0] })), true);
  const modifiedControl = { wires: 2, columns: [[op('X', [0])], [op('X', [1], [0])], []] };
  assert.throws(() => applyMove(modifiedControl, { rule: 'basis-x', column: 0, wires: [1], controls: [0], reverse: true }), /interrupt/);
  const readTarget = { wires: 3, columns: [[op('X', [2], [1])], [op('X', [1])], []] };
  assert.throws(() => applyMove(readTarget, { rule: 'basis-x', column: 0, wires: [1], reverse: true }), /interrupt/);
});

test('three alternating CNOTs rewrite to a swap and back in either orientation and under shared controls', () => {
  for (const profile of ['prop', 'controlled']) for (const reversed of [false, true]) {
    for (const count of profile === 'prop' ? [0] : [0, 1, 2]) {
      const wires = count + 2, targets = reversed ? [1, 0] : [0, 1];
      const controls = Array.from({ length: count }, (_, index) => index + 2);
      const [first, second] = targets, cx = (control, target) => [op('X', [target], [control, ...controls])];
      const circuit = { wires, columns: [cx(first, second), cx(second, first), cx(first, second)] };
      const original = structuredClone(circuit), move = { rule: 'swap-cnot', column: 0, wires: targets, controls };
      const result = applyMove(circuit, move, { profile });
      assert.deepEqual(result.columns, [[], [op('SWAP', [0, 1], controls.length ? controls : undefined)], []]);
      assert.deepEqual(applyMove(result, { ...move, reverse: true }, { profile }), validateCircuit(circuit, profile));
      assert.ok(getLegalMoves(circuit, { profile, selection: selectionCells(move, { profile }) })
        .some(candidate => candidate.rule === 'swap-cnot' && !candidate.reverse));
      const state = Array.from({ length: 2 ** wires }, (_, index) => Math.sin(index + .37));
      close(simulate(circuit, state, profile), simulate(result, state, profile));
      assert.deepEqual(circuit, original);
    }
  }
  const remote = { wires: 3, columns: [[op('X', [2], [0])], [op('X', [0], [2])], [op('X', [2], [0])]] };
  assert.throws(() => applyMove(remote, { rule: 'swap-cnot', column: 0, wires: [0, 2] }, { profile: 'prop' }), /consecutive/);
  assert.equal(getLegalMoves(remote, { profile: 'prop', allowedRules: ['swap-cnot'] }).length, 0);
});

test('PROP retains full linked-gate selections and rejects new controlled generators', () => {
  const circuit = { wires: 2, columns: [[op('Z', [1], [0])], [op('Z', [1], [0])]] };
  const move = { rule: 'cancel-z', column: 0, wires: [1], controls: [0] };
  assert.deepEqual(selectionCells(move, { profile: 'prop' }).sort(), ['0:0', '0:1', '1:0', '1:1']);
  assert.equal(isSolved(applyMove(circuit, move, { profile: 'prop' })), true);
  assert.throws(() => validateCircuit({ wires: 2, columns: [[op('H', [1], [0])]] }, 'prop'), /switch/);
  assert.throws(() => validateCircuit({ wires: 3, columns: [[op('X', [2], [0, 1])]] }, 'prop'), /switch/);
});

test('SWAP accepts only consecutive targets across circuits, imports, holes and rule mappings', () => {
  for (const profile of ['prop', 'controlled']) {
    for (let first = 0; first < 4; first++) for (let second = 0; second < 4; second++) if (first !== second) {
      const operation = op('SWAP', [first, second]);
      const circuit = { wires: 4, columns: [[operation]] };
      const puzzle = { wires: 4, columns: [], holes: [{ wires: operation.wires, choices: ['I', 'SWAP'] }],
        target: [1, ...Array(15).fill(0)] };
      if (Math.abs(first - second) === 1) {
        assert.doesNotThrow(() => validateCircuit(circuit, profile));
        assert.doesNotThrow(() => validateSignals(puzzle, profile));
      } else {
        for (const validate of [() => validateCircuit(circuit, profile), () => validateSignals(puzzle, profile),
          () => validateSignals({ ...puzzle, holes: [{ wires: [0], choices: ['I', 'X'] }], targetCircuit: circuit }, profile)]) {
          assert.throws(validate, /consecutive/);
        }
      }
    }
    const empty = { wires: 3, columns: [[], []] }, original = structuredClone(empty);
    assert.throws(() => applyMove(empty, { rule: 'cancel-swap', wires: [0, 2], column: 0, reverse: true }, { profile }), /consecutive/);
    for (const move of getLegalMoves(empty, { profile, allowedRules: ['cancel-swap'] })) {
      assert.equal(Math.abs(move.wires[0] - move.wires[1]), 1);
    }
    assert.deepEqual(empty, original);
  }
  assert.throws(() => validateCircuit({ wires: 4, columns: [[op('SWAP', [0, 3], [1, 2])]] }), /consecutive/);
});

test('rewrites preserve disjoint gates, never mutate sources and reject dangling or overlapping controls', () => {
  const circuit = { wires: 3, columns: [[op('H', [0]), op('Z', [2])], [op('H', [0])]] };
  const before = structuredClone(circuit);
  const result = applyMove(circuit, { rule: 'cancel-h', column: 0, wires: [0] });
  assert.deepEqual(result.columns, [[op('Z', [2])], []]);
  assert.deepEqual(circuit, before);
  assert.throws(() => validateCircuit({ wires: 2, columns: [[op('X', [0], [0])]] }), /distinct/);
  assert.throws(() => validateCircuit({ wires: 2, columns: [[op('X', [1], [0]), op('Z', [0])]] }), /disjoint/);
  assert.throws(() => validateCircuit({ wires: 2, columns: Array(49).fill([]) }), /48/);
  assert.throws(() => applyMove(circuit, { rule: 'cancel-h', column: 0, wires: [0], controls: [0] }), /distinct/);
});

test('identity validation retains global phase and flow traces agree with direct evolution', () => {
  const minusIdentity = { wires: 1, columns: ['X', 'Z', 'X', 'Z'].map(gate => [op(gate, [0])]) };
  assert.equal(isIdentity(minusIdentity), false);
  assert.equal(isIdentity({ wires: 2, columns: [[op('SWAP', [0, 1])], [op('SWAP', [0, 1])]] }), true);
  const circuit = { wires: 3, columns: [[op('H', [0])], [op('H', [1], [0])], [op('SWAP', [1, 2], [0])], [op('Z', [2], [0])]] };
  close(flowTrace(circuit).snapshots.at(-1), simulate(circuit));
});

test('advanced campaigns teach the features added by their category', () => {
  for (const game of ['simplification', 'signals']) {
    const prop = getLevels('prop', game), controlled = getLevels('controlled', game);
    assert.ok(![...prop, ...controlled].some(level => level.title === 'Change the target basis'));
    assert.ok(controlled.every(level => !prop.some(previous => previous.title === level.title)),
      'Controlled PROP has its own lessons instead of repeating the PROP campaign');
    for (const campaign of [prop, controlled]) assert.deepEqual(campaign.map(level => level.id),
      Array.from({ length: campaign.length }, (_, index) => index + 1));
    for (const level of controlled) {
      if (game === 'simplification') {
        assert.ok(level.solution.filter(move => move.rule !== 'tidy').every(move => move.controls?.length),
          level.title + ' applies equations under shared controls');
      } else {
        assert.ok(level.holes.some(hole => hole.controls?.length &&
          (hole.controls.length > 1 || hole.choices.includes('H') || hole.choices.includes('SWAP'))),
          level.title + ' uses a constructor unavailable in PROP');
      }
    }
  }
  assert.ok(getLevels('prop').some(level => level.title === 'Three crossings'));
  const lesson = getLevels('prop').find(level => level.title === 'Three CNOTs make a swap');
  assert.ok(lesson.solution.some(move => move.rule === 'swap-cnot'));
  assert.ok(getTutorial('prop').steps.some(step => step.move.rule === 'swap-cnot'));
});

test('categorical campaigns and tutorials have executable exact witnesses', () => {
  for (const profile of ['prop', 'controlled']) {
    for (const level of [...getLevels(profile), getTutorial(profile)]) {
      assert.equal(isIdentity(level.circuit, profile), true, profile + ' ' + level.title);
      assert.equal(verifySolution(level.circuit, level.solution, profile), true, profile + ' ' + level.title);
    }
    for (const level of [...getLevels(profile, 'signals'), getTutorial(profile, 'signals')]) {
      assert.equal(signalsSolved(level, level.solution, profile), true, level.title);
      assert.equal(signalsSolved(level, [], profile), false, level.title);
      assert.ok(solveSignals(level, { profile }).length, level.title);
      if (profile === 'prop') for (const hole of level.holes) {
        assert.equal(Object.hasOwn(hole, 'controls'), false, level.title);
        assert.ok(hole.choices.every(choice => (hole.wires.length === 1 ? ['I', 'H', 'X', 'Z'] : ['I', 'CX', 'XC', 'CZ', 'SWAP']).includes(choice)));
      }
    }
  }
});

test('seeded categorical generators preserve witnesses, profiles and nontrivial targets', () => {
  const signatures = new Set(), cnotPositions = new Set(), cnotOrientations = new Set();
  for (const profile of ['prop', 'controlled']) for (const difficulty of [1, 2, 3]) for (let seed = 0; seed < 20; seed++) {
    const puzzle = randomIdentity(profile, { seed, difficulty });
    assert.deepEqual(randomIdentity(profile, { seed, difficulty }), puzzle);
    validateCircuit(puzzle.circuit, profile);
    assert.equal(isIdentity(puzzle.circuit), true);
    assert.equal(verifySolution(puzzle.circuit, puzzle.solution, profile), true, profile + ' ' + difficulty + ' ' + seed);
    signatures.add(JSON.stringify(puzzle.circuit));
    if (difficulty > 1) {
      assert.equal(puzzle.solution.filter(move => move.rule === 'swap-cnot').length, 1,
        'Medium and hard puzzles use the CNOT-to-SWAP equation alongside other rule families');
      const moves = getLegalMoves(puzzle.circuit, { profile, allowedRules: ['swap-cnot'] }).filter(move => !move.reverse);
      assert.ok(moves.length);
      for (const move of moves) { cnotPositions.add(move.column); cnotOrientations.add(move.wires[0] < move.wires[1]); }
    }
    const signals = generateSignals(profile, { seed, difficulty });
    assert.deepEqual(generateSignals(profile, { seed, difficulty }), signals);
    validateSignals(signals, profile);
    assert.equal(signalsSolved(signals, signals.solution, profile), true);
    assert.equal(signalsSolved(signals, [], profile), false);
    close(simulate(fillSignals(signals, signals.solution, profile)), signals.target);
    if (profile === 'prop') {
      assert.ok(signals.holes.some(hole => hole.choices.includes('CX')), 'Random PROP puzzles offer whole paired gates');
      assert.ok(signals.holes.every(hole => !Object.hasOwn(hole, 'controls')));
    }
  }
  assert.ok(signatures.size >= 70, 'generated circuit diversity: ' + signatures.size);
  assert.ok(cnotPositions.size >= 3, 'CNOT triples appear at different positions');
  assert.equal(cnotOrientations.size, 2, 'Both alternating CNOT orientations are generated');
});

test('categorical custom data rejects malformed choices, target vectors, profiles and resource excesses', () => {
  const puzzle = getLevels('controlled', 'signals').find(level => level.title === 'Unequal branches');
  assert.throws(() => validateSignals({ ...puzzle, holes: Array(7).fill(puzzle.holes[0]) }), /1–6/);
  assert.throws(() => validateSignals({ ...puzzle, target: [Infinity, 0, 0, 0] }), /normalized/);
  assert.throws(() => validateSignals({ ...puzzle, holes: [{ wires: [0, 1], choices: ['I', 'H'] }] }), /target/);
  assert.throws(() => fillSignals(puzzle, ['SWAP']), /offered/);
  assert.throws(() => solveSignals(puzzle, { limit: 99999 }), /4096/);
  assert.throws(() => randomIdentity('unknown', { seed: 0 }), /PROP/);
  assert.throws(() => generateSignals('prop', { seed: 0, difficulty: 4 }), /difficulty/);
  assert.throws(() => getLegalMoves({ wires: 1, columns: [[]] }, { selection: [null] }), /cells/);
  assert.throws(() => getLegalMoves({ wires: 1, columns: [[]] }, { selection: ['0:5'] }), /cells/);
  assert.throws(() => getLegalMoves({ wires: 1, columns: [[]] }, { selection: {} }), /cells/);
  assert.throws(() => validateSignals({ ...puzzle, target: [1, , , ] }), /normalized/);
  const unequal = getLevels('controlled', 'signals').find(level => level.title === 'Unequal branches');
  const data = signalsData(unequal);
  assert.equal(Object.hasOwn(data, 'target'), false);
  close(validateSignals(JSON.parse(JSON.stringify(data))).target, unequal.target);
  assert.throws(() => validateSignals({ ...unequal, targetCircuit: { wires: 2, columns: [[]] } }), /disagree/);
  assert.throws(() => validateSignals({ ...puzzle, holes: Array(1) }), /distinct gates/);
  for (const controls of [null, {}, '', '0', { length: 0 }, false, 0]) {
    assert.throws(() => validateSignals({ ...puzzle, holes: [{ wires: [1], choices: ['I', 'X'], controls }] }), /array/);
  }
});

test('unfilled mandatory signal holes preview identity but cannot win or accept an unoffered identity', () => {
  const puzzle = { wires: 1, columns: [], holes: Array.from({ length: 2 }, () => ({ wires: [0], choices: ['H', 'X'] })), target: [1, 0] };
  close(simulate(fillSignals(puzzle, [])), [1, 0]);
  assert.equal(signalsSolved(puzzle, []), false);
  assert.equal(signalsSolved(puzzle, Array(2)), false);
  assert.equal(signalsSolved(puzzle, ['H', 'H']), true);
  assert.throws(() => fillSignals(puzzle, ['I']), /offered/);
  assert.throws(() => fillSignals(puzzle, [null]), /offered/);
  assert.throws(() => fillSignals(puzzle, ['H', 'H', 'H']), /each hole/);
});

test('rewrites normalize unordered SWAP targets and shared controls without changing the source', () => {
  const circuit = { wires: 4, columns: Array.from({ length: 2 }, () =>
    [op('SWAP', [3, 2], [1, 0])]) };
  const original = structuredClone(circuit);
  const move = { rule: 'cancel-swap', column: 0, wires: [3, 2], controls: [1, 0] };
  assert.equal(isIdentity(circuit), true);
  assert.equal(isSolved(applyMove(circuit, move)), true);
  const selection = selectionCells(move);
  assert.ok(getLegalMoves(circuit, { selection }).some(candidate => candidate.rule === 'cancel-swap'));
  assert.deepEqual(circuit, original);
});

test('Signals capacity preflight keeps every offered filling playable and rejects excess before solving', () => {
  const puzzle = { wires: 4, columns: Array.from({ length: 24 }, () =>
    Array.from({ length: 4 }, (_, wire) => op('X', [wire]))),
    holes: [{ wires: [0], choices: ['I', 'X'] }], target: [1, ...Array(15).fill(0)] };
  const original = structuredClone(puzzle);
  for (const action of [() => validateSignals(puzzle), () => solveSignals(puzzle), () => fillSignals(puzzle, ['I']),
    () => fillSignals(puzzle, ['X']), () => signalsSolved(puzzle, ['X'])]) assert.throws(action, /96 gates/);
  const valid = { ...puzzle, columns: [...puzzle.columns.slice(0, -1), puzzle.columns.at(-1).slice(1)] };
  assert.ok(solveSignals(valid).length);
  assert.equal(signalsSolved(valid, ['I']), false);
  assert.doesNotThrow(() => fillSignals(valid, ['X']));
  const filled = fillSignals(valid, ['I']);
  filled.columns[0][0].wires[0] = 3;
  assert.deepEqual(puzzle, original);
});

test('free column removal preserves circuit order and amplitudes for first, middle and trailing spaces', () => {
  const circuit = { wires: 3, columns: [[], [op('H', [0])], [], [op('X', [2])], []] };
  const original = structuredClone(circuit);
  for (const profile of ['prop', 'controlled']) for (const column of [0, 2, 4]) {
    const result = applyMove(circuit, { rule: 'remove-column', column }, { profile });
    assert.deepEqual(result.columns, original.columns.filter((_, index) => index !== column));
    close(simulate(result), simulate(circuit));
    assert.deepEqual(circuit, original);
  }
  const empty = { wires: 4, columns: [[], []] };
  assert.deepEqual(applyMove(empty, { rule: 'remove-column', column: 1 }), { wires: 4, columns: [[]] });
  assert.equal(RULES.some(rule => rule.id === 'remove-column'), false, 'Spacing is not a scored rewrite rule');
});

test('column removal rejects occupied or invalid columns and retains the final empty column', () => {
  const circuit = { wires: 3, columns: [[], [op('SWAP', [0, 1])], []] };
  const original = structuredClone(circuit);
  for (const column of [-1, 1, 3, .5, '0', undefined, NaN, Infinity]) {
    assert.throws(() => applyMove(circuit, { rule: 'remove-column', column }), /empty column/);
    assert.deepEqual(circuit, original);
  }
  const empty = { wires: 4, columns: [[]] };
  assert.throws(() => applyMove(empty, { rule: 'remove-column', column: 0 }), /at least one column/);
  assert.deepEqual(empty, { wires: 4, columns: [[]] });
});

test('Signals reference exports retain reachable targets when a solver witness has opposite global phase', () => {
  const puzzle = generateSignals('prop', { seed: 'categorical-browser-quality', difficulty: 2 });
  const data = signalsData(puzzle, undefined, 'prop');
  const restored = validateSignals(JSON.parse(JSON.stringify(data)), 'prop');
  const solution = solveSignals(restored, { profile: 'prop' })[0];
  assert.ok(solution);
  assert.equal(signalsSolved(restored, solution, 'prop'), true);
  const opposite = { ...restored, target: restored.target.map(value => -value) };
  assert.doesNotThrow(() => validateSignals(opposite, 'prop'));
  assert.equal(signalsSolved(opposite, solution, 'prop'), true);
});
