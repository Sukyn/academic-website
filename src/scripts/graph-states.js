import { applyMove, isSolved, optimalShots, pathGraph, puzzleData, sequenceCost, MAX_MOVES } from '../lib/graph-states/engine.js';
import { LEVELS, generatePuzzle, DAILY_START } from '../lib/graph-states/puzzles.js';
import { TUTORIAL, TUTORIAL_INTRO } from '../lib/graph-states/tutorial.js';
import { edgeAtPoint, renderGraph, renderCircuit } from '../lib/graph-states/rendering.js';
import { correctionGlyph } from '../lib/graph-states/correction-graphics.js';
import { animateGraphMove, REPLAY_COMPLEMENT_DURATION } from '../lib/graph-states/animation.js';
import { createScoreboard } from '../lib/games/scoreboard.js';
import { createDailySession } from '../lib/games/daily-session.js';
import { startDailyFromLink } from '../lib/games/daily-links.js';
import { createReplayShare } from '../lib/games/replay-share.js';
import { createStepReplay } from '../lib/games/step-replay.js';
import { createMoveTimeline } from '../lib/games/move-timeline.js';
import { createCustomPuzzleJson } from '../lib/games/custom-puzzle-json.js';
import { createTutorial } from '../lib/games/tutorial.js';
import { bindGameDialogs, ignoresGameShortcut, updateModeMenu, updateResultMenu } from '../lib/games/controls.js';
import { formatPuzzleDate, bindDailyControls } from '../lib/games/daily-ui.js';

const GAME = 'graph-states', get = id => document.getElementById(id);
const onClick = (id, callback) => get(id).addEventListener('click', callback);
let mode = 'tutorial', campaignIndex = 0, puzzle = TUTORIAL.graph, graph = puzzle;
let sequence = [], states = [graph], editing = false;
let animation, targetVertices, minimum;
function cancelAnimation() {
  const current = animation; animation = null;
  current?.cancel();
  get('graph-board').removeAttribute('data-graph-animating');
  get('graph-board').removeAttribute('aria-busy');
}
const tutorialBlocked = () => tutorial.active && !tutorial.executing;
const canRecord = () => mode === 'campaign' || (mode === 'daily' && daily.info?.date === puzzle.date &&
  daily.info.acceptingScores && daily.serverTime() >= daily.info.opensAt && daily.serverTime() < daily.info.closesAt);
const selector = () => mode === 'campaign' || mode === 'daily'
  ? { game: GAME, ...(mode === 'daily' ? { date: puzzle.date } : { level: campaignIndex + 1 }) } : null;
const sharing = createReplayShare({ get,
  createWorker: () => new Worker(new URL('./graph-states-gif-worker.js', import.meta.url), { type: 'module' }),
});
const scores = createScoreboard({
  get, selector, benchmark: () => ({ optimalMoves: minimum, unit: 'shot' }), sequence: () => sequence, update: () => update({ board: false }),
  canSubmit: () => !animation && review.step === null && !daily.loading && canRecord() && isSolved(graph),
  onDailyClosed: () => { daily.info.acceptingScores = false; daily.refresh(); },
});
const daily = createDailySession({
  game: GAME, startDate: DAILY_START, get, update: () => update({ board: false }),
  selectedDate: () => mode === 'daily' ? puzzle.date : undefined,
  validatePuzzle: puzzleData,
  onPuzzle(info, select) {
    if (select && (mode !== 'daily' || puzzle.date !== info.date)) {
      tutorial.leave(); editing = false; mode = 'daily';
      puzzle = { ...info.puzzle, date: info.date }; reset();
    } else if (mode === 'daily' && puzzle.date === info.date) scores.load();
  },
});
const review = createStepReplay({
  interval: 200,
  length: () => sequence.length, canReview: () => !animation && !tutorial.active && !daily.loading && !editing,
  onEnter: () => get('win-dialog').close(), onChange: () => update({ follow: true }),
  transition(step) {
    const job = startAnimation(states[step], sequence[step], REPLAY_COMPLEMENT_DURATION);
    return { cancel: cancelAnimation, finished: job.finished.then(completed => {
      if (animation === job) cancelAnimation();
      return completed;
    }) };
  },
});

function startAnimation(before, move, duration) {
  const job = animation = animateGraphMove(get('graph-board'), before, move, { duration });
  get('graph-board').dataset.graphAnimating = 'true';
  get('graph-board').setAttribute('aria-busy', 'true');
  return job;
}

function closeResult() { sharing.close(); get('win-dialog').close(); }
const moveSelector = move => Object.hasOwn(move, 'vertex') ? `[data-vertex="${move.vertex}"]` : `[data-edge="${move.edge.join(':')}"]`;
function renderCorrections(follow = false) {
  if (get('advanced-features').open) {
    renderCircuit(get('clifford-circuit'), puzzle, sequence, { activeStep: review.step ?? sequence.length, follow });
  }
}
const renderTimeline = createMoveTimeline(get('sequence'), (move, index) => {
  const text = Object.hasOwn(move, 'vertex') ? `LC ${move.vertex + 1}` : `P ${move.edge.map(v => v + 1).join('–')}`;
  return { text, label: `Operation ${index + 1}: ${text}` };
});

// Metadata refreshes preserve graph focus and the reader's circuit scroll position.
function update({ board = true, follow = false } = {}) {
  // A failed Daily request must leave the last committed graph on screen.
  if (daily.loading && animation) { cancelAnimation(); board = true; }
  const reviewing = review.step !== null;
  const locked = Boolean(animation) || daily.loading || reviewing;
  // Replay previews history; completed-round actions belong to the final graph.
  const solved = isSolved(graph), won = (!animation || reviewing) && !editing && solved;
  if (board && !animation) {
    const focus = document.activeElement?.closest('#graph-board button');
    const focusedMove = focus?.dataset.vertex !== undefined ? { vertex: Number(focus.dataset.vertex) } :
      focus?.dataset.edge ? { edge: focus.dataset.edge.split(':').map(Number) } : null;
    renderGraph(get('graph-board'), review.step === null ? graph : states[review.step], { locked });
    if (targetVertices !== puzzle.vertices) {
      renderGraph(get('graph-target'), pathGraph(puzzle.vertices), { interactive: false });
      targetVertices = puzzle.vertices;
    }
    renderCorrections(follow);
    if (focusedMove) get('graph-board').querySelector(moveSelector(focusedMove))?.focus({ preventScroll: true });
  } else for (const button of get('graph-board').querySelectorAll('button')) button.disabled = locked;
  updateModeMenu(get, mode, false, scores.submitting);
  get('campaign-controls').hidden = mode !== 'campaign'; get('custom-controls').hidden = mode !== 'random';
  get('graph-editor-controls').hidden = mode !== 'random';
  get('custom-details').hidden = !editing;
  get('editor-vertices').value = String(graph.vertices);
  get('editor-vertices').disabled = daily.loading;
  get('save-graph').disabled = Boolean(animation) || !editing || solved;
  customJson.update({ visible: mode === 'random', disabled: Boolean(animation) || daily.loading, canShare: !editing || !solved });
  get('leaderboard-section').hidden = mode === 'random' || mode === 'tutorial';
  get('daily-heading').hidden = mode !== 'daily'; get('daily-date').disabled = !daily.info;
  get('level').disabled = daily.loading; get('level').value = String(campaignIndex + 1);
  get('previous-level').disabled = daily.loading || mode !== 'campaign' || campaignIndex === 0;
  get('next-level').disabled = daily.loading || scores.submitting || mode !== 'campaign' || !won || campaignIndex === LEVELS.length - 1;
  get('result-next').disabled = get('next-level').disabled;
  get('result-next').hidden = mode !== 'campaign' || campaignIndex === LEVELS.length - 1;
  get('undo').disabled = locked || !sequence.length; get('restart').disabled = daily.loading;
  get('show-results').hidden = mode === 'tutorial' || !won;
  for (const id of ['replay', 'replay-result']) get(id).disabled = Boolean(animation) || daily.loading || editing || !sequence.length || review.playing;
  get('replay').hidden = mode === 'tutorial' || editing || !sequence.length;
  for (const id of ['share-replay', 'share-result']) {
    get(id).hidden = mode === 'tutorial' || !won || !sequence.length; get(id).disabled = daily.loading;
  }
  updateResultMenu(get, mode === 'daily');
  get('review-controls').hidden = review.step === null;
  get('review-note').textContent = review.step === null ? '' : `Operation ${review.step} / ${sequence.length}`;
  renderTimeline(sequence, { step: review.step, disabled: review.playing || Boolean(animation) || daily.loading || editing });
  const registered = Boolean(scores.player), recordable = canRecord();
  const showForm = won && recordable && !registered && !scores.automatic;
  get('score-form').hidden = !showForm;
  get('win-results').hidden = !registered;
  get('win-practice').hidden = mode !== 'daily' || recordable || registered;
  get('result-actions').hidden = showForm;
  for (const id of ['player-name', 'submit-score']) get(id).disabled = daily.loading || scores.submitting || !recordable;
  const shots = sequenceCost(sequence);
  get('shot-count').hidden = mode === 'tutorial' || editing;
  get('shot-count').textContent = `Shots: ${shots} · Optimal: ${minimum}`;
  const shotLabel = `${shots} ${shots === 1 ? 'shot' : 'shots'}`;
  get('win-summary').textContent = shots === minimum ? `Optimal solution in ${shotLabel}.`
    : `Chain reached in ${shotLabel}. Optimal: ${minimum}.`;
  if (mode === 'daily') {
    get('daily-title').textContent = 'Daily puzzle · ' + formatPuzzleDate(puzzle.date);
    get('daily-note').textContent = recordable ? 'Scores close at midnight (Paris).' : 'Practice · leaderboard closed.';
  }
  tutorial.render();
}
function reset() {
  if (tutorialBlocked() || daily.loading) return;
  cancelAnimation();
  review.clear(); closeResult(); scores.reset(); graph = puzzle; sequence = []; states = [graph];
  minimum = optimalShots(puzzle);
  get('status').textContent = ''; get('custom-status').textContent = '';
  update({ follow: true }); scores.load();
}
function setPuzzle(nextMode, next, edit = false) {
  if (nextMode !== 'tutorial') tutorial.leave();
  daily.cancel(); mode = nextMode; puzzle = next; editing = edit; reset();
}
function selectLevel(value) {
  if (tutorialBlocked()) return;
  const index = Number(value) - 1;
  if (Number.isInteger(index) && LEVELS[index]) { campaignIndex = index; setPuzzle('campaign', LEVELS[index]); }
}
function randomPuzzle() {
  if (!tutorialBlocked()) setPuzzle('random', generatePuzzle(Date.now() + ':' + Math.random(), Number(get('difficulty').value)));
}
function openWin() {
  if ((animation && review.step === null) || mode === 'tutorial' || editing || daily.loading || !isSolved(graph) || get('win-dialog').open) return;
  const reviewing = review.step !== null;
  review.clear(); update({ board: reviewing, follow: reviewing }); scores.autoSubmit(); get('win-dialog').showModal();
  get(scores.automatic ? 'close-win' : get('score-form').hidden ? 'try-again' : 'player-name').focus();
}
async function playMove(move) {
  if (animation || tutorialBlocked() || daily.loading || review.step !== null) return false;
  let job;
  try {
    if (sequence.length >= MAX_MOVES) throw new Error('Undo or reset before adding more operations.');
    const next = applyMove(graph, move);
    const restoreFocus = document.activeElement?.closest('#graph-board button');
    closeResult(); highlightEdge(null);
    job = startAnimation(graph, move);
    get('status').textContent = ''; update({ board: false });
    const completed = await job.finished;
    if (animation !== job) return false;
    cancelAnimation();
    if (!completed) { update(); return false; }
    if (!editing && isSolved(graph)) scores.reset();
    graph = next; sequence.push(move); states.push(next);
    get('status').textContent = ''; update({ follow: true });
    if (restoreFocus && document.activeElement === document.body) {
      get('graph-board').querySelector(moveSelector(move))?.focus({ preventScroll: true });
    }
    if (isSolved(graph)) openWin();
    return true;
  } catch (error) {
    if (job && animation !== job) return false;
    cancelAnimation(); update(); get('status').textContent = error.message;
    return false;
  }
}
function share(source) {
  if ((animation && review.step === null) || tutorial.active || daily.loading || editing || !isSolved(graph) || !sequence.length) return;
  if (review.step !== null) { review.clear(); update({ follow: true }); }
  sharing.open(source, {
    label: mode === 'daily' ? 'Daily puzzle · ' + formatPuzzleDate(puzzle.date) : mode === 'campaign' ? 'Level · ' + (campaignIndex + 1) : 'Custom graph',
    puzzle: puzzleData(puzzle), sequence: structuredClone(sequence),
  }, 'graph-states-' + (puzzle.date ?? (mode === 'campaign' ? campaignIndex + 1 : 'custom')) + '.gif');
}

function pointerEdge(event) {
  const bounds = get('graph-board').getBoundingClientRect();
  return edgeAtPoint(graph, event.clientX - bounds.left, event.clientY - bounds.top, bounds.width);
}
let hoveredEdge;
let touchPoint;
function highlightEdge(button) {
  if (hoveredEdge === button) return;
  hoveredEdge?.classList.remove('is-highlighted');
  hoveredEdge = button; hoveredEdge?.classList.add('is-highlighted');
}
get('graph-board').addEventListener('pointermove', event => {
  if (event.pointerType === 'touch') return;
  const edge = !animation && !daily.loading && review.step === null && !tutorial.active && !event.target.closest('[data-vertex]') ? pointerEdge(event) : null;
  highlightEdge(edge ? get('graph-board').querySelector(moveSelector({ edge })) : null);
});
get('graph-board').addEventListener('pointerleave', () => highlightEdge(null));
get('graph-board').addEventListener('pointerdown', () => { touchPoint = null; });
get('graph-board').addEventListener('pointercancel', () => { touchPoint = null; });
get('graph-board').addEventListener('pointerup', event => {
  // Mobile browsers may shift a later click onto another nearby native button.
  if (event.pointerType === 'touch') touchPoint = { clientX: event.clientX, clientY: event.clientY };
});
get('graph-board').addEventListener('click', event => {
  const point = event.detail && touchPoint ? touchPoint : event;
  touchPoint = null;
  const button = event.target.closest('button');
  if (button && (button.dataset.vertex !== undefined || !event.detail)) {
    if (!button.disabled) playMove(button.dataset.vertex !== undefined ? { vertex: Number(button.dataset.vertex) } : { edge: button.dataset.edge.split(':').map(Number) });
    return;
  }
  if (!event.detail || animation || daily.loading || review.step !== null) return;
  const edge = pointerEdge(point);
  // Dispatch through the native control so the tutorial and keyboard share one action.
  if (edge) get('graph-board').querySelector(moveSelector({ edge }))?.click();
});
onClick('undo', () => {
  if (animation || tutorialBlocked() || daily.loading || review.step !== null || !sequence.length) return;
  closeResult(); scores.reset(); sequence.pop(); states.pop(); graph = states.at(-1); update({ follow: true }); scores.load();
});
onClick('restart', reset); onClick('try-again', reset); onClick('show-results', openWin);
onClick('mode-tutorial', () => tutorial.enter());
onClick('mode-campaign', () => { if (mode === 'campaign') { cancelAnimation(); daily.cancel(); update(); } else setPuzzle('campaign', LEVELS[campaignIndex]); });
onClick('mode-random', () => { tutorial.leave(); if (mode === 'random') { cancelAnimation(); daily.cancel(); update(); } else randomPuzzle(); });
bindDailyControls(daily, get);
get('level').addEventListener('change', event => selectLevel(event.target.value));
onClick('previous-level', () => selectLevel(campaignIndex)); onClick('next-level', () => selectLevel(campaignIndex + 2)); onClick('result-next', () => selectLevel(campaignIndex + 2));
onClick('new-puzzle', randomPuzzle); get('difficulty').addEventListener('change', randomPuzzle);
onClick('replay', review.play); onClick('replay-result', review.play); onClick('resume-round', () => { review.clear(); update({ follow: true }); });
get('sequence').addEventListener('click', event => {
  const button = event.target.closest('[data-step]'); if (button && !button.disabled) review.inspect(Number(button.dataset.step));
});
onClick('share-replay', () => share(get('share-replay'))); onClick('share-result', () => share(get('share-result')));
get('advanced-features').addEventListener('toggle', () => renderCorrections());
for (const id of ['edit-graph', 'new-graph']) onClick(id, () => {
  if (mode !== 'random' || daily.loading) return;
  setPuzzle('random', id === 'edit-graph' ? puzzleData(graph) : pathGraph(graph.vertices), true);
  get('editor-vertices').focus();
});
get('editor-vertices').addEventListener('change', event => {
  if (editing) setPuzzle('random', pathGraph(Number(event.target.value)), true);
});
get('graph-editor-form').addEventListener('submit', event => {
  event.preventDefault();
  if (editing && !isSolved(graph)) setPuzzle('random', puzzleData(graph));
});
onClick('show-gate-legend', () => {
  for (const icon of get('gate-legend-dialog').querySelectorAll('[data-correction-gate]')) {
    if (!icon.firstChild) icon.appendChild(correctionGlyph(icon.dataset.correctionGate, 22, 22));
  }
});
bindGameDialogs(get, ['gate-legend']); get('score-form').addEventListener('submit', scores.submit);
document.addEventListener('keydown', event => {
  if (tutorialBlocked() || ignoresGameShortcut(event)) return;
  if (event.ctrlKey || event.metaKey) {
    if (!event.shiftKey && event.key.toLowerCase() === 'z') { event.preventDefault(); get('undo').click(); }
  } else if (event.key === 'Backspace') { event.preventDefault(); get('undo').click(); }
  else if (event.key.toLowerCase() === 'r') { event.preventDefault(); reset(); }
});
window.addEventListener('pageshow', event => {
  if (event.persisted) { review.clear(); update({ follow: true }); daily.refresh(); scores.load(); }
});
window.addEventListener('pagehide', () => { cancelAnimation(); review.clear(); daily.cancel(); scores.dispose(); sharing.close(); customJson.close(); });
const customJson = createCustomPuzzleJson({ get, game: GAME,
  exportPuzzle: () => puzzleData(editing ? graph : puzzle),
  importPuzzle: value => setPuzzle('random', puzzleData(value)),
});
const tutorial = createTutorial({
  get, isBlocked: () => daily.loading,
  intro: TUTORIAL_INTRO,
  controls: '#graph-board button, .round-controls button, #review-controls button, #sequence button, #replay-actions button, #campaign-controls button, #campaign-controls select, #custom-controls button, #custom-controls select, #graph-editor-controls button, #custom-details select',
  steps: TUTORIAL.steps.map(({ move, text }) => ({ text, target: '#graph-board ' + moveSelector(move), action: () => playMove(move) })),
  onReset: () => setPuzzle('tutorial', TUTORIAL.graph),
});
if (!startDailyFromLink(daily)) tutorial.enter();
