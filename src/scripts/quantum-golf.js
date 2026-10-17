import { createScoreboard } from '../lib/games/scoreboard.js';
import { formatPuzzleDate as dateLabel, bindDailyControls } from '../lib/games/daily-ui.js';
import { createDailySession } from '../lib/games/daily-session.js';
import { startDailyFromLink } from '../lib/games/daily-links.js';
import { createReplayShare } from '../lib/games/replay-share.js';
import { createMoveTimeline } from '../lib/games/move-timeline.js';
import { createCustomPuzzleJson } from '../lib/games/custom-puzzle-json.js';
import { bindGameDialogs, ignoresGameShortcut, updateModeMenu } from '../lib/games/controls.js';
import { createTutorial } from '../lib/games/tutorial.js';
import { renderGolfInstruction } from '../lib/games/tutorial-gates.js';
import { START_STATE, applyGate, gateRotation, traceDistance, randomTarget, normalize } from '../lib/quantum-golf/quantum.js';
import { validateCustomPuzzle } from '../lib/quantum-golf/custom-puzzle.js';
import { DAILY_START } from '../lib/quantum-golf/daily.js';
import { GOLF_TUTORIAL } from '../lib/quantum-golf/tutorial.js';
import { BlochSphere } from '../lib/quantum-golf/sphere.js';
import LEVELS from '../lib/quantum-golf/levels.json' with { type: 'json' };
const VIEW_STEPS = { ArrowLeft: [-30, 0], ArrowRight: [30, 0], ArrowUp: [0, -30], ArrowDown: [0, 30] };
const get = id => document.getElementById(id);
const onClick = (id, action) => get(id).addEventListener('click', action);
const dialog = get('win-dialog');
const shareDialog = get('share-dialog');
const replayGroups = [
  [get('replay-actions'), get('daily-replay-actions'), document.querySelector('#advanced-features .advanced-panel')],
  [get('result-replay-actions'), get('daily-result-actions'), get('result-advanced-features')],
];
let level = LEVELS[0], campaignLevel = level, freeEpsilon = Number(get('epsilon').value);
let state = START_STATE, target = level.target, sequence = '';
let busy = false, picking = false, won = false;
let following = true, precision = false, optimalMoves = null;
let reviewStep = null, stopReplay;
const renderTimeline = createMoveTimeline(get('sequence'), (gate, index) => ({ text: gate, label: `Step ${index + 1}: ${gate}` }));
let worker, tutorial, tutorialMode = false, stopGate, finishGate;
const tutorialBlocked = () => tutorialMode && !tutorial.executing;
const epsilon = () => level ? level.epsilon : freeEpsilon;
const circuitAt = (step = sequence.length) => {
  let point = START_STATE;
  for (let index = 0; index < step; index++) point = applyGate(point, sequence[index]);
  return point;
};
const campaign = () => !tutorialMode && Boolean(level && !level.date);
const mode = () => tutorialMode ? 'tutorial' : level?.date ? 'daily' : level ? 'campaign' : 'random';
const canScore = () => Boolean(!tutorialMode && level && (!level.date ||
  (level.acceptingScores && daily.serverTime() >= level.opensAt && daily.serverTime() < level.closesAt)));
const scoreSelector = () => level.date ? { date: level.date } : { level: level.id };
const sphere = new BlochSphere(get('sphere'), { onPick: setTarget });
const sharing = createReplayShare({ get,
  createWorker: () => new Worker(new URL('./quantum-golf-gif-worker.js', import.meta.url), { type: 'module' }),
});
const scores = createScoreboard({
  get, selector: () => !tutorialMode && level ? scoreSelector() : null,
  benchmark: () => tutorialMode ? {} : { optimalMoves: level?.optimalMoves, unit: 'stroke' },
  canSubmit: () => !busy && !daily.loading && canScore() && won,
  sequence: () => sequence, update: () => update(),
  onDailyClosed: () => { level.acceptingScores = false; daily.load(level.date, false); },
});
const daily = createDailySession({
  game: 'quantum-golf', startDate: DAILY_START, get, update, selectedDate: () => level?.date, isBusy: () => busy && !tutorialMode,
  validatePuzzle(puzzle) {
    normalize(puzzle.target);
    if (!Number.isFinite(puzzle.epsilon) || puzzle.epsilon < 0 || puzzle.epsilon > 1) {
      throw new Error('Invalid daily hole size.');
    }
    return puzzle;
  },
  onPuzzle(info, select) {
    if (!select && level?.date !== info.date) return;
    if (select) leaveTutorial();
    const same = level?.date === info.date;
    level = { ...info.puzzle, date: info.date, opensAt: info.opensAt, closesAt: info.closesAt,
      acceptingScores: info.acceptingScores };
    precision = false; target = level.target;
    if (!same) { reset(); bestScore(); }
  },
});
const customJson = createCustomPuzzleJson({
  get, game: 'quantum-golf', exportPuzzle: () => ({ target: [...target], epsilon: epsilon() }),
  importPuzzle(value) {
    if (busy || daily.loading || level) throw new Error('Choose Custom/Random before importing a puzzle.');
    const puzzle = validateCustomPuzzle(value);
    daily.cancel(); precision = false; freeEpsilon = puzzle.epsilon; target = puzzle.target;
    reset(); bestScore();
  },
});
tutorial = createTutorial({
  get,
  renderText: renderGolfInstruction,
  intro: 'Reach the gold target with H and T.',
  isBlocked: () => daily.loading,
  controls: '.gates button, .round-controls button, #sequence button, .advanced-panel button, #coordinate-form button',
  steps: GOLF_TUTORIAL.moves.map(({ gate, text }) => ({ text, target: '#gate-' + gate.toLowerCase(), action: () => apply(gate) })),
  onReset() {
    cancelGate(); clearReview(); daily.cancel(); worker?.terminate(); worker = null;
    tutorialMode = true; level = LEVELS[GOLF_TUTORIAL.level - 1]; target = level.target;
    precision = false; optimalMoves = null; reset();
  },
  onLeave: cancelGate,
});

function leaveTutorial() {
  if (!tutorialMode) return;
  tutorial.leave(); tutorialMode = false;
}

function update(visibleState) {
  const wasWon = won;
  const locked = busy || daily.loading;
  const holeSize = epsilon(), currentMode = mode(), isCampaign = currentMode === 'campaign';
  const isDaily = currentMode === 'daily';
  const scorable = canScore(), hasPlayer = Boolean(scores.player), showForm = scorable && !hasPlayer && !scores.automatic;
  const fixed = Boolean(level);
  customJson.update({ visible: !fixed, disabled: locked });
  won = traceDistance(state, target) <= holeSize + 1e-12;
  get('epsilon').value = holeSize;
  get('epsilon-value').textContent = `ε = ${holeSize.toFixed(3)}`;
  renderTimeline(sequence, { step: reviewStep, disabled: locked });
  get('review-controls').hidden = reviewStep === null;
  get('review-note').textContent = reviewStep === null ? '' : `Step ${reviewStep} / ${sequence.length}`;
  get('replay').hidden = !sequence;
  for (const id of ['replay', 'replay-result']) get(id).disabled = locked || !sequence || Boolean(stopReplay);
  for (const [actions, regular, advanced] of replayGroups) {
    const destination = isDaily ? regular : advanced;
    if (actions.parentElement !== destination) destination.appendChild(actions);
    regular.hidden = !isDaily;
  }
  get('result-advanced-features').hidden = isDaily && get('nickname-form').hidden;
  for (const id of ['share-score', 'share-result']) {
    get(id).hidden = tutorialMode || !level || !won || !sequence;
    get(id).disabled = locked || Boolean(scores.submitting);
  }
  get('status').textContent = picking ? 'Click the sphere' : won ? 'In the hole!' : '';
  get('pick-target').setAttribute('aria-pressed', String(picking));
  if (isCampaign) get('level').value = String(level.id);
  get('level').disabled = locked;
  get('campaign-controls').hidden = !isCampaign;
  get('daily-heading').hidden = !isDaily;
  if (isDaily) {
    get('daily-title').textContent = `Daily puzzle · ${dateLabel(level.date)}`;
    get('daily-note').textContent = scorable ? 'Scores close at midnight (Paris).' : 'Practice · leaderboard closed.';
  }
  updateModeMenu(get, currentMode, busy && !tutorialMode, scores.submitting);
  get('daily-date').disabled = busy || !daily.info;
  get('show-rules').disabled = busy && !tutorialMode;
  get('previous-level').disabled = locked || !isCampaign || level.id === 1;
  for (const id of ['next-level', 'result-next']) get(id).disabled = locked || scores.submitting || !isCampaign || !won;
  get('result-next').hidden = !isCampaign;
  for (const id of ['free-controls', 'best-count', 'hole-controls']) get(id).hidden = fixed;
  get('leaderboard-section').hidden = tutorialMode || !fixed;
  for (const gate of ['h', 't']) get(`gate-${gate}`).disabled = locked || won || picking || reviewStep !== null;
  for (const id of ['new-hole', 'pick-target', 'epsilon']) get(id).disabled = locked || fixed || precision;
  get('pick-target').disabled ||= reviewStep !== null;
  get('toggle-precision').disabled = locked || fixed;
  get('toggle-precision').setAttribute('aria-pressed', String(precision));
  for (const id of ['precision-next', 'precision-result']) {
    get(id).hidden = !precision || !won || holeSize <= 0.03;
    get(id).disabled = locked;
  }
  get('toggle-follow').disabled = busy || Boolean(stopReplay);
  get('toggle-follow').setAttribute('aria-pressed', String(following));
  get('restart').disabled = locked;
  get('coordinate-form').querySelector('button').disabled = locked || fixed || precision;
  get('undo').disabled = locked || !sequence;
  get('score-form').hidden = !showForm;
  get('show-results').hidden = tutorialMode || !sequence || !won;
  get('show-results').textContent = scorable || hasPlayer ? 'Scores' : 'Result';
  get('win-results').hidden = !hasPlayer;
  get('win-practice').hidden = !level?.date || scorable || hasPlayer;
  get('result-actions').hidden = showForm;
  const minimum = level?.optimalMoves ?? optimalMoves;
  const moves = `${sequence.length} ${sequence.length === 1 ? 'move' : 'moves'}`;
  get('win-summary').textContent = minimum === sequence.length ? `Optimal solution in ${moves}.`
    : moves + (minimum === null ? '' : ` : optimum+${sequence.length - minimum}`);
  for (const id of ['player-name', 'submit-score']) get(id).disabled = Boolean(scores.submitting) || !showForm;
  if (!busy && !stopReplay) {
    const visibleSequence = sequence.slice(0, reviewStep ?? sequence.length);
    sphere.setState({ state: visibleState ?? (reviewStep === null ? state : circuitAt(reviewStep)),
      target, epsilon: holeSize, pickMode: picking, sequence: visibleSequence, animation: null });
  }
  if (sequence && won && !wasWon) openWin();
  tutorial.render();
}

function openWin() {
  if (tutorialMode || !sequence || !won || dialog.open) return;
  if (reviewStep !== null) { clearReview(); update(); }
  scores.autoSubmit();
  dialog.showModal();
  get(scores.automatic ? 'close-win' : scores.player || !canScore() ? (campaign() ? 'result-next' : 'try-again') : 'player-name').focus();
  if (scores.player) scores.load();
}

function resetScores() {
  sharing.close(); scores.reset(); dialog.close();
  scores.load();
}

function reset() {
  if (busy || tutorialBlocked()) return;
  clearReview();
  resetScores();
  state = START_STATE;
  sequence = '';
  picking = false;
  get('target-theta').value = (Math.acos(target[2]) * 180 / Math.PI).toFixed(2);
  get('target-phi').value = ((Math.atan2(target[1], target[0]) * 180 / Math.PI + 360) % 360).toFixed(2);
  update();
}

function bestScore() {
  worker?.terminate();
  worker = null;
  optimalMoves = null;
  if (tutorialMode || level) return;
  get('best-count').textContent = 'Finding optimum…';
  try {
    const search = new Worker(new URL('./quantum-golf-worker.js', import.meta.url), { type: 'module' });
    worker = search;
    const finish = data => {
      if (worker !== search) return;
      const minimum = data?.status === 'optimal' && Number.isSafeInteger(data.optimalMoves) && data.optimalMoves >= 0
        ? data.optimalMoves : null;
      get('best-count').textContent = minimum !== null ? `Optimal: ${minimum} strokes`
        : data?.status === 'boundary' ? 'Boundary requires higher precision'
        : data?.status === 'limit' && Number.isSafeInteger(data.checkedDepth) && data.checkedDepth >= -1
          ? `No solution through ${Math.max(0, data.checkedDepth)} strokes` : 'Optimum unavailable';
      search.terminate();
      worker = null;
      optimalMoves = minimum;
      update();
    };
    search.onmessage = ({ data }) => finish(data);
    const fail = event => { event?.preventDefault(); finish(); };
    search.onerror = search.onmessageerror = fail;
    search.postMessage({ target, epsilon: epsilon() });
  } catch {
    worker?.terminate();
    worker = null;
    get('best-count').textContent = 'Optimum unavailable';
  }
}

function setTarget(point) {
  if (busy || daily.loading || level || precision) return;
  target = normalize(point);
  reset();
  bestScore();
}

function selectLevel(value) {
  if (busy && !tutorialMode) { update(); return; }
  const next = value === 'infinite' ? null : LEVELS[Number(value) - 1];
  if (next === undefined) return;
  leaveTutorial();
  daily.cancel();
  precision = false;
  level = next;
  if (level) campaignLevel = level;
  target = level ? level.target : randomTarget(freeEpsilon);
  reset();
  bestScore();
}

async function submitScore(event) {
  await scores.submit(event);
  if (scores.player && dialog.open) get(campaign() ? 'result-next' : 'try-again').focus();
}

function shareScore(source) {
  if (tutorialMode || busy || daily.loading || !won || !level || !sequence || shareDialog.open) return;
  const styles = typeof getComputedStyle === 'function' ? getComputedStyle(get('sphere')) : null;
  const round = {
    label: level.date ? `Daily puzzle : ${dateLabel(level.date)}` : `Level : ${level.id}`,
    sequence, target: [...target], epsilon: epsilon(), optimalMoves: level.optimalMoves,
    background: styles?.getPropertyValue('--color-bg').trim() || '#18231e',
    textColor: styles?.getPropertyValue('--color-text').trim() || '#dde3d7',
    headingColor: styles?.getPropertyValue('--color-heading').trim() || '#fff3cf',
  };
  const filename = `quantum-golf-${level.date ?? `level-${level.id}`}.gif`;
  sharing.open(source, round, filename);
}

function animateGate(from, gate, done) {
  const rotate = gateRotation(from, gate);
  const moveCamera = following ? sphere.cameraTo(rotate(1)) : () => {};
  let frameId, cancelled = false;
  const start = performance.now();
  const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 400;
  function frame(now) {
    if (cancelled) return;
    const progress = duration ? Math.max(0, Math.min(1, (now - start) / duration)) : 1;
    const point = rotate(progress);
    moveCamera(progress);
    sphere.setState({ state: point, animation: { gate, rotate, progress } });
    if (progress < 1) frameId = requestAnimationFrame(frame);
    else done(point);
  }
  frameId = requestAnimationFrame(frame);
  return () => { cancelled = true; cancelAnimationFrame(frameId); };
}

function cancelGate() {
  stopGate?.(); stopGate = null;
  const finish = finishGate; finishGate = null; busy = false;
  finish?.();
}

function apply(gate) {
  if (tutorialBlocked() || busy || daily.loading || won || picking || reviewStep !== null) return;
  busy = true;
  update();
  return new Promise(resolve => {
    finishGate = resolve;
    stopGate = animateGate(state, gate, point => {
      stopGate = finishGate = null;
      sequence += gate; state = point; busy = false;
      update(); resolve();
    });
  });
}

function clearReview() {
  stopReplay?.();
  stopReplay = null;
  reviewStep = null;
}

function inspectStep(step) {
  if (tutorialBlocked() || busy || daily.loading) return;
  clearReview();
  reviewStep = step;
  picking = false;
  dialog.close();
  if (!level?.date) get('advanced-features').open = true;
  const point = circuitAt(step);
  update(point);
  if (following) sphere.focus(point);
}

function replaySolution() {
  if (tutorialBlocked() || busy || daily.loading || !sequence) return;
  inspectStep(0);
  function next(from) {
    if (reviewStep === sequence.length) return;
    stopReplay = animateGate(from, sequence[reviewStep], point => {
      reviewStep++;
      stopReplay = null;
      update(point);
      next(point);
    });
    update(from);
  }
  next(START_STATE);
}

function undo() {
  if (tutorialBlocked() || busy || daily.loading || !sequence) return;
  clearReview();
  resetScores();
  sequence = sequence.slice(0, -1);
  state = circuitAt();
  update();
  if (following) sphere.focus(state);
}

function newHole() {
  setTarget(randomTarget(epsilon()));
}

function smallerHole() {
  if (busy || daily.loading || level || !precision || !won || freeEpsilon <= 0.03) return;
  freeEpsilon = Math.max(0.03, Number((Math.round(freeEpsilon * 0.7 / 0.005) * 0.005).toFixed(3)));
  reset();
  bestScore();
}

function nextLevel() {
  if (!busy && campaign() && won) selectLevel(level.id === LEVELS.length ? 'infinite' : level.id + 1);
}

get('level').addEventListener('change', () => selectLevel(get('level').value));
get('sequence').addEventListener('click', event => {
  const button = event.target.closest('button[data-step]');
  const step = Number(button?.getAttribute('data-step'));
  if (button?.parentElement === event.currentTarget && !button.disabled && Number.isInteger(step) && step > 0 && step <= sequence.length) inspectStep(step);
});
onClick('previous-level', () => {
  if (!busy && campaign() && level.id > 1) selectLevel(level.id - 1);
});
onClick('mode-campaign', () => {
  if (busy && !tutorialMode) return;
  if (campaign()) { daily.cancel(); update(); }
  else selectLevel(campaignLevel.id);
});
onClick('mode-random', () => {
  if (busy && !tutorialMode) return;
  if (tutorialMode || level) selectLevel('infinite');
  else { daily.cancel(); update(); }
});
onClick('mode-tutorial', () => tutorial.enter());
bindDailyControls(daily, get);
for (const id of ['next-level', 'result-next']) onClick(id, nextLevel);
onClick('try-again', reset);
bindGameDialogs(get);
onClick('show-results', openWin);
get('score-form').addEventListener('submit', submitScore);
onClick('gate-h', () => apply('H'));
onClick('gate-t', () => apply('T'));
onClick('undo', undo);
for (const id of ['replay', 'replay-result']) onClick(id, replaySolution);
for (const id of ['share-score', 'share-result']) onClick(id, () => shareScore(get(id)));
onClick('resume-round', () => { clearReview(); update(); if (following) sphere.focus(state); });
onClick('toggle-precision', () => {
  if (busy || daily.loading || level) return;
  precision = !precision;
  picking = false;
  update();
});
for (const id of ['precision-next', 'precision-result']) onClick(id, smallerHole);
onClick('toggle-follow', () => { if (!busy && !stopReplay) { following = !following; update(); } });
onClick('view-target', () => sphere.focus(target));
for (const [key, delta] of Object.entries(VIEW_STEPS)) {
  onClick(`view-${key.slice(5).toLowerCase()}`, () => sphere.rotateBy(...delta));
}
for (const [id, factor] of [['zoom-in', 1.2], ['zoom-out', 1 / 1.2]]) onClick(id, () => sphere.zoomBy(factor));
onClick('restart', reset);
onClick('toggle-trace', () => {
  const button = get('toggle-trace');
  const showTrace = button.getAttribute('aria-pressed') !== 'true';
  button.setAttribute('aria-pressed', String(showTrace));
  sphere.setState({ showTrace });
});
onClick('new-hole', newHole);
get('epsilon').addEventListener('input', () => {
  const value = Number(get('epsilon').value);
  if (!busy && !level && !precision && value > 0 && value < 1) {
    freeEpsilon = value;
    bestScore();
  }
  update();
});
onClick('pick-target', () => {
  if (busy || level || precision || reviewStep !== null) return;
  picking = !picking;
  update();
  if (picking) get('sphere').focus({ preventScroll: true });
});
get('coordinate-form').addEventListener('submit', event => {
  event.preventDefault();
  if (busy || level || precision || !get('coordinate-form').reportValidity()) return;
  const theta = Number(get('target-theta').value) * Math.PI / 180;
  const phi = Number(get('target-phi').value) * Math.PI / 180;
  setTarget([Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta)]);
});

document.addEventListener('keydown', event => {
  if (tutorialMode || ignoresGameShortcut(event) || daily.loading) return;
  if (event.ctrlKey || event.metaKey) {
    if (!event.shiftKey && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); }
    return;
  }
  const key = event.key.toLowerCase();
  if (key === 'h' || key === 't') { event.preventDefault(); apply(key.toUpperCase()); }
  else if (key === 'backspace') { event.preventDefault(); undo(); }
  else if (key === 'r') reset();
  else if (key === 'n') newHole();
  else if (key === 'escape') { picking = false; update(); }
  else if (event.target === get('sphere')) {
    const delta = VIEW_STEPS[event.key];
    if (delta) { event.preventDefault(); sphere.rotateBy(...delta); }
  }
});

window.addEventListener('pagehide', () => {
  tutorial.leave(); cancelGate();
  daily.cancel(); scores.dispose(); clearReview(); customJson.close();
  if (worker) { worker.terminate(); worker = null; get('best-count').textContent = 'Optimum unavailable'; }
  sharing.close();
});
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  if (tutorialMode) { tutorial.enter(); return; }
  update(); daily.refresh(); scores.load();
});
if (!startDailyFromLink(daily)) tutorial.enter();
