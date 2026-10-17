import { touchedWires, validateCircuit, validateOperation, simulate } from './engine.js';
import { fillSignals, signalsSolved, solveSignals, validateSignals } from './puzzles.js';

const clone = value => structuredClone(value);
const choicesFor = (entry, profile) => entry.wires.length === 2 ? ['I', 'SWAP'] :
  profile === 'prop' && entry.controls?.length ? ['I', 'X', 'Z'] : ['I', 'H', 'X', 'Z'];
const bounded = (value, maximum) => Number.isInteger(value) && value >= 1 && value <= maximum;
const toolNames = new Set(['select', 'H', 'X', 'Z', 'SWAP', 'control', 'hole', 'erase']);

// The visible gates in hole columns form a witness, not extra puzzle metadata.
// Capturing a target freezes that circuit; editing the puzzle never moves it.
export function createCircuitEditor({ get, profile, onChange }) {
  let active = false, draft, reference, target, selected, pending, tool = 'select';
  const currentProfile = () => typeof profile === 'function' ? profile() : profile ?? 'controlled';
  const element = id => get?.(id);
  const fullCircuit = model => ({ wires: model.wires, columns: [...model.columns,
    ...model.holes.map(hole => hole.witness === 'I' ? [] : [{ gate: hole.witness, wires: hole.wires,
      ...(hole.controls?.length ? { controls: hole.controls } : {}) }]) ] });

  function checked(model) {
    if (!bounded(model.wires, 4) || model.columns.length + model.holes.length < 1 ||
        model.columns.length + model.holes.length > 16 || model.holes.length > 6) {
      throw new RangeError('Use 1–4 wires, 1–16 columns and at most six holes.');
    }
    validateCircuit(fullCircuit(model), currentProfile());
    for (const hole of model.holes) {
      for (const gate of hole.choices) if (gate !== 'I') validateOperation({ gate, wires: hole.wires,
        controls: hole.controls }, model.wires, currentProfile());
      if (!hole.choices.includes(hole.witness)) throw new RangeError('Choose a gate offered by this hole.');
    }
    return model;
  }

  function model() {
    return { circuit: clone(fullCircuit(draft)), holes: draft.holes.map(({ witness, ...hole }) => clone(hole)),
      fixedColumns: draft.columns.length, target, selectedCells: selected ? new Set([selected.wire + ':' + selected.column]) : new Set(),
      pending: pending ? { ...pending } : null };
  }

  function render() {
    if (!active) return;
    const wires = element('editor-wires'), columns = element('editor-columns');
    if (wires) wires.value = String(draft.wires);
    if (columns) columns.value = String(draft.columns.length + draft.holes.length);
    for (const button of element('editor-tools')?.querySelectorAll('[data-editor-tool]') ?? []) {
      button.setAttribute('aria-pressed', String(button.dataset.editorTool === tool));
    }
    const summary = element('editor-summary');
    if (summary) summary.textContent = pending ? 'Choose another wire in the same column.' : '';
    const state = model(); onChange?.(state); return state;
  }

  function commit(next) { draft = checked(next); pending = null; return render(); }

  function capture() {
    if (!active) return;
    if (pending) throw new RangeError('Connect the selected gate first.');
    reference = clone(fullCircuit(draft)); target = simulate(reference, undefined, currentProfile());
    return render();
  }

  function open(input) {
    const mode = currentProfile();
    let next, nextReference;
    if (input) {
      const puzzle = validateSignals(input, mode);
      const witness = Array.isArray(input.solution) && signalsSolved(puzzle, input.solution, mode) ? input.solution :
        solveSignals(puzzle, { profile: mode, limit: 1 })[0];
      if (!witness) throw new RangeError('This puzzle has no reachable target.');
      next = { wires: puzzle.wires, columns: clone(puzzle.columns),
        holes: puzzle.holes.map((hole, index) => ({ ...clone(hole), witness: witness[index] ?? 'I' })) };
      nextReference = input.targetCircuit ? validateCircuit(input.targetCircuit, mode) : fillSignals(puzzle, witness, mode);
    } else {
      next = { wires: 3, columns: [[], [], [], []], holes: [] };
      nextReference = fullCircuit(next);
    }
    checked(next);
    reference = clone(nextReference); target = simulate(reference, undefined, mode);
    draft = next; active = true; pending = selected = null; tool = 'select';
    return render();
  }

  function resize(wires, columns) {
    if (!active) return;
    if (!bounded(wires, 4) || !bounded(columns, 16) || columns < draft.holes.length) {
      throw new RangeError('Use 1–4 wires and 1–16 columns.');
    }
    const fixed = columns - draft.holes.length;
    if (draft.columns.slice(fixed).some(column => column.length)) throw new RangeError('Erase gates before removing their columns.');
    const next = clone(draft); next.wires = wires;
    next.columns = Array.from({ length: fixed }, (_, index) => next.columns[index] ?? []);
    checked(next);
    const resizedReference = { ...reference, wires };
    validateCircuit(resizedReference, currentProfile());
    draft = next; reference = resizedReference; target = simulate(reference, undefined, currentProfile());
    pending = selected = null; return render();
  }

  function setTool(value) {
    if (!toolNames.has(value)) throw new RangeError('Choose an editor tool.');
    tool = value; pending = null; return render();
  }

  function handleCell(wire, column) {
    if (!active) return;
    if (!Number.isInteger(wire) || wire < 0 || wire >= draft.wires || !Number.isInteger(column) ||
        column < 0 || column >= draft.columns.length + draft.holes.length) throw new RangeError('Choose a circuit cell.');
    selected = { wire, column };
    const next = clone(draft), holeIndex = column - next.columns.length;
    const hole = holeIndex >= 0 ? next.holes[holeIndex] : null;
    const entries = hole ? null : next.columns[column];
    const operation = hole ? { gate: hole.witness, wires: hole.wires, controls: hole.controls } :
      entries.find(entry => entry.wires.includes(wire));
    if (tool === 'select') return render();
    if (tool === 'hole') {
      if (hole) return render();
      if (next.holes.length >= 6) throw new RangeError('Use at most six holes.');
      if (next.columns.slice(column + 1).some(entries => entries.length)) {
        throw new RangeError('Keep every fixed gate before the holes.');
      }
      if (entries.length > Number(Boolean(operation))) throw new RangeError('Use one gate in a hole column.');
      const entry = operation ?? { gate: 'I', wires: [wire] };
      const descriptor = { wires: [...entry.wires], ...(entry.controls?.length ? { controls: [...entry.controls] } : {}) };
      next.columns = next.columns.slice(0, column);
      next.holes.unshift({ ...descriptor, choices: choicesFor(descriptor, currentProfile()), witness: entry.gate });
      selected.column = column;
      return commit(next);
    }
    if (tool === 'erase') {
      if (hole) {
        if (hole.wires.includes(wire)) next.holes.splice(holeIndex, 1);
        else if (hole.controls?.includes(wire)) hole.controls = hole.controls.filter(control => control !== wire);
      } else if (operation) next.columns[column] = entries.filter(entry => entry !== operation);
      else for (const entry of entries) if (entry.controls?.includes(wire)) entry.controls = entry.controls.filter(control => control !== wire);
      if (!next.columns.length && !next.holes.length) next.columns.push([]);
      return commit(next);
    }
    if (tool === 'control' || tool === 'SWAP') {
      if (!pending) {
        if (tool === 'control' && (!operation || !operation.wires.includes(wire) ||
            (!hole && operation.gate === 'I'))) throw new RangeError('Choose a gate target, then its control wire.');
        if (hole && !hole.wires.includes(wire)) throw new RangeError('Choose the target of this hole.');
        pending = { wire, column, tool }; return render();
      }
      if (column !== pending.column || wire === pending.wire) throw new RangeError('Choose another wire in the same column.');
      const sourceHole = pending.column >= next.columns.length ? next.holes[pending.column - next.columns.length] : null;
      const sourceEntries = sourceHole ? null : next.columns[pending.column];
      const source = sourceHole ?? sourceEntries.find(entry => entry.wires.includes(pending.wire));
      if (tool === 'control') {
        const controls = source.controls ?? [];
        source.controls = controls.includes(wire) ? controls.filter(control => control !== wire) : [...controls, wire];
        if (sourceHole) sourceHole.choices = choicesFor(sourceHole, currentProfile());
      } else {
        const swap = { gate: 'SWAP', wires: [pending.wire, wire] };
        if (sourceHole) {
          sourceHole.wires = swap.wires; sourceHole.choices = ['I', 'SWAP']; sourceHole.witness = 'SWAP';
        } else next.columns[pending.column] = [...sourceEntries.filter(entry => entry !== source), swap];
      }
      return commit(next);
    }
    if (hole) {
      if (!hole.wires.includes(wire) || !hole.choices.includes(tool)) throw new RangeError('Choose a gate offered by this hole.');
      hole.witness = tool;
    } else {
      if (!operation && entries.some(entry => touchedWires(entry).includes(wire))) throw new RangeError('Choose the gate target to replace it.');
      next.columns[column] = [...entries.filter(entry => entry !== operation), { gate: tool, wires: [wire] }];
    }
    return commit(next);
  }

  function puzzle() {
    if (!active || pending) throw new RangeError('Connect every gate before playing.');
    const input = { wires: draft.wires, columns: clone(draft.columns),
      holes: draft.holes.map(({ witness, ...hole }) => clone(hole)), targetCircuit: clone(reference), target: [...target] };
    const normalized = validateSignals(input, currentProfile());
    if (!solveSignals(normalized, { profile: currentProfile(), limit: 1 }).length) {
      throw new RangeError('The captured target cannot be reached. Capture a new target or restore the offered gates.');
    }
    return { ...normalized, targetCircuit: clone(reference) };
  }

  const safely = action => {
    try { return action(); } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      const summary = element('editor-summary'); if (summary) summary.textContent = error.message;
    }
  };
  element('editor-tools')?.addEventListener('click', event => {
    const button = event.target.closest('[data-editor-tool]');
    if (button) safely(() => setTool(button.dataset.editorTool));
  });
  for (const id of ['editor-wires', 'editor-columns']) element(id)?.addEventListener('change', () =>
    safely(() => resize(Number(element('editor-wires').value), Number(element('editor-columns').value))));
  element('capture-target')?.addEventListener('click', () => safely(capture));

  return { open, close: () => { active = false; pending = selected = null; },
    get active() { return active; }, circuit: () => clone(fullCircuit(draft)), puzzle, render, handleCell, setTool };
}
