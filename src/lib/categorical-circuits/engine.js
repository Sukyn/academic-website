import { RULES, getRule } from './rules.js';
import { applyRealGate } from '../games/real-gates.js';
export { RULES } from './rules.js';

export const MAX_WIRES = 4;
export const MAX_COLUMNS = 48;
export const MAX_OPERATIONS = 96;
export const GATES = Object.freeze(['H', 'X', 'Z', 'SWAP']);
const EPSILON = 1e-9;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
const sorted = values => [...values].sort((a, b) => a - b);
export const touchedWires = operation => [...operation.wires, ...(operation.controls ?? [])];

/** Whole paired gates use the same ordered-wire convention as standard Signals. */
export function holeOperation(hole, choice) {
  if (choice === 'I') return null;
  if (['CX', 'XC', 'CZ'].includes(choice)) {
    const reversed = choice === 'XC';
    return { gate: choice === 'CZ' ? 'Z' : 'X', wires: [hole.wires[reversed ? 0 : 1]],
      controls: [hole.wires[reversed ? 1 : 0]] };
  }
  return { gate: choice, wires: choice === 'SWAP' ? sorted(hole.wires) : [...hole.wires],
    ...(hole.controls?.length ? { controls: sorted(hole.controls) } : {}) };
}

export function validateOperation(operation, wires, profile = 'controlled') {
  if (!object(operation) || !GATES.includes(operation.gate) || !Array.isArray(operation.wires) ||
      operation.wires.length !== (operation.gate === 'SWAP' ? 2 : 1) ||
      (operation.controls !== undefined && !Array.isArray(operation.controls))) throw new RangeError('Choose a gate and its target wires.');
  const used = touchedWires(operation);
  if (used.some(wire => !Number.isInteger(wire) || wire < 0 || wire >= wires) || new Set(used).size !== used.length) {
    throw new RangeError('Targets and controls need distinct available wires.');
  }
  if (operation.gate === 'SWAP' && Math.abs(operation.wires[0] - operation.wires[1]) !== 1) {
    throw new RangeError('SWAP needs two consecutive wires.');
  }
  if (profile !== 'prop' && profile !== 'controlled') throw new RangeError('Choose PROP or controlled PROP.');
  if (profile === 'prop' && (operation.controls?.length ?? 0) &&
      ((operation.controls.length > 1) || !['X', 'Z'].includes(operation.gate))) {
    throw new RangeError('Use controlled X or Z, or switch to controlled PROP.');
  }
  return { gate: operation.gate, wires: operation.gate === 'SWAP' ? sorted(operation.wires) : [...operation.wires],
    ...(operation.controls?.length ? { controls: sorted(operation.controls) } : {}) };
}

export function validateCircuit(input, profile = 'controlled') {
  if (profile !== 'prop' && profile !== 'controlled') throw new RangeError('Choose PROP or controlled PROP.');
  if (!object(input) || !Number.isInteger(input.wires) || input.wires < 1 || input.wires > MAX_WIRES ||
      !Array.isArray(input.columns) || input.columns.length < 1 || input.columns.length > MAX_COLUMNS) {
    throw new RangeError('Use 1–4 wires and 1–48 columns.');
  }
  let count = 0;
  const columns = Array.from(input.columns, entries => {
    if (!Array.isArray(entries) || entries.length > input.wires) throw new RangeError('Invalid circuit column.');
    const targets = new Set(), controls = new Set();
    return Array.from(entries, entry => {
      const operation = validateOperation(entry, input.wires, profile);
      if (operation.wires.some(wire => targets.has(wire) || controls.has(wire)) ||
          operation.controls?.some(wire => targets.has(wire))) throw new RangeError('Operations in one column need disjoint targets.');
      operation.wires.forEach(wire => targets.add(wire));
      operation.controls?.forEach(wire => controls.add(wire));
      if (++count > MAX_OPERATIONS) throw new RangeError(`Use at most ${MAX_OPERATIONS} gates.`);
      return operation;
    });
  });
  return { wires: input.wires, columns };
}

// In-place evolution of at most 16 amplitudes. Row 0 is the first binary digit.
export function applyOperation(state, operation, wires) {
  const controls = (operation.controls ?? []).reduce((mask, wire) => mask | 1 << (wires - wire - 1), 0);
  const first = 1 << (wires - operation.wires[0] - 1);
  const second = operation.gate === 'SWAP' ? 1 << (wires - operation.wires[1] - 1) : 0;
  return applyRealGate(state, operation.gate, first, controls, second);
}

export function simulate(input, initial, profile = 'controlled') {
  const circuit = validateCircuit(input, profile), size = 2 ** circuit.wires;
  if (initial !== undefined && (!Array.isArray(initial) || initial.length !== size || Array.from(initial).some(value => !Number.isFinite(value)))) {
    throw new RangeError('Use a finite real state vector matching the wires.');
  }
  const state = initial ? [...initial] : [1, ...Array(size - 1).fill(0)];
  for (const column of circuit.columns) for (const operation of column) applyOperation(state, operation, circuit.wires);
  return state;
}

export function isIdentity(input, profile = 'controlled') {
  const circuit = validateCircuit(input, profile), size = 2 ** circuit.wires;
  for (let basis = 0; basis < size; basis++) {
    const state = Array(size).fill(0); state[basis] = 1;
    for (const column of circuit.columns) for (const operation of column) applyOperation(state, operation, circuit.wires);
    if (state.some((value, output) => Math.abs(value - Number(output === basis)) > EPSILON)) return false;
  }
  return true;
}

export const isSolved = circuit => circuit.columns.every(column => column.length === 0);

function mapOperation(operation, wires, controls) {
  const targets = operation.wires.map(wire => wires[wire]);
  return { gate: operation.gate, wires: operation.gate === 'SWAP' ? sorted(targets) : targets,
    controls: sorted([...controls, ...(operation.controls ?? []).map(wire => wires[wire])]) };
}
// Both the circuit and mapped pattern have normalized target/control ordering.
const equalOperation = (a, b) => a.gate === b.gate &&
  same(a.wires, b.wires) && same(a.controls ?? [], b.controls ?? []);

function rewrite(input, move, profile) {
  const rule = object(move) && getRule(move.rule);
  if (!rule || !Number.isInteger(move.column) || move.column < 0 || !Array.isArray(move.wires) || move.wires.length !== rule.wires ||
      (move.controls !== undefined && !Array.isArray(move.controls))) throw new RangeError('Choose a valid rule and wire mapping.');
  const controls = move.controls ?? [], used = [...move.wires, ...controls];
  if (new Set(used).size !== used.length || used.some(wire => !Number.isInteger(wire) || wire < 0 || wire >= input.wires)) {
    throw new RangeError('Rule wires and controls must be distinct.');
  }
  const from = move.reverse ? rule.right : rule.left, to = move.reverse ? rule.left : rule.right;
  if (move.column + from.length > input.columns.length) throw new RangeError('The rule does not fit these columns.');
  const consumed = [], context = new Set(used), ruleWires = new Set(move.wires);
  for (let offset = 0; offset < from.length; offset++) {
    const entries = input.columns[move.column + offset], selected = new Set();
    for (const pattern of from[offset]) {
      const expected = mapOperation(pattern, move.wires, controls);
      const index = entries.findIndex((entry, index) => !selected.has(index) && equalOperation(entry, expected));
      if (index < 0) throw new RangeError('The selected gates do not match this rule.');
      selected.add(index);
    }
    // Other gates may read an external control, but cannot modify it or touch
    // any wire belonging to the equation itself.
    if (entries.some((entry, index) => !selected.has(index) && (entry.wires.some(wire => context.has(wire)) ||
        entry.controls?.some(wire => ruleWires.has(wire))))) {
      throw new RangeError('Another gate interrupts this rule or its controls.');
    }
    consumed.push(selected);
  }
  const columns = input.columns.map((entries, column) => {
    const offset = column - move.column;
    if (offset < 0 || offset >= from.length) return entries;
    return [...entries.filter((_, index) => !consumed[offset].has(index)),
      ...to[offset].map(operation => mapOperation(operation, move.wires, controls))];
  });
  return validateCircuit({ wires: input.wires, columns }, profile);
}

export function applyMove(input, move, { profile = 'controlled' } = {}) {
  if (move?.rule === 'tidy') return tidy(input, profile);
  const circuit = validateCircuit(input, profile);
  if (move?.rule === 'insert-column') {
    const count = move.count ?? 1;
    if (!Number.isInteger(move.column) || move.column < 0 || move.column > circuit.columns.length ||
        !Number.isInteger(count) || count < 1 || count + circuit.columns.length > MAX_COLUMNS) throw new RangeError('Choose a column and an available space count.');
    return { wires: circuit.wires, columns: [...circuit.columns.slice(0, move.column), ...Array.from({ length: count }, () => []), ...circuit.columns.slice(move.column)] };
  }
  if (move?.rule === 'remove-column') {
    if (!Number.isInteger(move.column) || move.column < 0 || move.column >= circuit.columns.length || circuit.columns[move.column].length) {
      throw new RangeError('Only a completely empty column can be removed.');
    }
    if (circuit.columns.length === 1) throw new RangeError('Keep at least one column.');
    return { wires: circuit.wires, columns: circuit.columns.filter((_, column) => column !== move.column) };
  }
  return rewrite(circuit, move, profile);
}

function permutations(values, count) {
  if (!count) return [[]];
  return values.flatMap((value, index) => permutations(values.filter((_, other) => index !== other), count - 1).map(rest => [value, ...rest]));
}

export function selectionCells(move, { profile = 'controlled' } = {}) {
  const rule = getRule(move.rule), pattern = move.reverse ? rule.right : rule.left;
  const targets = new Set(pattern.flat().flatMap(operation => operation.wires));
  // Even empty sides can be selected to introduce an identity equation.
  if (!targets.size) for (let wire = 0; wire < rule.wires; wire++) targets.add(wire);
  const cells = new Set();
  for (let offset = 0; offset < pattern.length; offset++) {
    for (const wire of targets) cells.add(move.wires[wire] + ':' + (move.column + offset));
    if (profile === 'prop') {
      for (const wire of move.controls ?? []) cells.add(wire + ':' + (move.column + offset));
      for (const operation of pattern[offset]) for (const wire of operation.controls ?? []) cells.add(move.wires[wire] + ':' + (move.column + offset));
    }
  }
  return [...cells];
}

export function matchesSelection(move, selection, options) {
  const expected = selectionCells(move, options), actual = new Set(selection);
  return actual.size === expected.length && expected.every(cell => actual.has(cell));
}

export function getLegalMoves(input, { profile = 'controlled', selection, allowedRules, expansions = true } = {}) {
  const circuit = validateCircuit(input, profile), moves = [], unique = new Set();
  if (selection !== undefined && ((!Array.isArray(selection) && !(selection instanceof Set)) ||
      (selection.size ?? selection.length) > MAX_WIRES * MAX_COLUMNS ||
      [...selection].some(cell => typeof cell !== 'string' || !/^\d+:\d+$/.test(cell) ||
        Number(cell.split(':')[0]) >= circuit.wires || Number(cell.split(':')[1]) >= circuit.columns.length))) {
    throw new RangeError('Choose cells inside this circuit.');
  }
  const selected = selection === undefined ? undefined : new Set(selection);
  if (selected && !selected.size) return [];
  const selectedColumns = selected ? [...selected].map(cell => Number(cell.split(':')[1])) : undefined;
  const firstColumn = selectedColumns ? Math.min(...selectedColumns) : 0;
  const lastColumn = selectedColumns ? Math.max(...selectedColumns) : undefined;
  const all = Array.from({ length: circuit.wires }, (_, wire) => wire);
  for (const rule of RULES) {
    if (rule.wires > circuit.wires || (allowedRules && !allowedRules.includes(rule.id))) continue;
    if (selected && lastColumn - firstColumn + 1 !== rule.left.length) continue;
    for (const wires of permutations(all, rule.wires)) {
      const remaining = all.filter(wire => !wires.includes(wire));
      for (let mask = 0; mask < 2 ** remaining.length; mask++) {
        const controls = remaining.filter((_, index) => mask & 1 << index);
        for (let column = firstColumn; column <= (selected ? firstColumn : circuit.columns.length - rule.left.length); column++) for (const reverse of [false, true]) {
          if (reverse && !expansions && rule.right.every(column => !column.length)) continue;
          const move = { rule: rule.id, column, wires, ...(controls.length ? { controls } : {}), ...(reverse ? { reverse: true } : {}) };
          if (selected && !matchesSelection(move, selected, { profile })) continue;
          try {
            const next = rewrite(circuit, move, profile), key = JSON.stringify([rule.id, next]);
            if (unique.has(key)) continue;
            unique.add(key); moves.push(move);
          } catch (error) { if (!(error instanceof RangeError)) throw error; }
        }
      }
    }
  }
  return moves;
}

export function tidy(input, profile = 'controlled') {
  const circuit = validateCircuit(input, profile);
  const columns = circuit.columns.filter(column => column.length);
  return { wires: circuit.wires, columns: columns.length ? columns : [[]] };
}

export function flowTrace(input, profile = 'controlled') {
  const circuit = validateCircuit(input, profile), size = 2 ** circuit.wires;
  const snapshots = [[1, ...Array(size - 1).fill(0)]], columns = [], cancellations = [];
  for (const column of circuit.columns) {
    const state = Array(size).fill(0), phases = Array(size).fill(0), edges = [];
    snapshots.at(-1).forEach((amplitude, from) => {
      if (Math.abs(amplitude) < EPSILON) return;
      const contribution = Array(size).fill(0); contribution[from] = amplitude;
      for (const operation of column) applyOperation(contribution, operation, circuit.wires);
      contribution.forEach((value, to) => {
        if (Math.abs(value) < EPSILON) return;
        edges.push({ from, to, amplitude: value }); state[to] += value; phases[to] |= value > 0 ? 1 : 2;
      });
    });
    snapshots.push(state); columns.push(edges);
    cancellations.push(phases.flatMap((phase, basis) => phase === 3 && Math.abs(state[basis]) < EPSILON ? [basis] : []));
  }
  return { snapshots, columns, cancellations };
}
