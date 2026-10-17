import { RULES, validateCircuit, getLegalMoves, applyMove, isSolved, isIdentity, selectionCells } from '../lib/categorical-circuits/engine.js';
import { getLevels, getTutorial, randomIdentity, generateSignals, validateSignals, fillSignals, signalsSolved, signalsData, solveSignals } from '../lib/categorical-circuits/puzzles.js';
import { renderCircuit, renderAdvancedFlow, operationIcon, operationLabel } from '../lib/categorical-circuits/rendering.js';
import { createCircuitEditor } from '../lib/categorical-circuits/editor.js';
import { createCustomPuzzleJson } from '../lib/games/custom-puzzle-json.js';
import { createTutorial } from '../lib/games/tutorial.js';
import { createStepReplay } from '../lib/games/step-replay.js';
import { ignoresGameShortcut } from '../lib/games/controls.js';
import { renderCircuitInstruction } from '../lib/games/tutorial-gates.js';
import { pinFlowLabels, highlightFlowBits } from '../lib/quantum-signals/rendering.js';

const root = document.querySelector('[data-categorical-game]');
const get = id => document.getElementById(id);
const on = (id, action) => get(id).addEventListener('click', () => attempt(action));
const kind = root.dataset.kind, signals = kind === 'signals';
let profile = 'prop', mode = 'tutorial', levelIndex = 0, levels, puzzle, circuit, placements = [];
let editing = false, editorModel, history = [], snapshots = [], selectedHole = 0, guide, winTimer, shots = 0;
let selected = new Set(), available = [], drag, suppressClick = false, context = new Set();
const steps = [], ruleButtons = new Map();
const snapshot = () => ({ circuit, placements: [...placements], shots });
const won = () => signals ? signalsSolved(puzzle, placements, profile) : isSolved(circuit);

function attempt(action) {
  try { action(); get('status').textContent = ''; }
  catch (error) { get('status').textContent = error.message; }
}

const review = createStepReplay({
  length: () => history.length, canReview: () => mode !== 'tutorial' && !editing && history.length > 0,
  onEnter() { clearTimeout(winTimer); get('win-dialog').close(); selected.clear(); },
  onChange: () => render(), interval: 700,
});

const editor = signals ? createCircuitEditor({ get, profile: () => profile,
  onChange(model) { editorModel = model; if (editing) render(); } }) : null;

const json = createCustomPuzzleJson({
  get, game: signals ? 'quantum-signals-advanced' : 'circuit-simplification-advanced',
  exportPuzzle() {
    if (signals) return signalsData(editing ? editor.puzzle() : puzzle, undefined, profile);
    return validateCircuit(editing ? circuit : puzzle.circuit, profile);
  },
  importPuzzle(data) {
    if (signals) {
      const next = validateSignals(data, profile);
      if (!solveSignals(next, { profile }).length) throw new RangeError('The target cannot be reached with these holes.');
      load(next, 'random');
    } else {
      const next = validateCircuit(data, profile);
      if (!isIdentity(next, profile) || isSolved(next)) throw new RangeError('Use a nonempty identity circuit.');
      load({ circuit: next }, 'random');
    }
  },
});

function load(next, nextMode = mode) {
  clearTimeout(winTimer); review.clear(); get('win-dialog').close();
  drag = null; suppressClick = false;
  editing = false; editor?.close(); editorModel = undefined;
  mode = nextMode; puzzle = next;
  if (!signals) circuit = validateCircuit(next.circuit, profile);
  placements = []; history = []; shots = 0; snapshots = [snapshot()]; selected.clear(); context.clear(); selectedHole = 0;
  render();
}

function remember() {
  if (history.length >= 1000) throw new RangeError('Restart before adding more moves.');
  history.push(snapshot());
}

function afterMove() {
  snapshots.push(snapshot()); selected.clear(); render();
  clearTimeout(winTimer);
  if (!editing && mode !== 'tutorial' && won()) {
    winTimer = setTimeout(() => {
      if (editing || review.step !== null || !won()) return;
      get('win-summary').textContent = signals ? 'The output matches the target.' : 'Identity reached.';
      get('result-next').hidden = mode === 'campaign' && levelIndex === levels.length - 1;
      get('result-next').textContent = mode === 'campaign' ? 'Next level' : 'New puzzle';
      get('win-dialog').showModal();
    }, 500);
  }
}

function playMove(move) {
  if (review.step !== null || (mode === 'tutorial' && !guide.executing)) return;
  const next = applyMove(circuit, move, { profile });
  remember(); circuit = next;
  if (move.rule !== 'tidy' && move.rule !== 'insert-column') shots++;
  afterMove();
}

function place(gate) {
  if (editing || review.step !== null || (mode === 'tutorial' && !guide.executing)) return;
  const hole = puzzle.holes[selectedHole];
  if (!hole?.choices.includes(gate)) return;
  remember(); placements = [...placements]; placements[selectedHole] = gate; afterMove();
}

function reset() { if (editing) return; load(puzzle); }
function newPuzzle() {
  guide.leave();
  const options = { seed: crypto.randomUUID(), difficulty: Number(get('difficulty').value) };
  load(signals ? generateSignals(profile, options) : randomIdentity(profile, options), 'random');
}

function selectLevel(index) {
  guide.leave(); levelIndex = Math.max(0, Math.min(levels.length - 1, index)); load(levels[levelIndex], 'campaign');
}

function populateLevels() {
  levels = getLevels(profile, kind);
  get('level').replaceChildren(...levels.map((level, index) => new Option(`${index + 1} · ${level.title}`, String(index + 1))));
}

function makeRuleButtons() {
  if (signals) return;
  for (const rule of RULES) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'button ghost categorical-rule';
    button.dataset.rule = rule.id; button.setAttribute('aria-label', rule.title);
    for (const [index, pattern] of [rule.left, rule.right].entries()) {
      if (index) { const arrow = document.createElement('span'); arrow.textContent = '↔'; button.appendChild(arrow); }
      const miniature = document.createElement('span'); miniature.className = 'categorical-rule-mini';
      renderCircuit(miniature, { wires: rule.wires, columns: pattern }, { interactive: false });
      miniature.setAttribute('aria-hidden', 'true'); button.appendChild(miniature);
    }
    button.addEventListener('click', () => attempt(() => {
      const move = available.find(move => move.rule === rule.id);
      if (move) playMove(move);
    }));
    get('rule-list').appendChild(button); ruleButtons.set(rule.id, button);
  }
}

function renderSelection() {
  if (signals || editing && editor) return;
  for (const cell of get('categorical-board').querySelectorAll('[data-cell]')) {
    const active = selected.has(cell.dataset.cell);
    cell.classList.toggle('is-selected', active); cell.setAttribute('aria-pressed', String(active));
  }
  available = selected.size ? getLegalMoves(circuit, { profile, selection: selected }) : [];
  if (editing) available = available.filter(move => Boolean(move.reverse) === get('reverse-rule').checked &&
    JSON.stringify(move.controls ?? []) === JSON.stringify([...context].sort((a, b) => a - b)));
  for (const input of get('editor-context').querySelectorAll('input')) {
    input.checked = context.has(Number(input.value));
    input.disabled = Number(input.value) >= circuit.wires;
  }
  for (const [id, button] of ruleButtons) button.disabled = review.step !== null || !available.some(move => move.rule === id);
}

function render() {
  if (!puzzle) return;
  const reviewed = review.step === null ? null : snapshots[review.step];
  const activePlacements = reviewed?.placements ?? placements;
  const shown = editing && editor ? editorModel?.circuit : signals ? fillSignals(puzzle, activePlacements, profile) : reviewed?.circuit ?? circuit;
  if (!shown) return;
  const holes = editing && editor ? editorModel.holes : signals ? puzzle.holes : [];
  const activeCells = editing && editor ? editorModel.selectedCells : signals ?
    puzzle.holes[selectedHole].wires.map(wire => wire + ':' + (puzzle.columns.length + selectedHole)) : selected;
  renderCircuit(get('categorical-board'), shown, { selectedCells: activeCells,
    holes, fixedColumns: editing && editor ? editorModel.fixedColumns : signals ? puzzle.columns.length : shown.columns.length,
    locked: review.step !== null });
  if (signals) {
    const target = editing ? editorModel.target : puzzle.target;
    renderAdvancedFlow(get('signal-flow'), get('signal-target'), shown, target, { profile,
      selectedColumn: editing ? undefined : puzzle.columns.length + selectedHole });
    const hole = !editing && puzzle.holes[selectedHole];
    highlightFlowBits(get('signal-flow'), hole?.controls ?? []);
    get('gate-palette').replaceChildren(...(hole ? hole.choices.map(gate => {
      const operation = { gate, wires: hole.wires, controls: hole.controls };
      const button = document.createElement('button'); button.type = 'button'; button.className = 'button ghost';
      button.dataset.choice = gate; button.setAttribute('aria-label', operationLabel(operation));
      button.setAttribute('aria-pressed', String((placements[selectedHole] ?? 'I') === gate));
      button.disabled = review.step !== null;
      button.appendChild(operationIcon(operation)); return button;
    }) : []));
  } else renderSelection();
  for (const name of ['tutorial', 'campaign', 'random']) get('mode-' + name).setAttribute('aria-pressed', String(mode === name));
  get('campaign-controls').hidden = mode !== 'campaign'; get('level').value = String(levelIndex + 1);
  const count = reviewed?.shots ?? shots;
  get('move-count').textContent = `${count} ${count === 1 ? 'move' : 'moves'}`;
  get('previous-level').disabled = levelIndex === 0;
  get('next-level').disabled = mode !== 'campaign' || !won() || levelIndex === levels.length - 1;
  get('custom-controls').hidden = mode !== 'random';
  get('editor-controls').hidden = !editing;
  get('edit-circuit').hidden = get('new-circuit').hidden = mode !== 'random' || editing;
  get('play-custom').hidden = !editing;
  get('reverse-rule').closest('label').hidden = signals || !editing;
  get('undo').disabled = history.length === 0 || editing && signals;
  get('restart').disabled = editing;
  get('tidy').hidden = get('add-space').hidden = signals;
  get('tidy').disabled = get('add-space').disabled = review.step !== null;
  get('replay').hidden = mode === 'tutorial' || editing || !history.length;
  get('replay').disabled = review.playing;
  get('review-controls').hidden = review.step === null;
  get('review-note').textContent = review.step === null ? '' : `Step ${review.step} / ${history.length}`;
  json.update({ visible: mode === 'random', canShare: !editing || signals || !isSolved(circuit) });
  guide?.render();
}

function startEditor(fresh) {
  if (signals) editor.open(fresh ? undefined : puzzle);
  guide.leave(); review.clear(); clearTimeout(winTimer); get('win-dialog').close();
  editing = true; mode = 'random'; history = []; shots = 0; selected.clear(); context.clear();
  if (!signals) {
    circuit = fresh ? { wires: 3, columns: Array.from({ length: 6 }, () => []) } : validateCircuit(puzzle.circuit, profile);
    get('reverse-rule').checked = true;
    get('editor-wires').value = String(circuit.wires); get('editor-columns').value = String(circuit.columns.length);
  }
  snapshots = [snapshot()];
  render();
}

function setupTutorial() {
  const tutorial = getTutorial(profile, kind);
  steps.splice(0, steps.length, ...tutorial.steps.map(step => ({
    text: step.text,
    target: signals ? `[data-choice="${step.gate}"]` : step.move.rule === 'tidy' ? '#tidy' : `[data-rule="${step.move.rule}"]`,
    prepare() {
      if (signals) selectedHole = step.hole;
      else selected = new Set(step.move.rule === 'tidy' ? [] : selectionCells(step.move, { profile }));
      render();
    },
    action() { if (signals) place(step.gate); else playMove(step.move); },
  })));
  guide.enter();
}

guide = createTutorial({ get, steps,
  controls: '#categorical-board button, #rule-list button, #gate-palette button, #undo, #restart, #tidy, #add-space',
  renderText: (node, text) => renderCircuitInstruction(node, text),
  intro: signals ? 'Fill the holes to match the target paths.' : 'Reach the identity using swaps and circuit equations.',
  onReset() { load(getTutorial(profile, kind), 'tutorial'); },
});

makeRuleButtons(); populateLevels();
on('mode-tutorial', setupTutorial); on('mode-campaign', () => selectLevel(levelIndex)); on('mode-random', newPuzzle);
on('previous-level', () => selectLevel(levelIndex - 1)); on('next-level', () => selectLevel(levelIndex + 1));
get('level').addEventListener('change', () => attempt(() => selectLevel(Number(get('level').value) - 1)));
get('category-profile').addEventListener('change', () => attempt(() => {
  guide.leave(); profile = get('category-profile').value; levelIndex = 0; populateLevels(); setupTutorial();
}));
on('new-puzzle', newPuzzle); on('restart', reset);
on('undo', () => {
  if (mode === 'tutorial' || editing && signals || !history.length) return;
  clearTimeout(winTimer); review.clear(); get('win-dialog').close();
  const previous = history.pop(); circuit = previous.circuit; placements = previous.placements; shots = previous.shots; snapshots.pop(); selected.clear(); render();
});
on('tidy', () => playMove({ rule: 'tidy' }));
on('add-space', () => playMove({ rule: 'insert-column', column: selected.size ? Math.min(...[...selected].map(key => Number(key.split(':')[1]))) : circuit.columns.length }));
on('edit-circuit', () => startEditor(false)); on('new-circuit', () => startEditor(true));
on('play-custom', () => {
  if (signals) {
    const next = editor.puzzle();
    if (!solveSignals(next, { profile }).length) throw new RangeError('The target cannot be reached with these holes.');
    load(next, 'random');
  } else {
    if (isSolved(circuit)) throw new RangeError('Apply a rule to build a nonempty identity circuit.');
    load({ circuit }, 'random');
  }
});
for (const id of ['editor-wires', 'editor-columns']) if (!signals) get(id).addEventListener('change', () => attempt(() => {
  if (!editing) return;
  if (!isSolved(circuit)) {
    get('editor-wires').value = String(circuit.wires); get('editor-columns').value = String(circuit.columns.length);
    throw new RangeError('Start from scratch before changing the circuit dimensions.');
  }
  circuit = { wires: Number(get('editor-wires').value), columns: Array.from({ length: Number(get('editor-columns').value) }, () => []) };
  history = []; shots = 0; snapshots = [snapshot()]; selected.clear(); context.clear(); render();
}));
get('reverse-rule').addEventListener('change', renderSelection);

if (!signals) {
  const field = document.createElement('fieldset'); field.className = 'categorical-context';
  const legend = document.createElement('legend'); legend.textContent = 'Control context'; field.appendChild(legend);
  for (let wire = 0; wire < 4; wire++) {
    const label = document.createElement('label'), input = document.createElement('input');
    input.type = 'checkbox'; input.value = String(wire);
    input.addEventListener('change', () => { if (input.checked) context.add(wire); else context.delete(wire); renderSelection(); });
    label.append(input, ' ' + (wire + 1)); field.appendChild(label);
  }
  get('editor-context').appendChild(field); get('editor-context').hidden = false; get('editor-tools').hidden = true;
}

if (signals) for (const button of get('editor-tools').querySelectorAll('[data-editor-tool]')) {
  const tool = button.dataset.editorTool;
  button.setAttribute('aria-label', button.textContent);
  if (['H', 'X', 'Z', 'SWAP'].includes(tool)) button.replaceChildren(operationIcon({ gate: tool, wires: tool === 'SWAP' ? [0, 1] : [0] }));
  else if (tool === 'control') button.replaceChildren(operationIcon({ gate: 'Z', wires: [0] }));
  else if (tool === 'hole') button.textContent = '□';
}

get('categorical-board').addEventListener('click', event => attempt(() => {
  const cell = event.target.closest('[data-cell]');
  if (!cell || mode === 'tutorial' || review.step !== null) return;
  if (editing && editor) { editor.handleCell(Number(cell.dataset.wire), Number(cell.dataset.column)); return; }
  if (signals) { if (cell.dataset.hole !== undefined) { selectedHole = Number(cell.dataset.hole); render(); } return; }
  if (suppressClick) { suppressClick = false; return; }
  if (selected.has(cell.dataset.cell)) selected.delete(cell.dataset.cell); else selected.add(cell.dataset.cell);
  renderSelection();
}));
get('categorical-board').addEventListener('pointerdown', event => {
  const cell = event.target.closest('[data-cell]');
  if (signals || mode === 'tutorial' || review.step !== null || !cell || event.button !== 0 || event.pointerType === 'touch') return;
  drag = { wire: Number(cell.dataset.wire), column: Number(cell.dataset.column), moved: false };
});
get('categorical-board').addEventListener('pointerover', event => {
  const cell = event.target.closest('[data-cell]');
  if (!drag || !cell || !(event.buttons & 1)) return;
  const wire = Number(cell.dataset.wire), column = Number(cell.dataset.column);
  if (wire === drag.wire && column === drag.column && !drag.moved) return;
  drag.moved = true; selected.clear();
  for (let y = Math.min(wire, drag.wire); y <= Math.max(wire, drag.wire); y++)
    for (let x = Math.min(column, drag.column); x <= Math.max(column, drag.column); x++) selected.add(y + ':' + x);
  renderSelection();
});
window.addEventListener('pointerup', event => {
  suppressClick = Boolean(drag?.moved && event.target.closest?.('#categorical-board'));
  drag = null;
});
window.addEventListener('pointercancel', () => { drag = null; suppressClick = false; });
get('categorical-board').addEventListener('contextmenu', event => {
  const cell = event.target.closest('[data-cell]');
  if (!cell || editing || mode === 'tutorial') return;
  event.preventDefault();
  if (signals && cell.dataset.hole !== undefined) attempt(() => { selectedHole = Number(cell.dataset.hole); place('I'); });
  else { selected.clear(); renderSelection(); }
});
get('gate-palette').addEventListener('click', event => {
  const choice = event.target.closest('[data-choice]'); if (choice) attempt(() => place(choice.dataset.choice));
});
if (signals) get('flow-scroll').addEventListener('scroll', () => pinFlowLabels(get('signal-flow'), get('flow-scroll').scrollLeft), { passive: true });
on('replay', review.play); on('resume-round', () => { review.clear(); render(); });
on('show-rules', () => get('rules-dialog').showModal()); on('close-rules', () => get('rules-dialog').close());
on('close-win', () => get('win-dialog').close()); on('try-again', reset);
on('result-next', () => mode === 'campaign' ? selectLevel(levelIndex + 1) : newPuzzle());
document.addEventListener('keydown', event => {
  if (mode === 'tutorial' || editing || ignoresGameShortcut(event)) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); get('undo').click(); }
  else if (signals && /^[ihxz]$/i.test(event.key)) attempt(() => place(event.key.toUpperCase()));
  else if (!signals && event.key === 'Enter' && available.length === 1) { event.preventDefault(); attempt(() => playMove(available[0])); }
  else if (event.key === 'Escape') { selected.clear(); renderSelection(); }
});
window.addEventListener('pagehide', () => { clearTimeout(winTimer); review.clear(); json.close(); guide.leave(); });
window.addEventListener('pageshow', event => { if (event.persisted) { if (mode === 'tutorial') setupTutorial(); else render(); } });
setupTutorial();
