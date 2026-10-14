import { RULES, LEARNED_RULE_IDS, cloneCircuit, circuitKey, applyMove, getLegalMoves, isSolved, parseCircuit, validateCircuit, isIdentity, moveCost, sequenceCost } from '../lib/circuit-reduction/engine.js';
import { generatePuzzle } from '../lib/circuit-reduction/generator.js';
import { gateGlyph, spaceGlyph, circuitWires } from '../lib/circuit-reduction/rendering.js';
import { LEVELS, dailyPuzzle, DAILY_START } from '../lib/circuit-reduction/puzzles.js';
import { dailyMetadata } from '../lib/games/daily-calendar.js';
import { createScoreboard } from '../lib/games/scoreboard.js';
import { createDailySession } from '../lib/games/daily-session.js';
import { createReplayShare } from '../lib/games/replay-share.js';
import { formatPuzzleDate, bindDailyControls } from '../lib/games/daily-ui.js';

const GAME = 'circuit-reduction';
const get = id => document.getElementById(id);
const onClick = (id, callback) => get(id).addEventListener('click', callback);
const winDialog = get('win-dialog');
const ruleButtons = [...document.querySelectorAll('[data-rule]')];
const ruleReferences = [...document.querySelectorAll('[data-reference-rule]')];
const rulesById = Object.fromEntries(RULES.map(rule => [rule.id, rule]));
const cellNames = { '.': 'empty slot', H: 'H', X: 'X', Z: 'Z', ZU: 'upper Z endpoint', ZD: 'lower Z endpoint', XU: 'upper X endpoint', XD: 'lower X endpoint' };
let mode = 'campaign', level = LEVELS[0], campaignLevel = level;
let circuit = level.circuit, sequence = [], states = [circuit];
const selection = new Set();
let reviewStep = null, replayTimer, trace = true;
let searchWorker;
let touchPress, suppressTouchClick = false;
function cancelTouchPress() { clearTimeout(touchPress?.timer); touchPress = null; }
function cancelSearch() { searchWorker?.terminate(); searchWorker = null; }
const sharing = createReplayShare({ get, createGif: async (round, options) => {
  const { createReplayGif } = await import('../lib/circuit-reduction/replay-gif.js');
  return createReplayGif(round, options);
} });
const canScore = () => Boolean(level && (mode === 'campaign' || (mode === 'daily' && level.acceptingScores && daily.serverTime() >= level.opensAt && daily.serverTime() < level.closesAt)));
const selector = () => ({ game: GAME, ...(mode === 'daily' ? { date: level.date } : { level: level.id }) });
const allowedRules = () => mode === 'campaign' ? level.allowedRules ?? LEARNED_RULE_IDS : LEARNED_RULE_IDS;
const scores = createScoreboard({
  get, selector: () => mode === 'random' ? null : selector(),
  benchmark: () => ({ optimalMoves: level?.optimalMoves ?? level?.parMoves,
    benchmarkLabel: level?.optimalMoves == null ? 'Best known' : 'Optimal' }),
  canSubmit: () => !daily.loading && canScore() && isSolved(circuit),
  sequence: () => sequence, update: () => update({ board: false }),
  onDailyClosed: () => { level.acceptingScores = false; daily.load(level.date, false); },
});
const daily = createDailySession({
  game: GAME, startDate: DAILY_START, get, update, settleDelay: 20,
  validatePuzzle: puzzle => validateCircuit(puzzle.circuit),
  selectedDate: () => mode === 'daily' ? level.date : undefined,
  onPuzzle(info, select) {
    if (select && (mode !== 'daily' || level.date !== info.date)) {
      mode = 'daily';
      level = { circuit: info.puzzle.circuit, optimalMoves: info.puzzle.optimalMoves,
        date: info.date, opensAt: info.opensAt, closesAt: info.closesAt, acceptingScores: info.acceptingScores };
      cancelSearch(); reset();
    } else if (mode === 'daily' && level.date === info.date) {
      Object.assign(level, { acceptingScores: info.acceptingScores, opensAt: info.opensAt, closesAt: info.closesAt });
      scores.load();
    }
  },
  fallback(date) {
    const metadata = dailyMetadata(date, DAILY_START);
    return { ...metadata, puzzle: dailyPuzzle(metadata.date), acceptingScores: false, offline: true };
  },
});
function matchingSelection() {
  if (!selection.size) return [];
  const cells = [...selection].map(cell => cell.split(':').map(Number));
  const rows = cells.map(([row]) => row), columns = cells.map(([, column]) => column);
  const row = Math.min(...rows), column = Math.min(...columns);
  const height = Math.max(...rows) - row + 1, width = Math.max(...columns) - column + 1;
  if (selection.size !== height * width) return [];
  return getLegalMoves(circuit, { allowedRules: allowedRules(), window: { row, column, height, width } });
}

function renderCircuit() {
  const visible = reviewStep === null ? circuit : states[reviewStep];
  const board = get('circuit-board'), fragment = document.createDocumentFragment();
  fragment.appendChild(circuitWires(visible, { gutter: 22, header: 0, slotGaps: true }));
  board.style.setProperty('--columns', visible[0].length);
  board.style.setProperty('--wires', visible.length);
  visible.forEach((row, y) => {
    row.forEach((cell, x) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'circuit-cell'; button.dataset.cell = `${y}:${x}`;
      button.dataset.gate = cell; button.setAttribute('aria-label', `Wire ${y + 1}, column ${x + 1}: ${cellNames[cell]}`);
      button.setAttribute('aria-pressed', String(selection.has(`${y}:${x}`)));
      button.disabled = daily.loading || reviewStep !== null;
      if (cell !== '.') {
        button.appendChild(gateGlyph(cell));
      }
      fragment.appendChild(button);
    });
    for (let boundary = 0; boundary <= row.length; boundary++) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'space-handle'; button.dataset.space = `${y}:${boundary}`;
      button.setAttribute('aria-label', `Add space on wire ${y + 1}, before slot ${boundary + 1}`);
      button.title = 'Add space · Shift: all wires · Right-click: remove space';
      button.style.setProperty('left', `${22 + boundary * 64}px`); button.style.setProperty('top', `${36 + y * 72}px`);
      button.disabled = daily.loading || reviewStep !== null;
      if (boundary === 0 || boundary === row.length) button.dataset.edge = boundary === 0 ? 'start' : 'end';
      button.appendChild(spaceGlyph());
      fragment.appendChild(button);
    }
  });
  board.replaceChildren(fragment);
}

function update({ board = true } = {}) {
  const won = isSolved(circuit), locked = daily.loading || reviewStep !== null;
  if (board) renderCircuit();
  const scoreMoves = sequenceCost(sequence);
  get('move-count').textContent = `${scoreMoves} ${scoreMoves === 1 ? 'move' : 'moves'}`;
  const matches = locked || won ? [] : matchingSelection();
  const availableRules = allowedRules();
  for (const button of ruleButtons) {
    button.hidden = !availableRules.includes(button.dataset.rule);
    button.disabled = !matches.some(move => move.rule === button.dataset.rule);
  }
  for (const reference of ruleReferences) reference.hidden = !availableRules.includes(reference.dataset.referenceRule);
  get('paper-rules').hidden = !RULES.some(rule => rule.advanced && availableRules.includes(rule.id));
  const selectionNote = !locked && !won && selection.size && !matches.length ? 'No matching rule' : '';
  get('selection-note').textContent = selectionNote;
  for (const name of ['campaign', 'random', 'daily']) {
    get(`mode-${name}`).setAttribute('aria-pressed', String(mode === name));
  }
  get('campaign-controls').hidden = mode !== 'campaign';
  get('custom-controls').hidden = mode !== 'random';
  get('leaderboard-section').hidden = mode === 'random';
  get('daily-heading').hidden = mode !== 'daily';
  get('daily-date').disabled = !daily.info;
  if (mode === 'campaign') get('level').value = String(level.id);
  get('previous-level').disabled = daily.loading || mode !== 'campaign' || level.id === 1;
  get('next-level').disabled = daily.loading || mode !== 'campaign' || !won || level.id === LEVELS.length;
  get('result-next').disabled = get('next-level').disabled;
  get('result-next').hidden = mode !== 'campaign' || level.id === LEVELS.length;
  get('level').disabled = daily.loading;
  get('undo').disabled = daily.loading || !sequence.length;
  get('restart').disabled = daily.loading;
  get('compact-identities').disabled = locked;
  for (const id of ['replay', 'replay-result']) get(id).disabled = daily.loading || !sequence.length || Boolean(replayTimer);
  get('replay').hidden = !sequence.length;
  for (const id of ['share-score', 'share-result']) { get(id).hidden = !won || !sequence.length; get(id).disabled = daily.loading; }
  for (const [share, daily, regular] of [
    [get('share-score'), get('daily-replay-actions'), get('replay-actions')],
    [get('share-result'), get('daily-result-actions'), get('result-replay-actions')],
  ]) {
    const destination = mode === 'daily' ? daily : regular;
    if (share.parentElement !== destination) destination.appendChild(share);
    daily.hidden = mode !== 'daily' || share.hidden;
  }
  get('review-controls').hidden = reviewStep === null;
  get('review-note').textContent = reviewStep === null ? '' : `Step ${reviewStep} / ${sequence.length}`;
  const timeline = get('sequence'), steps = document.createDocumentFragment();
  while (timeline.children.length > sequence.length) timeline.lastElementChild.remove();
  let rewrites = 0;
  sequence.forEach((move, index) => {
    const cost = moveCost(move); rewrites += cost;
    let button = timeline.children[index];
    if (!button) {
      button = document.createElement('button'); button.type = 'button'; button.textContent = cost ? String(rewrites) : '·'; button.dataset.step = index + 1;
      const title = rulesById[move.rule]?.title ?? (move.rule === 'compact-identities' ? 'Remove identities · free' : 'Arrange space · free');
      button.title = `Step ${index + 1}: ${title}`; button.setAttribute('aria-label', button.title); steps.appendChild(button);
    }
    button.setAttribute('aria-current', reviewStep === index + 1 ? 'step' : 'false'); button.disabled = daily.loading;
  });
  timeline.appendChild(steps); timeline.hidden = !trace;
  get('toggle-trace').setAttribute('aria-pressed', String(trace));
  get('show-results').hidden = !won || !sequence.length;
  get('show-results').textContent = canScore() || scores.player ? 'Scores' : 'Result';
  const showForm = canScore() && !scores.player;
  get('score-form').hidden = !showForm;
  get('win-results').hidden = !scores.player;
  get('win-practice').hidden = mode !== 'daily' || canScore() || Boolean(scores.player);
  get('result-actions').hidden = showForm;
  for (const id of ['player-name', 'submit-score']) get(id).disabled = daily.loading || Boolean(scores.submitting) || !showForm;
  const score = `${scoreMoves} ${scoreMoves === 1 ? 'move' : 'moves'}`;
  get('win-summary').textContent = scoreMoves === level?.optimalMoves ? `Optimal solution in ${score}.`
    : level?.optimalMoves != null ? `${score} : optimum+${scoreMoves - level.optimalMoves}` : `Circuit reduced in ${score}.`;
  if (mode === 'daily') {
    get('daily-title').textContent = `Daily puzzle · ${formatPuzzleDate(level.date)}`;
    get('daily-note').textContent = canScore() ? 'Scores close at midnight (Paris).' : 'Practice · leaderboard closed.';
  }
}

function clearReview() { clearTimeout(replayTimer); replayTimer = null; reviewStep = null; }
function resetScore() {
  sharing.close(); scores.reset(); winDialog.close();
}
function reset() {
  if (daily.loading) return;
  cancelTouchPress(); suppressTouchClick = false; clearReview(); resetScore(); selection.clear();
  circuit = level.circuit; sequence = []; states = [circuit]; get('status').textContent = ''; update();
  scores.load();
}
function playMove(move) {
  const free = moveCost(move) === 0, wasWon = isSolved(circuit);
  if (daily.loading || (!free && (reviewStep !== null || wasWon)) || (!free && !allowedRules().includes(move.rule))) return;
  if (free && reviewStep !== null) clearReview();
  try {
    const next = applyMove(circuit, move);
    if (circuitKey(next) === circuitKey(circuit)) { get('status').textContent = ''; return; }
    // applyMove never mutates its input, so history can retain each result directly.
    circuit = next; sequence.push({ ...move }); states.push(circuit); selection.clear();
    get('status').textContent = ''; update();
    if (isSolved(circuit) && !wasWon) openWin();
  } catch (error) { get('status').textContent = error.message; }
}
function openWin() {
  if (!isSolved(circuit) || !sequence.length || winDialog.open) return;
  clearReview(); update(); winDialog.showModal(); get(canScore() && !scores.player ? 'player-name' : 'try-again').focus();
}
function setPuzzle(nextMode, puzzle) {
  daily.cancel(); cancelSearch();
  get('custom-status').textContent = '';
  mode = nextMode; level = puzzle; if (mode === 'campaign') campaignLevel = level;
  reset();
}
function selectLevel(id) { const next = LEVELS.find(item => item.id === Number(id)); if (next) setPuzzle('campaign', next); }
function randomCircuit() {
  const { circuit, optimalMoves } = generatePuzzle(`${Date.now()}:${Math.random()}`, Number(get('difficulty').value));
  setPuzzle('random', { circuit, optimalMoves });
}

function inspect(step) {
  if (daily.loading || !Number.isInteger(step) || step < 0 || step > sequence.length) return;
  clearReview(); selection.clear(); reviewStep = step; winDialog.close(); update();
}
function replay() {
  if (daily.loading || !sequence.length) return;
  inspect(0);
  const advance = () => { reviewStep++; if (reviewStep < sequence.length) replayTimer = setTimeout(advance, 650); else replayTimer = null; update(); };
  replayTimer = setTimeout(advance, 650); update({ board: false });
}
function share(source) {
  if (daily.loading || !isSolved(circuit) || !sequence.length) return;
  sharing.open(source, { label: mode === 'daily' ? `Daily puzzle : ${formatPuzzleDate(level.date)}` : mode === 'campaign' ? `Level : ${level.id}` : 'Custom circuit', circuit: cloneCircuit(level.circuit), sequence: sequence.map(move => ({ ...move })), optimalMoves: level?.optimalMoves ?? null }, `circuit-reduction-${level?.date ?? (mode === 'campaign' ? `level-${level.id}` : 'custom')}.gif`);
}

get('circuit-board').addEventListener('click', event => {
  if (daily.loading || reviewStep !== null) return;
  if (suppressTouchClick) { suppressTouchClick = false; return; }
  const space = event.target.closest('button[data-space]');
  if (space) {
    const [row, column] = space.dataset.space.split(':').map(Number);
    playMove({ rule: event.shiftKey ? 'insert-column' : 'insert-space', row: event.shiftKey ? 0 : row, column });
    if (event.detail === 0) [...get('circuit-board').querySelectorAll('[data-space]')].find(button => button.dataset.space === space.dataset.space)?.focus({ preventScroll: true });
    return;
  }
  const cell = event.target.closest('button[data-cell]');
  if (cell) { const key = cell.dataset.cell; if (selection.has(key)) selection.delete(key); else selection.add(key); }
  else return;
  // Keep the tapped/focused cell in place; updating selection should not rebuild the board.
  for (const button of get('circuit-board').querySelectorAll('[data-cell]')) button.setAttribute('aria-pressed', String(selection.has(button.dataset.cell)));
  update({ board: false });
});
function removeSpace(row, column) {
  if (circuit[row]?.[column] === '.') playMove({ rule: 'remove-space', row, column });
}
get('circuit-board').addEventListener('contextmenu', event => {
  event.preventDefault();
  if (daily.loading || reviewStep !== null || suppressTouchClick) return;
  const cell = event.target.closest('button[data-cell]'), space = event.target.closest('button[data-space]');
  if (cell) removeSpace(...cell.dataset.cell.split(':').map(Number));
  else if (space) { const [row, boundary] = space.dataset.space.split(':').map(Number); removeSpace(row, boundary - 1); }
});
get('circuit-board').addEventListener('pointerdown', event => {
  cancelTouchPress(); suppressTouchClick = false;
  if (event.pointerType !== 'touch' || daily.loading || reviewStep !== null) return;
  const cell = event.target.closest('button[data-cell]');
  if (cell?.dataset.gate !== '.') return;
  const [row, column] = cell.dataset.cell.split(':').map(Number);
  const press = touchPress = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  press.timer = setTimeout(() => {
    if (touchPress !== press) return;
    suppressTouchClick = true; cancelTouchPress(); removeSpace(row, column);
  }, 450);
});
get('circuit-board').addEventListener('pointermove', event => {
  if (touchPress && event.pointerId === touchPress.pointerId && Math.hypot(event.clientX - touchPress.x, event.clientY - touchPress.y) > 10) cancelTouchPress();
});
for (const event of ['pointerup', 'pointercancel']) get('circuit-board').addEventListener(event, cancelTouchPress);
get('circuit-scroll').addEventListener('scroll', cancelTouchPress);
for (const button of ruleButtons) button.addEventListener('click', () => { const move = matchingSelection().find(move => move.rule === button.dataset.rule); if (move) playMove(move); });
onClick('undo', () => { if (daily.loading || !sequence.length) return; clearReview(); resetScore(); selection.clear(); sequence.pop(); states.pop(); circuit = states.at(-1); update(); scores.load(); });
onClick('restart', reset); onClick('try-again', reset); onClick('show-results', openWin);
onClick('mode-campaign', () => { if (mode === 'campaign') { daily.cancel(); update(); } else setPuzzle('campaign', campaignLevel); });
onClick('mode-random', () => { if (mode === 'random') { daily.cancel(); update(); } else randomCircuit(); });
bindDailyControls(daily, get);
get('level').addEventListener('change', event => selectLevel(event.target.value));
onClick('previous-level', () => selectLevel(level.id - 1)); onClick('next-level', () => selectLevel(level.id + 1)); onClick('result-next', () => selectLevel(level.id + 1));
onClick('new-circuit', randomCircuit); get('difficulty').addEventListener('change', randomCircuit);
onClick('compact-identities', () => playMove({ rule: 'compact-identities', row: 0, column: 0 }));
onClick('toggle-trace', () => { trace = !trace; update({ board: false }); });
onClick('replay', replay); onClick('replay-result', replay); onClick('resume-round', () => { clearReview(); update(); });
get('sequence').addEventListener('click', event => {
  const button = event.target.closest('button[data-step]');
  if (button?.parentElement === event.currentTarget && !button.disabled) inspect(Number(button.dataset.step));
});
onClick('share-score', () => share(get('share-score'))); onClick('share-result', () => share(get('share-result')));
onClick('show-rules', () => get('rules-dialog').showModal()); onClick('close-rules', () => get('rules-dialog').close()); onClick('close-win', () => winDialog.close());
for (const id of ['win-dialog', 'rules-dialog']) get(id).addEventListener('click', event => { if (event.target === get(id)) { const rect = get(id).getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) get(id).close(); } });
get('score-form').addEventListener('submit', scores.submit);
const MAX_CUSTOM_INPUT_LENGTH = 16_384;
get('custom-form').addEventListener('submit', event => {
  event.preventDefault();
  const text = get('custom-circuit').value;
  if (text.length > MAX_CUSTOM_INPUT_LENGTH) {
    get('custom-status').textContent = 'Custom circuits can use up to 16,384 characters.';
    return;
  }
  try {
    const custom = parseCircuit(text);
    if (isSolved(custom)) throw new Error('This circuit is already empty. Add some gates first.');
    if (!isIdentity(custom)) throw new Error('This circuit is not the identity. Check its gates and linked endpoints.');
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
  } catch (error) { get('custom-status').textContent = error.message; }
});
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || document.querySelector('dialog[open]')) return;
  if (event.key === 'Backspace') { event.preventDefault(); get('undo').click(); }
  if (event.key === 'Delete' && !daily.loading && reviewStep === null) {
    const cell = event.target.closest('button[data-cell]');
    if (cell?.dataset.gate === '.') {
      event.preventDefault();
      const [row, column] = cell.dataset.cell.split(':').map(Number); removeSpace(row, column);
      [...get('circuit-board').querySelectorAll('[data-cell]')].find(button => button.dataset.cell === `${row}:${Math.min(column, circuit[0].length - 1)}`)?.focus({ preventScroll: true });
    }
  }
  if (event.key.toLowerCase() === 'r') { event.preventDefault(); reset(); }
  if (event.key === 'Escape' && !daily.loading && reviewStep === null && selection.size) {
    selection.clear();
    for (const cell of get('circuit-board').querySelectorAll('[data-cell]')) cell.setAttribute('aria-pressed', 'false');
    update({ board: false });
  }
});
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  update(); daily.refresh(); scores.load();
});
window.addEventListener('pagehide', () => {
  cancelTouchPress(); clearReview(); daily.cancel(); scores.dispose();
  if (searchWorker) get('custom-status').textContent = 'Identity verified. Shortest solution is unavailable.';
  cancelSearch(); sharing.close();
});
for (const button of ruleButtons) {
  const rule = rulesById[button.dataset.rule];
  const preview = document.createElement('span'); preview.className = 'rule-preview'; preview.setAttribute('aria-hidden', 'true');
  for (const [index, pattern] of [rule.left, rule.right].entries()) {
    if (index) { const arrow = document.createElement('span'); arrow.textContent = '↔'; preview.appendChild(arrow); }
    const mini = document.createElement('span'); mini.className = 'rule-mini'; mini.style.setProperty('--mini-columns', pattern[0].length);
    mini.appendChild(circuitWires(pattern, { cellWidth: 22, cellHeight: 22, gutter: 0, header: 0 }));
    pattern.forEach(row => row.forEach(cell => mini.appendChild(gateGlyph(cell)))); preview.appendChild(mini);
  }
  button.replaceChildren(preview);
}
update(); scores.load();
