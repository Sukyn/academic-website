import { getRule, LEARNED_RULE_IDS, cloneCircuit, circuitKey, applyMove, getLegalMoves, isSolved, validateCircuit, moveCost, sequenceCost } from '../lib/circuit-reduction/engine.js';
import { customCircuit, identityCircuit } from '../lib/circuit-reduction/custom.js';
import { generatePuzzle } from '../lib/circuit-reduction/generator.js';
import { spaceGlyph, circuitWires } from '../lib/circuit-reduction/rendering.js';
import { gateGlyph } from '../lib/games/circuit-graphics.js';
import { LEVELS, DAILY_START } from '../lib/circuit-reduction/puzzles.js';
import { createScoreboard } from '../lib/games/scoreboard.js';
import { createDailySession } from '../lib/games/daily-session.js';
import { startDailyFromLink } from '../lib/games/daily-links.js';
import { createReplayShare } from '../lib/games/replay-share.js';
import { createStepReplay } from '../lib/games/step-replay.js';
import { formatPuzzleDate, bindDailyControls } from '../lib/games/daily-ui.js';
import { createCustomPuzzleJson } from '../lib/games/custom-puzzle-json.js';
import { bindGameDialogs, ignoresGameShortcut, updateModeMenu } from '../lib/games/controls.js';
import { createTutorial } from '../lib/games/tutorial.js';
import { renderCircuitInstruction } from '../lib/games/tutorial-gates.js';
import { TUTORIAL_CIRCUIT, TUTORIAL_STEPS } from '../lib/circuit-reduction/tutorial.js';

const GAME = 'circuit-reduction';
const get = id => document.getElementById(id);
const onClick = (id, callback) => get(id).addEventListener('click', callback);
const winDialog = get('win-dialog');
const ruleButtons = [...document.querySelectorAll('[data-rule]')];
const cellNames = { '.': 'empty slot', H: 'H', X: 'X', Z: 'Z', ZU: 'upper Z endpoint', ZD: 'lower Z endpoint', XU: 'upper X endpoint', XD: 'lower X endpoint' };
let mode = 'campaign', level = LEVELS[0], campaignLevel = level, editing = false;
let circuit = level.circuit, sequence = [], states = [circuit];
let boardLocked;
const selection = new Set();
let searchWorker, guide;
const tutorialLocked = () => guide?.active && !guide.executing;
let touchPress, selectionDrag, selectionAnchor = null, suppressBoardClick = false;
function cancelTouchPress() { clearTimeout(touchPress?.timer); touchPress = null; }
function cancelSelectionDrag() {
  const drag = selectionDrag; selectionDrag = null;
  if (drag?.target.hasPointerCapture?.(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId);
}
function clearSelection() { cancelSelectionDrag(); selection.clear(); selectionAnchor = null; }
function cancelSearch() { searchWorker?.terminate(); searchWorker = null; }
const sharing = createReplayShare({ get,
  createWorker: () => new Worker(new URL('./circuit-reduction-gif-worker.js', import.meta.url), { type: 'module' }),
});
const customJson = createCustomPuzzleJson({ get, game: 'circuit-simplification',
  exportPuzzle: () => ({ circuit: cloneCircuit(editing ? circuit : level.circuit) }),
  importPuzzle: value => playCustom(customCircuit(value)),
});
const canScore = () => Boolean(level && (mode === 'campaign' || (mode === 'daily' && level.acceptingScores && daily.serverTime() >= level.opensAt && daily.serverTime() < level.closesAt)));
const selector = () => ({ game: GAME, ...(mode === 'daily' ? { date: level.date } : { level: level.id }) });
const allowedRules = () => mode === 'campaign' ? level.allowedRules ?? LEARNED_RULE_IDS : LEARNED_RULE_IDS;
const scores = createScoreboard({
  get, selector: () => mode === 'campaign' || mode === 'daily' ? selector() : null,
  benchmark: () => ({ optimalMoves: level?.optimalMoves ?? level?.parMoves,
    benchmarkLabel: level?.optimalMoves == null ? 'Best known' : 'Optimal' }),
  canSubmit: () => !daily.loading && canScore() && isSolved(circuit),
  sequence: () => sequence, update: () => update({ board: false }),
  onDailyClosed: () => { level.acceptingScores = false; daily.load(level.date, false); },
});
const daily = createDailySession({
  game: GAME, startDate: DAILY_START, get, update: () => update({ board: false }),
  validatePuzzle: puzzle => ({ ...puzzle, circuit: validateCircuit(puzzle.circuit) }),
  selectedDate: () => mode === 'daily' ? level.date : undefined,
  onPuzzle(info, select) {
    if (select && (mode !== 'daily' || level.date !== info.date)) {
      guide.leave();
      mode = 'daily';
      editing = false;
      level = { circuit: info.puzzle.circuit, optimalMoves: info.puzzle.optimalMoves,
        date: info.date, opensAt: info.opensAt, closesAt: info.closesAt, acceptingScores: info.acceptingScores };
      cancelSearch(); reset();
    } else if (mode === 'daily' && level.date === info.date) {
      Object.assign(level, { acceptingScores: info.acceptingScores, opensAt: info.opensAt, closesAt: info.closesAt });
      scores.load();
    }
  },
});
const review = createStepReplay({
  length: () => sequence.length, canReview: () => mode !== 'tutorial' && !editing && !daily.loading,
  onEnter: () => { clearSelection(); winDialog.close(); }, onChange: () => update(),
});
guide = createTutorial({
  get, isBlocked: () => daily.loading,
  renderText: (node, text) => renderCircuitInstruction(node, text, { singleWire: true }),
  controls: '[data-cell], [data-space], [data-rule], #undo, #restart, #compact-identities, #replay, #replay-result, #share-score, #share-result, #show-results',
  intro: 'Reach the identity: empty wires that leave every input unchanged. Choose a rule matching the selected gates.',
  onReset: () => setPuzzle('tutorial', { circuit: cloneCircuit(TUTORIAL_CIRCUIT), optimalMoves: null }),
  onLeave: () => { review.clear(); clearSelection(); },
  steps: TUTORIAL_STEPS.map(({ text, target, layout, move }) => ({
    text, target: target ?? `[data-rule="${move.rule}"]`,
    prepare() {
      if (layout) playMove({ rule: 'arrange', row: 0, column: 0, circuit: layout });
      clearSelection();
      const rule = getRule(move.rule);
      if (!rule) return;
      for (let row = 0; row < rule.left.length; row++) {
        for (let column = 0; column < rule.left[0].length; column++) selection.add(`${move.row + row}:${move.column + column}`);
      }
      updateSelection();
      get('circuit-board').querySelector(`[data-cell="${move.row}:${move.column + Math.floor(rule.left[0].length / 2)}"]`)
        ?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
    },
    action() {
      const before = sequence.length;
      playMove(move);
      if (sequence.length === before) throw new Error('The tutorial action could not be applied.');
    },
  })),
});
function matchingSelection() {
  if (!selection.size) return [];
  let row = Infinity, column = Infinity, lastRow = 0, lastColumn = 0;
  for (const cell of selection) {
    const [y, x] = cell.split(':').map(Number);
    row = Math.min(row, y); column = Math.min(column, x);
    lastRow = Math.max(lastRow, y); lastColumn = Math.max(lastColumn, x);
  }
  const height = lastRow - row + 1, width = lastColumn - column + 1;
  if (selection.size !== height * width) return [];
  return getLegalMoves(circuit, { allowedRules: allowedRules(), window: { row, column, height, width } });
}

function updateSelection() {
  for (const cell of get('circuit-board').querySelectorAll('[data-cell]')) cell.setAttribute('aria-pressed', String(selection.has(cell.dataset.cell)));
  update({ board: false });
}
function selectRectangle(start, end) {
  const [firstRow, firstColumn] = start.split(':').map(Number), [lastRow, lastColumn] = end.split(':').map(Number);
  const top = Math.min(firstRow, lastRow), bottom = Math.max(firstRow, lastRow);
  const left = Math.min(firstColumn, lastColumn), right = Math.max(firstColumn, lastColumn);
  selection.clear();
  for (let row = top; row <= bottom; row++) {
    for (let column = left; column <= right; column++) selection.add(`${row}:${column}`);
  }
  updateSelection();
}

function renderCircuit() {
  cancelSelectionDrag(); cancelTouchPress();
  const visible = review.step === null ? circuit : states[review.step];
  const board = get('circuit-board'), fragment = document.createDocumentFragment();
  fragment.appendChild(circuitWires(visible, { gutter: 22, header: 0, slotGaps: true }));
  board.style.setProperty('--columns', visible[0].length);
  board.style.setProperty('--wires', visible.length);
  visible.forEach((row, y) => {
    row.forEach((cell, x) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'circuit-cell'; button.dataset.cell = `${y}:${x}`;
      button.dataset.gate = cell; button.setAttribute('aria-label', `Wire ${y + 1}, column ${x + 1}: ${cellNames[cell]}`);
      button.setAttribute('aria-pressed', String(selection.has(`${y}:${x}`)));
      button.disabled = daily.loading || review.step !== null;
      if (cell !== '.') {
        button.appendChild(gateGlyph(cell));
      }
      fragment.appendChild(button);
    });
    for (let boundary = 0; boundary <= row.length; boundary++) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'space-handle'; button.dataset.space = `${y}:${boundary}`;
      button.setAttribute('aria-label', `Add space before slot ${boundary + 1} on all wires`);
      button.style.setProperty('left', `${22 + boundary * 64}px`); button.style.setProperty('top', `${36 + y * 72}px`);
      button.disabled = daily.loading || review.step !== null;
      if (boundary === 0 || boundary === row.length) button.dataset.edge = boundary === 0 ? 'start' : 'end';
      button.appendChild(spaceGlyph());
      fragment.appendChild(button);
    }
  });
  board.replaceChildren(fragment);
}

function update({ board = true } = {}) {
  const solved = isSolved(circuit), won = !editing && solved, locked = daily.loading || review.step !== null;
  const scorable = canScore(), hasPlayer = Boolean(scores.player);
  if (board) { renderCircuit(); boardLocked = locked; }
  else if (boardLocked !== locked) {
    if (locked) { cancelSelectionDrag(); cancelTouchPress(); }
    for (const button of get('circuit-board').querySelectorAll('button')) button.disabled = locked;
    boardLocked = locked;
  }
  const scoreMoves = sequenceCost(sequence);
  const score = `${scoreMoves} ${scoreMoves === 1 ? 'move' : 'moves'}`;
  get('move-count').textContent = score;
  get('move-count').hidden = editing;
  get('circuit-editor-controls').hidden = !editing;
  get('save-circuit').disabled = locked || solved;
  get('editor-wires').disabled = locked;
  get('create-circuit').hidden = editing;
  const matches = new Set((locked || won ? [] : matchingSelection()).map(move => move.rule));
  const availableRules = allowedRules();
  for (const button of ruleButtons) {
    button.hidden = !availableRules.includes(button.dataset.rule);
    button.disabled = !matches.has(button.dataset.rule);
  }
  const selectionNote = !locked && !won && selection.size && !matches.size ? 'No matching rule' : '';
  get('selection-note').textContent = selectionNote;
  updateModeMenu(get, mode, false, scores.submitting);
  get('campaign-controls').hidden = mode !== 'campaign';
  get('custom-controls').hidden = mode !== 'random';
  customJson.update({ visible: mode === 'random', disabled: daily.loading, canShare: !editing || !solved });
  get('leaderboard-section').hidden = mode === 'random' || mode === 'tutorial';
  get('daily-heading').hidden = mode !== 'daily';
  get('daily-date').disabled = !daily.info;
  if (mode === 'campaign') get('level').value = String(level.id);
  get('previous-level').disabled = daily.loading || mode !== 'campaign' || level.id === 1;
  get('next-level').disabled = daily.loading || scores.submitting || mode !== 'campaign' || !won || level.id === LEVELS.length;
  get('result-next').disabled = get('next-level').disabled;
  get('result-next').hidden = mode !== 'campaign' || level.id === LEVELS.length;
  get('level').disabled = daily.loading;
  get('undo').disabled = daily.loading || !sequence.length;
  get('restart').disabled = daily.loading;
  get('compact-identities').disabled = locked;
  for (const id of ['replay', 'replay-result']) get(id).disabled = editing || daily.loading || !sequence.length || review.playing;
  get('replay').hidden = mode === 'tutorial' || editing || !sequence.length;
  get('replay-actions').hidden = get('replay').hidden;
  for (const id of ['share-score', 'share-result']) { get(id).hidden = mode === 'tutorial' || !won || !sequence.length; get(id).disabled = daily.loading; }
  for (const [share, daily, regular] of [
    [get('share-score'), get('daily-replay-actions'), get('replay-actions')],
    [get('share-result'), get('daily-result-actions'), get('result-replay-actions')],
  ]) {
    const destination = mode === 'daily' ? daily : regular;
    if (share.parentElement !== destination) destination.appendChild(share);
    daily.hidden = mode !== 'daily' || share.hidden;
  }
  get('review-controls').hidden = review.step === null;
  get('review-note').textContent = review.step === null ? '' : `Step ${review.step} / ${sequence.length}`;
  get('show-results').hidden = mode === 'tutorial' || !won || !sequence.length;
  get('show-results').textContent = scorable || hasPlayer ? 'Scores' : 'Result';
  const showForm = scorable && !hasPlayer && !scores.automatic;
  get('score-form').hidden = !showForm;
  get('win-results').hidden = !hasPlayer;
  get('win-practice').hidden = mode !== 'daily' || scorable || hasPlayer;
  get('result-actions').hidden = showForm;
  for (const id of ['player-name', 'submit-score']) get(id).disabled = daily.loading || Boolean(scores.submitting) || !showForm;
  get('win-summary').textContent = scoreMoves === level?.optimalMoves ? `Optimal solution in ${score}.`
    : level?.optimalMoves != null ? `${score} : optimum+${scoreMoves - level.optimalMoves}` : `Circuit reduced in ${score}.`;
  if (mode === 'daily') {
    get('daily-title').textContent = `Daily puzzle · ${formatPuzzleDate(level.date)}`;
    get('daily-note').textContent = scorable ? 'Scores close at midnight (Paris).' : 'Practice · leaderboard closed.';
  }
  guide?.render();
}

function resetScore() {
  sharing.close(); scores.reset(); winDialog.close();
}
function reset() {
  if (tutorialLocked() || daily.loading) return;
  cancelTouchPress(); suppressBoardClick = false; review.clear(); resetScore(); clearSelection();
  circuit = level.circuit; sequence = []; states = [circuit]; get('status').textContent = ''; update();
  if (mode !== 'tutorial') scores.load();
}
function playMove(move) {
  if (tutorialLocked()) return;
  const free = moveCost(move) === 0, wasWon = !editing && isSolved(circuit);
  if (daily.loading || (!free && (review.step !== null || wasWon)) || (!free && !allowedRules().includes(move.rule))) return;
  if (free && review.step !== null) review.clear();
  try {
    const next = applyMove(circuit, move);
    if ((move.rule === 'compact-identities' || move.rule === 'arrange') && circuitKey(next) === circuitKey(circuit)) {
      get('status').textContent = ''; return;
    }
    // applyMove never mutates its input, so history can retain each result directly.
    circuit = next; sequence.push({ ...move }); states.push(circuit); clearSelection();
    get('status').textContent = ''; update();
    if (!editing && isSolved(circuit) && !wasWon) openWin();
  } catch (error) { get('status').textContent = error.message; }
}
function openWin() {
  if (mode === 'tutorial' || editing || !isSolved(circuit) || !sequence.length || winDialog.open) return;
  review.clear(); update(); scores.autoSubmit(); winDialog.showModal();
  get(scores.automatic ? 'close-win' : canScore() && !scores.player ? 'player-name' : 'try-again').focus();
}
function setPuzzle(nextMode, puzzle, editor = false) {
  if (nextMode !== 'tutorial') guide.leave();
  daily.cancel(); cancelSearch();
  get('custom-status').textContent = '';
  mode = nextMode; level = puzzle; editing = editor; if (mode === 'campaign') campaignLevel = level;
  reset();
}
function selectLevel(id) { const next = LEVELS.find(item => item.id === Number(id)); if (next) setPuzzle('campaign', next); }
function randomCircuit() {
  const { circuit, optimalMoves } = generatePuzzle(`${Date.now()}:${Math.random()}`, Number(get('difficulty').value));
  setPuzzle('random', { circuit, optimalMoves });
}
function createCircuit() {
  try { setPuzzle('random', { circuit: identityCircuit(Number(get('editor-wires').value)), optimalMoves: null }, true); }
  catch (error) { get('custom-status').textContent = error.message; }
}

function playCustom(custom) {
  setPuzzle('random', { circuit: custom, optimalMoves: null });
  get('custom-status').textContent = 'Finding a shortest solution…';
  try {
    searchWorker = new Worker(new URL('./circuit-reduction-worker.js', import.meta.url), { type: 'module' });
  } catch {
    get('custom-status').textContent = 'Identity verified. Shortest solution is unavailable in this browser.';
    return;
  }
  const worker = searchWorker;
  const finish = result => {
    if (worker !== searchWorker) return;
    worker.terminate(); searchWorker = null;
    if (result && !Array.isArray(result) && result.status === 'optimal' && Number.isSafeInteger(result.optimalMoves) && result.optimalMoves > 0) { level.optimalMoves = result.optimalMoves; get('custom-status').textContent = `Shortest solution: ${result.optimalMoves} moves.`; }
    else get('custom-status').textContent = 'Identity verified. Shortest solution not determined within the search limit.';
    update({ board: false });
  };
  worker.onmessage = ({ data }) => finish(data);
  worker.onerror = event => { event?.preventDefault(); finish(); };
  worker.onmessageerror = () => finish();
  try { worker.postMessage({ circuit: custom }); } catch { finish(); }
}

function share(source) {
  if (mode === 'tutorial' || editing || daily.loading || !isSolved(circuit) || !sequence.length) return;
  sharing.open(source, { label: mode === 'daily' ? `Daily puzzle : ${formatPuzzleDate(level.date)}` : mode === 'campaign' ? `Level : ${level.id}` : 'Custom circuit', circuit: cloneCircuit(level.circuit), sequence: sequence.map(move => ({ ...move })), optimalMoves: level?.optimalMoves ?? null }, `circuit-simplification-${level?.date ?? (mode === 'campaign' ? `level-${level.id}` : 'custom')}.gif`);
}

get('circuit-board').addEventListener('click', event => {
  if (tutorialLocked() || daily.loading || review.step !== null) return;
  if (suppressBoardClick && event.detail !== 0) { suppressBoardClick = false; return; }
  suppressBoardClick = false;
  const space = event.target.closest('button[data-space]');
  if (space) {
    const [, column] = space.dataset.space.split(':').map(Number);
    playMove({ rule: 'insert-column', row: 0, column });
    if (event.detail === 0) [...get('circuit-board').querySelectorAll('[data-space]')].find(button => button.dataset.space === space.dataset.space)?.focus({ preventScroll: true });
    return;
  }
  const cell = event.target.closest('button[data-cell]');
  if (!cell || cell.disabled) return;
  if (event.shiftKey && selectionAnchor) { selectRectangle(selectionAnchor, cell.dataset.cell); return; }
  const key = selectionAnchor = cell.dataset.cell;
  if (selection.has(key)) selection.delete(key); else selection.add(key);
  // Keep the tapped/focused cell in place; updating selection should not rebuild the board.
  updateSelection();
});
function removeSpace(row, column) {
  if (circuit[row]?.[column] === '.') playMove({ rule: 'remove-space', row, column });
}
get('circuit-board').addEventListener('contextmenu', event => {
  event.preventDefault();
  if (tutorialLocked() || daily.loading || review.step !== null || suppressBoardClick) return;
  const cell = event.target.closest('button[data-cell]'), space = event.target.closest('button[data-space]');
  if (cell) removeSpace(...cell.dataset.cell.split(':').map(Number));
  else if (space) { const [row, boundary] = space.dataset.space.split(':').map(Number); removeSpace(row, boundary - 1); }
});
get('circuit-board').addEventListener('pointerdown', event => {
  cancelTouchPress(); cancelSelectionDrag(); suppressBoardClick = false;
  if (tutorialLocked() || daily.loading || review.step !== null || event.isPrimary === false) return;
  const cell = event.target.closest('button[data-cell]');
  if (!cell || cell.disabled) return;
  if (event.pointerType === 'touch') {
    if (cell.dataset.gate !== '.') return;
    const [row, column] = cell.dataset.cell.split(':').map(Number);
    const press = touchPress = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    press.timer = setTimeout(() => {
      if (touchPress !== press) return;
      suppressBoardClick = true; cancelTouchPress(); removeSpace(row, column);
    }, 450);
  } else if (event.button === 0 && ['mouse', 'pen'].includes(event.pointerType)) {
    selectionDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, target: cell,
      anchor: event.shiftKey && selectionAnchor ? selectionAnchor : cell.dataset.cell, moved: false, last: null };
  }
});
get('circuit-board').addEventListener('pointermove', event => {
  if (touchPress && event.pointerId === touchPress.pointerId && Math.hypot(event.clientX - touchPress.x, event.clientY - touchPress.y) > 10) cancelTouchPress();
  const drag = selectionDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (event.buttons === 0) { cancelSelectionDrag(); return; }
  if (!drag.moved) {
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
    drag.moved = true; selectionAnchor = drag.anchor;
    drag.target.setPointerCapture(event.pointerId);
  }
  // Capture keeps the gesture alive over gaps and outside the original cell.
  const bounds = get('circuit-board').getBoundingClientRect();
  const row = Math.max(0, Math.min(circuit.length - 1, Math.floor((event.clientY - bounds.top) / 72)));
  const column = Math.max(0, Math.min(circuit[0].length - 1, Math.floor((event.clientX - bounds.left - 22) / 64)));
  const key = `${row}:${column}`;
  if (key === drag.last) return;
  event.preventDefault(); suppressBoardClick = true; drag.last = key;
  selectRectangle(drag.anchor, key);
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) document.addEventListener(name, event => {
  if (touchPress?.pointerId === event.pointerId) cancelTouchPress();
  if (selectionDrag?.pointerId === event.pointerId) cancelSelectionDrag();
});
window.addEventListener('blur', () => { cancelTouchPress(); cancelSelectionDrag(); });
get('circuit-scroll').addEventListener('scroll', cancelTouchPress);
for (const button of ruleButtons) button.addEventListener('click', () => { const move = matchingSelection().find(move => move.rule === button.dataset.rule); if (move) playMove(move); });
onClick('undo', () => { if (tutorialLocked() || daily.loading || !sequence.length) return; review.clear(); resetScore(); clearSelection(); sequence.pop(); states.pop(); circuit = states.at(-1); update(); scores.load(); });
onClick('restart', reset); onClick('try-again', reset); onClick('show-results', openWin);
onClick('mode-tutorial', () => guide.enter());
onClick('mode-campaign', () => { if (mode === 'campaign') { daily.cancel(); update(); } else setPuzzle('campaign', campaignLevel); });
onClick('mode-random', () => { if (mode === 'random') { daily.cancel(); update(); } else randomCircuit(); });
bindDailyControls(daily, get);
get('level').addEventListener('change', event => selectLevel(event.target.value));
onClick('previous-level', () => selectLevel(level.id - 1)); onClick('next-level', () => selectLevel(level.id + 1)); onClick('result-next', () => selectLevel(level.id + 1));
onClick('new-circuit', randomCircuit); get('difficulty').addEventListener('change', randomCircuit);
onClick('create-circuit', createCircuit);
get('editor-wires').addEventListener('change', () => { if (editing) createCircuit(); });
onClick('save-circuit', () => {
  if (!editing || daily.loading || review.step !== null) return;
  try { playCustom(customCircuit({ circuit })); }
  catch (error) { get('custom-status').textContent = error.message; }
});
onClick('compact-identities', () => playMove({ rule: 'compact-identities', row: 0, column: 0 }));
onClick('replay', review.play); onClick('replay-result', review.play); onClick('resume-round', () => { review.clear(); update(); });
onClick('share-score', () => share(get('share-score'))); onClick('share-result', () => share(get('share-result')));
bindGameDialogs(get);
get('score-form').addEventListener('submit', scores.submit);
document.addEventListener('keydown', event => {
  if (tutorialLocked() || ignoresGameShortcut(event)) return;
  if (event.ctrlKey || event.metaKey) {
    if (!event.shiftKey && event.key.toLowerCase() === 'z') { event.preventDefault(); get('undo').click(); }
    return;
  }
  if (event.key === 'Enter' && !daily.loading && review.step === null && (editing || !isSolved(circuit))) {
    const cell = event.target.closest('button[data-cell]');
    if (cell?.parentElement === get('circuit-board') || event.target === get('circuit-scroll')) {
      const matches = matchingSelection();
      if (matches.length === 1) {
        event.preventDefault();
        const focusKey = cell?.dataset.cell ?? selectionAnchor;
        playMove(matches[0]);
        if (!winDialog.open) [...get('circuit-board').querySelectorAll('[data-cell]')].find(button => button.dataset.cell === focusKey)?.focus();
      }
    }
  }
  if (event.key === 'Backspace') { event.preventDefault(); get('undo').click(); }
  if (event.key === 'Delete' && !daily.loading && review.step === null) {
    const cell = event.target.closest('button[data-cell]');
    if (cell?.dataset.gate === '.') {
      event.preventDefault();
      const [row, column] = cell.dataset.cell.split(':').map(Number); removeSpace(row, column);
      [...get('circuit-board').querySelectorAll('[data-cell]')].find(button => button.dataset.cell === `${row}:${Math.min(column, circuit[0].length - 1)}`)?.focus({ preventScroll: true });
    }
  }
  if (event.key.toLowerCase() === 'r') { event.preventDefault(); reset(); }
  if (event.key === 'Escape' && !daily.loading && review.step === null && (selection.size || selectionDrag || selectionAnchor)) {
    if (selectionDrag) suppressBoardClick = true;
    clearSelection(); updateSelection();
  }
});
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  if (mode === 'tutorial') { guide.enter(); return; }
  update(); daily.refresh(); scores.load();
});
window.addEventListener('pagehide', () => {
  guide.leave();
  cancelTouchPress(); cancelSelectionDrag(); review.clear(); daily.cancel(); scores.dispose();
  if (searchWorker) get('custom-status').textContent = 'Identity verified. Shortest solution is unavailable.';
  cancelSearch(); sharing.close(); customJson.close();
});
for (const button of ruleButtons) {
  const rule = getRule(button.dataset.rule);
  const preview = document.createElement('span'); preview.className = 'rule-preview'; preview.setAttribute('aria-hidden', 'true');
  for (const [index, pattern] of [rule.left, rule.right].entries()) {
    if (index) { const arrow = document.createElement('span'); arrow.textContent = '↔'; preview.appendChild(arrow); }
    const mini = document.createElement('span'); mini.className = 'rule-mini'; mini.style.setProperty('--mini-columns', pattern[0].length);
    mini.appendChild(circuitWires(pattern, { cellWidth: 22, cellHeight: 22, gutter: 0, header: 0 }));
    pattern.forEach(row => row.forEach(cell => mini.appendChild(gateGlyph(cell)))); preview.appendChild(mini);
  }
  button.replaceChildren(preview);
}
if (!startDailyFromLink(daily)) guide.enter();
