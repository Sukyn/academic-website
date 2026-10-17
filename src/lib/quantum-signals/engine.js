// Real Clifford gates suffice for this game. Row 0 is the most significant bit;
// the small state vector keeps phase and entanglement visible without sampling.
import { applyRealGate } from '../games/real-gates.js';

export const GATES = Object.freeze(['I', 'H', 'X', 'Z', 'CX', 'XC', 'CZ']);
const EPSILON = 1e-9;
const stateSize = size => size >= 2 && size <= 16 && Number.isInteger(Math.log2(size));
const arity = gate => gate === 'CX' || gate === 'XC' || gate === 'CZ' ? 2 : 1;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && /^[a-zA-Z][\w-]{0,39}$/.test(value);

export const getHoles = puzzle => puzzle.columns.flat().filter(entry => entry.id);
export const controlWire = (gate, wires) => gate === 'XC' ? wires[1] : wires[0];

export function stateFromWeights(weights) {
  if (!Array.isArray(weights) || !stateSize(weights.length) ||
      Array.from(weights).some(weight => weight !== -1 && weight !== 0 && weight !== 1)) {
    throw new RangeError('Use 2, 4, 8 or 16 target weights: −1, 0 or 1.');
  }
  const norm = Math.hypot(...weights);
  if (!norm) throw new RangeError('Select at least one target state.');
  return weights.map(weight => weight === 0 ? 0 : weight / norm);
}

// Real Clifford states have equal populated amplitudes. Keep only their signs
// for editing; return null rather than round an arbitrary unequal target.
export function targetWeights(state) {
  if (!Array.isArray(state) || !stateSize(state.length) ||
      Array.from(state).some(amplitude => !Number.isFinite(amplitude))) return null;
  const magnitude = Math.abs(state.find(amplitude => Math.abs(amplitude) > EPSILON) ?? 0);
  if (!magnitude || state.some(amplitude => Math.abs(amplitude) > EPSILON && Math.abs(Math.abs(amplitude) - magnitude) > EPSILON)) return null;
  return state.map(amplitude => Math.abs(amplitude) <= EPSILON ? 0 : amplitude < 0 ? -1 : 1);
}

// Custom files use sparse signs and no hole IDs; engine and replay records use
// normalized amplitudes and stable IDs. Both share the same circuit checks.
function readPuzzle(input, custom = false) {
  if (!object(input) || !Number.isInteger(input.wires) || input.wires < 1 || input.wires > 4 ||
      !Array.isArray(input.columns) || input.columns.length < 1 || input.columns.length > 16) {
    throw new RangeError('Use 1–4 wires and 1–16 columns.');
  }
  const ids = new Set();
  const columns = Array.from(input.columns, column => {
    if (!Array.isArray(column) || column.length > input.wires) throw new RangeError('Invalid circuit column.');
    const occupied = new Set();
    return Array.from(column, entry => {
      if (!object(entry) || !Array.isArray(entry.wires) || entry.wires.length < 1 || entry.wires.length > 2 ||
          Array.from(entry.wires).some(wire => !Number.isInteger(wire) || wire < 0 || wire >= input.wires || occupied.has(wire)) ||
          new Set(entry.wires).size !== entry.wires.length) throw new RangeError('Each gate needs distinct, available wires.');
      entry.wires.forEach(wire => occupied.add(wire));
      const wires = [...entry.wires];
      if (Object.hasOwn(entry, 'choices') || (!custom && Object.hasOwn(entry, 'id'))) {
        const id = custom ? 'h' + (ids.size + 1) : entry.id;
        if (!identifier(id) || ids.has(id) || !Array.isArray(entry.choices) || entry.choices.length < 2 ||
            entry.choices.length > 4 || new Set(entry.choices).size !== entry.choices.length ||
            Array.from(entry.choices).some(gate => !GATES.includes(gate) || (gate !== 'I' && arity(gate) !== wires.length))) {
          throw new RangeError('Invalid circuit hole or gate choices.');
        }
        ids.add(id);
        return { id, wires, choices: [...entry.choices] };
      }
      if (!GATES.includes(entry.gate) || (entry.gate !== 'I' && arity(entry.gate) !== wires.length)) {
        throw new RangeError('Unknown or incompatible gate.');
      }
      return { gate: entry.gate, wires };
    });
  });
  if (ids.size < 1 || ids.size > 6) throw new RangeError('Use 1–6 holes.');
  let target = input.target;
  if (custom) {
    if (!object(target)) throw new RangeError('Use signed binary labels for the target.');
    const weights = Array(2 ** input.wires).fill(0);
    for (const [bits, weight] of Object.entries(target)) {
      if (bits.length !== input.wires || !/^[01]+$/.test(bits) || (weight !== -1 && weight !== 1)) {
        throw new RangeError('Use binary target labels matching the number of wires, with signs −1 or 1.');
      }
      weights[parseInt(bits, 2)] = weight;
    }
    target = stateFromWeights(weights);
  }
  if (!Array.isArray(target) || target.length !== 2 ** input.wires ||
      Array.from(target).some(amplitude => typeof amplitude !== 'number' || !Number.isFinite(amplitude)) ||
      Math.abs(target.reduce((norm, amplitude) => norm + amplitude * amplitude, 0) - 1) > EPSILON) {
    throw new RangeError('The target must be a normalized real quantum state.');
  }
  return {
    wires: input.wires, columns, target: [...target],
  };
}

export const validatePuzzle = input => readPuzzle(input);

export function validatePlacements(puzzle, placements) {
  if (!object(placements)) throw new RangeError('Invalid gate placements.');
  const holes = new Map(getHoles(puzzle).map(hole => [hole.id, hole]));
  const result = {};
  for (const [id, gate] of Object.entries(placements)) {
    if (!holes.get(id)?.choices.includes(gate)) throw new RangeError('Choose a gate offered by this hole.');
    result[id] = gate;
  }
  return result;
}

export function applyPlacement(puzzle, placements, move) {
  const chosen = validatePlacements(puzzle, placements);
  const hole = object(move) && getHoles(puzzle).find(entry => entry.id === move.hole);
  if (!hole || (move.gate !== null && !hole.choices.includes(move.gate))) throw new RangeError('Choose a gate offered by this hole.');
  if (move.gate === null) delete chosen[move.hole];
  else chosen[move.hole] = move.gate;
  return chosen;
}

export function applyGate(state, gate, wires, wireCount) {
  const first = 1 << (wireCount - controlWire(gate, wires) - 1);
  if (gate === 'CX' || gate === 'XC' || gate === 'CZ') {
    const second = 1 << (wireCount - wires[gate === 'XC' ? 0 : 1] - 1);
    applyRealGate(state, gate === 'CZ' ? 'Z' : 'X', second, first);
  } else applyRealGate(state, gate, first);
}

function evolve(puzzle, placements) {
  const state = Array(2 ** puzzle.wires).fill(0);
  state[0] = 1;
  for (const column of puzzle.columns) {
    for (const entry of column) applyGate(state, entry.gate ?? (Object.hasOwn(placements, entry.id) ? placements[entry.id] : 'I'), entry.wires, puzzle.wires);
  }
  return state;
}

export function stateEqual(first, second) {
  if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length) return false;
  const pivot = first.findIndex(amplitude => Math.abs(amplitude) > EPSILON);
  if (pivot < 0) return false;
  const sign = first[pivot] * second[pivot] < 0 ? -1 : 1;
  return first.every((amplitude, index) => Number.isFinite(second[index]) && Math.abs(amplitude - sign * second[index]) < EPSILON);
}

export function simulate(input, placements = {}) {
  const puzzle = validatePuzzle(input), chosen = validatePlacements(puzzle, placements);
  const state = evolve(puzzle, chosen);
  const complete = getHoles(puzzle).every(hole => Object.hasOwn(chosen, hole.id) || hole.choices.includes('I'));
  return { state, solved: complete && stateEqual(state, puzzle.target) };
}

function findSolutions(puzzle, limit) {
  const holes = getHoles(puzzle), placements = {}, solutions = [];
  const search = index => {
    if (index === holes.length) {
      if (stateEqual(evolve(puzzle, placements), puzzle.target)) solutions.push({ ...placements });
      return;
    }
    const hole = holes[index];
    for (const gate of hole.choices) {
      placements[hole.id] = gate; search(index + 1);
      if (solutions.length >= limit) return;
    }
  };
  search(0);
  return solutions;
}

export function solvePuzzle(input, { limit = 2 } = {}) {
  const puzzle = validatePuzzle(input);
  if (!Number.isInteger(limit) || limit < 1 || limit > 4096) throw new RangeError('Choose a solution limit from 1 to 4096.');
  return findSolutions(puzzle, limit);
}

export function puzzleData(input) {
  const puzzle = validatePuzzle(input), weights = targetWeights(puzzle.target);
  if (!weights) throw new RangeError('Custom targets need equal chances for each selected state.');
  puzzle.columns = puzzle.columns.map(column => column.map(entry => entry.id ? { wires: entry.wires, choices: entry.choices } : entry));
  puzzle.target = Object.fromEntries(weights.flatMap((weight, index) => weight === 0 ? [] :
    [[index.toString(2).padStart(puzzle.wires, '0'), weight]]));
  return puzzle;
}

function validateReachable(input, custom = false) {
  const puzzle = readPuzzle(input, custom);
  let editable = false;
  for (const column of puzzle.columns) {
    if (column.some(entry => entry.id)) editable = true;
    if (editable && column.some(entry => !entry.id)) throw new RangeError('Place fixed gates before the holes.');
  }
  if (!findSolutions(puzzle, 1).length) throw new RangeError('This target cannot be reached with the offered gates.');
  return puzzle;
}

export const validatePlayablePuzzle = input => validateReachable(input);
export const validateCustomPuzzle = input => validateReachable(input, true);
