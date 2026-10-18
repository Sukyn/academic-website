import { RULES, validateCircuit, getLegalMoves, applyMove, isSolved, isIdentity, selectionCells, holeOperation, gateCells, moveCost } from '../lib/categorical-circuits/engine.js';
import { getLevels, getTutorial, randomIdentity, generateSignals, validateSignals, fillSignals, signalsSolved, signalsData, solveSignals } from '../lib/categorical-circuits/puzzles.js';
import { renderCircuit, renderRulePreview, renderAdvancedFlow, operationIcon, operationLabel } from '../lib/categorical-circuits/rendering.js';
import { createCircuitEditor } from '../lib/categorical-circuits/editor.js';
import { createCustomPuzzleJson } from '../lib/games/custom-puzzle-json.js';
import { createTutorial } from '../lib/games/tutorial.js';
import { createStepReplay } from '../lib/games/step-replay.js';
import { createCircuitViewport } from '../lib/games/circuit-viewport.js';
import { createPuzzleResult } from '../lib/games/puzzle-result.js';
import { createScoreboard } from '../lib/games/scoreboard.js';
import { expandSelection, toggleSelection } from '../lib/games/circuit-selection.js';
import { bindGameDialogs, updateModeMenu, handleRoundShortcut, handleGateShortcut, directionalControl, rectangleCells } from '../lib/games/controls.js';
import { renderCircuitInstruction } from '../lib/games/tutorial-gates.js';
import { pinFlowLabels, highlightFlowBits, highlightFlowColumn, signalBoardWidth } from '../lib/quantum-signals/rendering.js';
import { animateFlow, flowElements } from '../lib/quantum-signals/animation.js';

const root = document.querySelector('[data-categorical-game]');
const get = id => document.getElementById(id);
const on = (id, action) => get(id).addEventListener('click', () => attempt(action));
const kind = root.dataset.kind, signals = kind === 'signals';
const profile = get('circuit-category').value === 'controlled' ? 'controlled' : 'prop';
let mode = 'tutorial', levelIndex = 0, levels, puzzle, circuit, placements = [];
let editing = false, editorModel, states = [], selectedHole = 0, guide, winTimer, shots = 0;
let selected = new Set(), selectionAnchor = null, available = [], drag, suppressClick = false, context = new Set();
let autofocus = false, flowAnimation = null;
const steps = [], ruleButtons = new Map();
const snapshot = move => signals ? { placements } : { circuit, shots, ...(move ? { move } : {}) };
const linkedCells = key => gateCells(circuit, key, { profile });
const evaluate = createPuzzleResult((puzzle, placements) => signalsSolved(puzzle, placements, profile));
const won = () => signals ? evaluate(puzzle, placements) : isSolved(circuit);
const scores = createScoreboard({
  get, completionOnly: signals,
  selector: () => mode === 'campaign' ? { game: `${signals ? 'quantum-signals' : 'circuit-reduction'}-${profile}`, level: levelIndex + 1 } : null,
  canSubmit: () => mode === 'campaign' && !editing && review.step === null && !flowAnimation && won(),
  sequence: () => signals ? placements.flatMap((gate, hole) => [{ hole, gate }]) : states.slice(1).map(state => state.move),
  update: () => render({ board: false }),
});

function attempt(action) {
  try { action(); get('status').textContent = ''; }
  catch (error) { get('status').textContent = error.message; }
}

const review = createStepReplay({
  length: () => states.length - 1, canReview: () => mode !== 'tutorial' && !editing && states.length > 1,
  onEnter() { clearTimeout(winTimer); get('win-dialog').close(); selected.clear(); },
  onChange: () => { render(); if (signals) viewport.follow(holeButton(visibleHole()), review.step === states.length - 1 && won()); },
});
const holeButton = index => get('categorical-board').querySelector(`[data-hole="${index}"]`);
const viewport = signals ? createCircuitViewport(get('categorical-scroll'), get('flow-scroll'), left => pinFlowLabels(get('signal-flow'), left)) : null;

function visibleHole() {
  if (review.step === null) return selectedHole;
  if (review.step === 0) return 0;
  const before = states[review.step - 1].placements, after = states[review.step].placements;
  const changed = puzzle.holes.findIndex((_, index) => before[index] !== after[index] ||
    Object.hasOwn(before, index) !== Object.hasOwn(after, index));
  return changed < 0 ? 0 : changed;
}

function selectHole(index, focus = false) {
  if (index === selectedHole || mode === 'tutorial' || editing || review.step !== null) return;
  selectedHole = index; render({ board: false }); viewport.follow(holeButton(index));
  if (focus) holeButton(index)?.focus({ preventScroll: true });
}

function navigateHole(key) {
  const current = holeButton(selectedHole);
  const candidates = puzzle.holes.map((_, index) => holeButton(index));
  const next = directionalControl(current, candidates, key);
  if (next) selectHole(Number(next.dataset.hole), true);
}

const editor = signals ? createCircuitEditor({ get, profile: () => profile,
  onChange(model) { editorModel = model; if (editing) render(); } }) : null;

const json = createCustomPuzzleJson({
  get, game: signals ? 'quantum-signals' : 'circuit-simplification',
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
  scores.reset();
  drag = null; suppressClick = false;
  editing = false; editor?.close(); editorModel = undefined;
  mode = nextMode; puzzle = next;
  if (!signals) circuit = validateCircuit(next.circuit, profile);
  placements = []; shots = 0; states = [snapshot()]; selected.clear(); selectionAnchor = null; context.clear(); selectedHole = 0;
  render(); void scores.load();
}

function checkMoveLimit() {
  if (states.length > 1000) throw new RangeError('Undo or reset before adding more moves.');
}

function afterMove(move, column) {
  states.push(snapshot(move)); selected.clear(); selectionAnchor = null; render({ animateFrom: column });
  if (signals && autofocus) viewport.follow(holeButton(selectedHole), won());
  clearTimeout(winTimer);
  const current = states.at(-1), finished = flowAnimation?.finished;
  const offerResult = () => {
    if (states.at(-1) !== current || editing || mode === 'tutorial' || !won()) return;
    winTimer = setTimeout(() => {
      if (states.at(-1) !== current || review.step !== null) return;
      openWin();
    }, 500);
  };
  if (finished) finished.then(completed => { if (completed) offerResult(); }); else offerResult();
  return finished;
}

function playMove(move) {
  if (review.step !== null || (mode === 'tutorial' && !guide.executing)) return;
  const next = applyMove(circuit, move, { profile });
  if (move.rule === 'tidy' && next.columns.length === circuit.columns.length) return;
  checkMoveLimit(); circuit = next;
  shots += moveCost(move);
  afterMove(move);
}

function place(gate) {
  if (editing || review.step !== null || (mode === 'tutorial' && !guide.executing)) return;
  const hole = puzzle.holes[selectedHole];
  if (!hole || (gate !== null && !hole.choices.includes(gate)) ||
    (Object.hasOwn(placements, selectedHole) ? placements[selectedHole] : null) === gate) return;
  checkMoveLimit(); placements = placements.slice();
  if (gate === null) delete placements[selectedHole]; else placements[selectedHole] = gate;
  const column = puzzle.columns.length + selectedHole;
  if (autofocus && gate !== null) {
    const next = puzzle.holes.findIndex((_, index) => !Object.hasOwn(placements, index));
    if (next >= 0) selectedHole = next;
  }
  return afterMove(null, column);
}

function openWin() {
  if (mode === 'tutorial' || editing || flowAnimation || !won() || get('win-dialog').open) return;
  const reviewing = review.step !== null;
  review.clear(); render({ board: reviewing }); scores.autoSubmit(); get('win-dialog').showModal();
  get(scores.automatic ? 'close-win' : get('score-form').hidden ? 'try-again' : 'player-name').focus();
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
      renderRulePreview(miniature, rule.wires, pattern);
      miniature.setAttribute('aria-hidden', 'true'); button.appendChild(miniature);
    }
    button.addEventListener('click', () => attempt(() => {
      const move = available.find(move => move.rule === rule.id);
      if (move) playMove(move);
    }));
    get('rule-list').appendChild(button); ruleButtons.set(rule.id, button);
  }
}

function markSelection(activeCells) {
  for (const cell of get('categorical-board').querySelectorAll('[data-cell]')) {
    const active = activeCells.has(cell.dataset.cell);
    cell.classList.toggle('is-selected', active); cell.setAttribute('aria-pressed', String(active));
  }
}

function renderSelection() {
  if (signals) return;
  markSelection(selected);
  available = selected.size ? getLegalMoves(circuit, { profile, selection: selected }) : [];
  if (editing) {
    const controls = JSON.stringify([...context].sort((a, b) => a - b));
    available = available.filter(move => Boolean(move.reverse) === get('reverse-rule').checked && JSON.stringify(move.controls ?? []) === controls);
  }
  for (const input of get('editor-context').querySelectorAll('input')) {
    input.checked = context.has(Number(input.value));
    input.disabled = Number(input.value) >= circuit.wires;
  }
  const matchedRules = new Set(available.map(move => move.rule));
  for (const [id, button] of ruleButtons) button.disabled = review.step !== null || !matchedRules.has(id);
}

function render({ board = true, animateFrom } = {}) {
  if (!puzzle) return;
  const focused = document.activeElement?.closest('#categorical-board [data-hole], #gate-palette [data-choice]');
  const reviewed = review.step === null ? null : states[review.step];
  const activePlacements = reviewed?.placements ?? placements;
  const activeHole = signals ? visibleHole() : 0;
  const activeCells = editing && editor ? editorModel.selectedCells : signals ?
    new Set(puzzle.holes[activeHole].wires.map(wire => wire + ':' + (puzzle.columns.length + activeHole))) : selected;
  let previousFlow;
  if (board) {
    flowAnimation?.cancel(); flowAnimation = null;
    const shown = editing && editor ? editorModel?.circuit : signals ? fillSignals(puzzle, activePlacements, profile) : reviewed?.circuit ?? circuit;
    if (!shown) return;
    const holes = editing && editor ? editorModel.holes : signals ? puzzle.holes : [];
    previousFlow = signals && animateFrom !== undefined ? flowElements(get('signal-flow')) : null;
    renderCircuit(get('categorical-board'), shown, { selectedCells: activeCells,
      holes, fixedColumns: editing && editor ? editorModel.fixedColumns : signals ? puzzle.columns.length : shown.columns.length,
      locked: review.step !== null, width: signals ? signalBoardWidth(shown.columns.length) : undefined });
    if (signals) renderAdvancedFlow(get('signal-flow'), get('signal-target'), shown, editing ? editorModel.target : puzzle.target,
      { profile, selectedColumn: editing ? undefined : puzzle.columns.length + activeHole });
  } else {
    markSelection(activeCells);
    if (signals) highlightFlowColumn(get('signal-flow'), puzzle.columns.length + activeHole);
  }
  if (signals) {
    const hole = !editing && puzzle.holes[activeHole];
    highlightFlowBits(get('signal-flow'), hole?.controls ?? []);
    get('gate-palette').replaceChildren(...(hole ? hole.choices.map((gate, index) => {
      const operation = holeOperation(hole, gate);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'button ghost';
      button.dataset.choice = gate; button.setAttribute('aria-label', operationLabel(operation));
      button.setAttribute('aria-pressed', String(activePlacements[activeHole] === gate));
      button.setAttribute('aria-keyshortcuts', String(index + 1) + (gate.length === 1 ? ' ' + gate : ''));
      button.disabled = review.step !== null;
      button.appendChild(operationIcon(operation)); return button;
    }) : []));
    get('erase-gate').hidden = editing || !Object.hasOwn(activePlacements, activeHole);
    get('erase-gate').disabled = review.step !== null || !Object.hasOwn(placements, selectedHole);
    get('autofocus').hidden = editing;
    get('autofocus').disabled = review.step !== null;
    get('autofocus').setAttribute('aria-pressed', String(autofocus));
    if (focused?.dataset.choice) (get('gate-palette').querySelector(`[data-choice="${focused.dataset.choice}"]`) ?? holeButton(activeHole))?.focus({ preventScroll: true });
    else if (focused?.dataset.hole !== undefined) holeButton(activeHole)?.focus({ preventScroll: true });
  } else renderSelection();
  updateModeMenu(get, mode);
  get('campaign-controls').hidden = mode !== 'campaign'; get('level').value = String(levelIndex + 1);
  const count = reviewed?.shots ?? shots;
  get('move-count').textContent = `${count} ${count === 1 ? 'move' : 'moves'}`;
  get('previous-level').disabled = levelIndex === 0;
  get('next-level').disabled = scores.submitting || mode !== 'campaign' || !won() || levelIndex === levels.length - 1;
  get('custom-controls').hidden = mode !== 'random';
  get('editor-controls').hidden = !editing;
  get('edit-circuit').hidden = get('new-circuit').hidden = mode !== 'random' || editing;
  get('play-custom').hidden = !editing;
  get('reverse-rule').closest('label').hidden = signals || !editing;
  get('undo').disabled = states.length <= 1 || editing && signals;
  get('restart').disabled = editing;
  get('tidy').hidden = get('add-space').hidden = signals;
  get('tidy').disabled = get('add-space').disabled = review.step !== null;
  get('replay').hidden = mode === 'tutorial' || editing || states.length <= 1;
  get('replay').disabled = review.playing;
  get('review-controls').hidden = review.step === null;
  get('review-note').textContent = review.step === null ? '' : `Step ${review.step} / ${states.length - 1}`;
  const complete = mode !== 'tutorial' && !editing && won();
  const showForm = complete && mode === 'campaign' && !scores.player && !scores.automatic;
  get('leaderboard-section').hidden = mode !== 'campaign';
  get('show-results').hidden = !complete;
  get('show-results').disabled = Boolean(flowAnimation);
  get('score-form').hidden = !showForm;
  get('win-results').hidden = !scores.player;
  for (const id of ['player-name', 'submit-score']) get(id).disabled = scores.submitting || !showForm;
  get('result-actions').hidden = false;
  get('result-next').hidden = mode === 'campaign' && levelIndex === levels.length - 1;
  get('result-next').disabled = scores.submitting;
  get('result-next').textContent = mode === 'campaign' ? 'Next level' : 'New puzzle';
  get('replay-result').disabled = states.length <= 1 || review.playing;
  get('win-summary').textContent = signals ? 'The output matches the target.' : `Identity reached in ${shots} ${shots === 1 ? 'move' : 'moves'}.`;
  json.update({ visible: mode === 'random', canShare: !editing || signals || !isSolved(circuit) });
  guide?.render();
  if (previousFlow) {
    const job = flowAnimation = animateFlow(get('signal-flow'), previousFlow, animateFrom);
    get('show-results').disabled = true;
    job.finished.then(() => {
      if (flowAnimation !== job) return;
      flowAnimation = null; get('show-results').disabled = false; guide?.render();
    });
  }
}

function startEditor(fresh) {
  if (signals) editor.open(fresh ? undefined : puzzle);
  guide.leave(); review.clear(); clearTimeout(winTimer); get('win-dialog').close();
  scores.reset();
  editing = true; mode = 'random'; shots = 0; selected.clear(); selectionAnchor = null; context.clear();
  if (!signals) {
    circuit = fresh ? { wires: 3, columns: Array.from({ length: 6 }, () => []) } : validateCircuit(puzzle.circuit, profile);
    get('reverse-rule').checked = true;
    get('editor-wires').value = String(circuit.wires); get('editor-columns').value = String(circuit.columns.length);
  }
  states = [snapshot()];
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
      if (signals) viewport.follow(holeButton(selectedHole));
    },
    action() { return signals ? place(step.gate) : playMove(step.move); },
  })));
  guide.enter();
}

guide = createTutorial({ get, steps,
  controls: '#categorical-board button, #rule-list button, #gate-palette button, #erase-gate, #autofocus, #undo, #restart, #tidy, #add-space',
  isBlocked: () => Boolean(flowAnimation),
  renderText: (node, text) => renderCircuitInstruction(node, text),
  intro: get('tutorial-text').textContent,
  onReset() { load(getTutorial(profile, kind), 'tutorial'); },
});

makeRuleButtons(); populateLevels();
on('mode-tutorial', setupTutorial); on('mode-campaign', () => selectLevel(levelIndex)); on('mode-random', newPuzzle);
on('previous-level', () => selectLevel(levelIndex - 1)); on('next-level', () => selectLevel(levelIndex + 1));
get('level').addEventListener('change', () => attempt(() => selectLevel(Number(get('level').value) - 1)));
on('new-puzzle', newPuzzle); on('restart', reset);
on('undo', () => {
  if (mode === 'tutorial' || editing && signals || states.length <= 1) return;
  clearTimeout(winTimer); review.clear(); get('win-dialog').close();
  scores.reset();
  states.pop(); const previous = states.at(-1);
  if (signals) placements = previous.placements; else { circuit = previous.circuit; shots = previous.shots; }
  selected.clear(); selectionAnchor = null; render(); void scores.load();
});
on('tidy', () => playMove({ rule: 'tidy' }));
on('add-space', () => playMove({ rule: 'insert-column', column: selected.size ? Math.min(...[...selected].map(key => Number(key.split(':')[1]))) : circuit.columns.length }));
on('edit-circuit', () => startEditor(false)); on('new-circuit', () => startEditor(true));
on('play-custom', () => {
  if (signals) {
    load(editor.puzzle(), 'random');
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
  shots = 0; states = [snapshot()]; selected.clear(); selectionAnchor = null; context.clear(); render();
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
  if (signals) { if (cell.dataset.hole !== undefined) selectHole(Number(cell.dataset.hole)); return; }
  if (suppressClick && event.detail !== 0) { suppressClick = false; return; }
  suppressClick = false;
  if (event.shiftKey && selectionAnchor) selected = expandSelection(rectangleCells(selectionAnchor, cell.dataset.cell), linkedCells);
  else {
    selectionAnchor = cell.dataset.cell;
    selected = toggleSelection(selected, linkedCells(cell.dataset.cell), linkedCells);
  }
  renderSelection();
}));
get('categorical-board').addEventListener('pointerdown', event => {
  const cell = event.target.closest('[data-cell]');
  if (signals || mode === 'tutorial' || review.step !== null || !cell || event.button !== 0 || event.pointerType === 'touch') return;
  drag = { anchor: event.shiftKey && selectionAnchor ? selectionAnchor : cell.dataset.cell,
    x: event.clientX, y: event.clientY, moved: false };
});
get('categorical-board').addEventListener('pointerover', event => {
  const cell = event.target.closest('[data-cell]');
  if (!drag || !cell || !(event.buttons & 1)) return;
  if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
  drag.moved = true; selectionAnchor = drag.anchor;
  selected = expandSelection(rectangleCells(drag.anchor, cell.dataset.cell), linkedCells);
  renderSelection();
});
window.addEventListener('pointerup', event => {
  suppressClick = Boolean(drag?.moved && event.target.closest?.('#categorical-board'));
  drag = null;
});
window.addEventListener('pointercancel', () => { drag = null; suppressClick = false; });
window.addEventListener('blur', () => { drag = null; suppressClick = false; });
get('categorical-board').addEventListener('contextmenu', event => {
  const cell = event.target.closest('[data-cell]');
  if (!cell || editing || mode === 'tutorial' || review.step !== null) return;
  event.preventDefault();
  if (signals && cell.dataset.hole !== undefined) attempt(() => { selectHole(Number(cell.dataset.hole)); place(null); });
  else if (!signals && !circuit.columns[Number(cell.dataset.column)].length) attempt(() => playMove({ rule: 'remove-column', column: Number(cell.dataset.column) }));
  else { selected.clear(); selectionAnchor = null; renderSelection(); }
});
get('gate-palette').addEventListener('click', event => {
  const choice = event.target.closest('[data-choice]'); if (choice) attempt(() => place(choice.dataset.choice));
});
if (signals) {
  get('categorical-board').addEventListener('focusin', event => {
    const hole = event.target.closest('[data-hole]');
    if (hole) selectHole(Number(hole.dataset.hole));
  });
  on('erase-gate', () => place(null));
  on('autofocus', () => { if (mode !== 'tutorial' && !editing && review.step === null) { autofocus = !autofocus; render({ board: false }); } });
}
on('replay', review.play); on('replay-result', review.play); on('show-results', openWin); on('resume-round', () => {
  review.clear(); render();
  if (signals) viewport.follow(holeButton(selectedHole), won());
});
bindGameDialogs(get);
get('score-form').addEventListener('submit', scores.submit);
on('try-again', reset);
on('result-next', () => mode === 'campaign' ? selectLevel(levelIndex + 1) : newPuzzle());
document.addEventListener('keydown', event => {
  if (handleRoundShortcut(event, { blocked: mode === 'tutorial' || signals && editing,
    undo: () => get('undo').click(), reset })) return;
  const inGame = event.target.closest('#categorical-board, #gate-palette, #erase-gate, #autofocus') || event.target === get('categorical-scroll');
  if (signals) {
    handleGateShortcut(event, { blocked: !inGame || review.step !== null,
      choices: puzzle.holes[selectedHole].choices, place: gate => attempt(() => place(gate)),
      erase: () => attempt(() => place(null)), navigate: navigateHole });
  } else if (review.step === null) {
    const cell = event.target.closest('[data-cell]');
    if (event.key === 'Enter' && inGame && available.length === 1) {
      event.preventDefault(); attempt(() => playMove(available[0]));
      if (cell) get('categorical-board').querySelector(`[data-cell="${cell.dataset.cell}"]`)?.focus();
    } else if (event.key === 'Delete' && cell && !circuit.columns[Number(cell.dataset.column)].length) {
      event.preventDefault(); attempt(() => playMove({ rule: 'remove-column', column: Number(cell.dataset.column) }));
    } else if (event.key === 'Escape') {
      selected.clear(); selectionAnchor = null; drag = null; renderSelection();
    }
  }
});
window.addEventListener('pagehide', () => { clearTimeout(winTimer); flowAnimation?.cancel(); review.clear(); scores.dispose(); json.close(); guide.leave(); drag = null; });
window.addEventListener('pageshow', event => { if (event.persisted) { if (mode === 'tutorial') setupTutorial(); else { render(); void scores.load(); } } });
setupTutorial();
