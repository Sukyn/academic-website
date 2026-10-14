import { ScoreError, fetchJson } from '../lib/games/http.js';
import { renderLeaderboard } from '../lib/games/leaderboard.js';
import { formatPuzzleDate as dateLabel, populateDailyArchive } from '../lib/games/daily-ui.js';
import { createReplayShare } from '../lib/games/replay-share.js';
import { START_STATE, applyGate, gateRotation, traceDistance, randomTarget, normalize } from '../lib/quantum-golf/quantum.js';
import { BlochSphere } from '../lib/quantum-golf/sphere.js';
import LEVELS from '../lib/quantum-golf/levels.json' with { type: 'json' };
const LEADERBOARD_API = '/api/leaderboard';
const VIEW_STEPS = { ArrowLeft: [-30, 0], ArrowRight: [30, 0], ArrowUp: [0, -30], ArrowDown: [0, 30] };
const get = id => document.getElementById(id);
const onClick = (id, action) => get(id).addEventListener('click', action);
const dialog = get('win-dialog'), rulesDialog = get('rules-dialog');
const shareDialog = get('share-dialog');
const replayGroups = [
  [get('replay-actions'), get('daily-replay-actions'), document.querySelector('#advanced-features .advanced-panel')],
  [get('result-replay-actions'), get('daily-result-actions'), get('result-advanced-features')],
];
let level = LEVELS[0], campaignLevel = level, freeEpsilon = Number(get('epsilon').value);
let state = START_STATE, target = level.target, sequence = '';
let busy = false, picking = false, won = false;
let following = true, precision = false, optimalMoves = null;
let reviewStep = null, stopReplay, renderedSequence = '', sequenceLocked = false, reviewedButton;
let boardAbort, scoreAbort, worker, currentPlayer = null;
let dailyAbort, dailyInfo, dailyReceived, dailyTimer, archiveRange, loadingDaily = false;
const epsilon = () => level ? level.epsilon : freeEpsilon;
const circuitAt = (step = sequence.length) => {
  let point = START_STATE;
  for (let index = 0; index < step; index++) point = applyGate(point, sequence[index]);
  return point;
};
const campaign = () => Boolean(level && !level.date);
const mode = () => level?.date ? 'daily' : level ? 'campaign' : 'random';
const serverTime = () => dailyInfo ? dailyInfo.serverNow + performance.now() - dailyReceived : Date.now();
const canScore = () => Boolean(level && (!level.date ||
  (level.acceptingScores && serverTime() >= level.opensAt && serverTime() < level.closesAt)));
const scoreSelector = () => level.date ? { date: level.date } : { level: level.id };
const sphere = new BlochSphere(get('sphere'), { onPick: setTarget });
const sharing = createReplayShare({ get, createGif: async (...args) => {
  const { createReplayGif } = await import('../lib/quantum-golf/replay-gif.js');
  return createReplayGif(...args);
} });

function update(visibleState) {
  const wasWon = won;
  const locked = busy || loadingDaily;
  const holeSize = epsilon(), currentMode = mode(), isCampaign = currentMode === 'campaign';
  const isDaily = currentMode === 'daily';
  const scorable = canScore(), hasPlayer = Boolean(currentPlayer), showForm = scorable && !hasPlayer;
  const fixed = Boolean(level);
  won = traceDistance(state, target) <= holeSize + 1e-12;
  get('epsilon').value = holeSize;
  get('epsilon-value').textContent = `ε = ${holeSize.toFixed(3)}`;
  const gateButtons = get('sequence');
  if (renderedSequence !== sequence) {
    let shared = 0;
    while (shared < Math.min(renderedSequence.length, sequence.length) && renderedSequence[shared] === sequence[shared]) shared++;
    while (gateButtons.children.length > shared) gateButtons.lastElementChild.remove();
    const added = document.createDocumentFragment();
    for (let index = shared; index < sequence.length; index++) {
      const gate = sequence[index];
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = gate;
      button.disabled = locked;
      button.setAttribute('data-step', String(index + 1));
      button.setAttribute('aria-label', `Step ${index + 1}: ${gate}`);
      button.setAttribute('aria-current', 'false');
      added.appendChild(button);
    }
    gateButtons.appendChild(added);
    renderedSequence = sequence;
  }
  if (sequenceLocked !== locked) {
    for (const button of gateButtons.children) button.disabled = locked;
    sequenceLocked = locked;
  }
  const active = reviewStep === null ? null : gateButtons.children[reviewStep - 1];
  if (reviewedButton !== active) {
    reviewedButton?.setAttribute('aria-current', 'false');
    active?.setAttribute('aria-current', 'step');
    reviewedButton = active;
  }
  get('review-controls').hidden = reviewStep === null;
  get('review-note').textContent = reviewStep === null ? '' : `Step ${reviewStep} / ${sequence.length}`;
  get('replay').hidden = !sequence;
  for (const id of ['replay', 'replay-result']) get(id).disabled = locked || !sequence || Boolean(stopReplay);
  for (const [actions, regular, advanced] of replayGroups) {
    const destination = isDaily ? regular : advanced;
    if (actions.parentElement !== destination) destination.appendChild(actions);
    regular.hidden = !isDaily;
  }
  get('result-advanced-features').hidden = isDaily;
  for (const id of ['share-score', 'share-result']) {
    get(id).hidden = !level || !won || !sequence;
    get(id).disabled = locked || Boolean(scoreAbort);
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
  for (const name of ['campaign', 'random', 'daily']) {
    get(`mode-${name}`).setAttribute('aria-pressed', String(currentMode === name));
    get(`mode-${name}`).disabled = busy;
  }
  get('daily-date').disabled = busy || !dailyInfo;
  get('show-rules').disabled = busy;
  get('previous-level').disabled = locked || !isCampaign || level.id === 1;
  for (const id of ['next-level', 'result-next']) get(id).disabled = locked || !isCampaign || !won;
  get('result-next').hidden = !isCampaign;
  for (const id of ['free-controls', 'best-count', 'hole-controls']) get(id).hidden = fixed;
  get('leaderboard-section').hidden = !fixed;
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
  get('show-results').hidden = !sequence || !won;
  get('show-results').textContent = scorable || hasPlayer ? 'Scores' : 'Result';
  get('win-results').hidden = !hasPlayer;
  get('win-practice').hidden = !level?.date || scorable || hasPlayer;
  get('result-actions').hidden = showForm;
  const minimum = level?.optimalMoves ?? optimalMoves;
  const moves = `${sequence.length} ${sequence.length === 1 ? 'move' : 'moves'}`;
  get('win-summary').textContent = minimum === sequence.length ? `Optimal solution in ${moves}.`
    : moves + (minimum === null ? '' : ` : optimum+${sequence.length - minimum}`);
  for (const id of ['player-name', 'submit-score']) get(id).disabled = Boolean(scoreAbort) || !showForm;
  if (!busy && !stopReplay) {
    const visibleSequence = sequence.slice(0, reviewStep ?? sequence.length);
    sphere.setState({ state: visibleState ?? (reviewStep === null ? state : circuitAt(reviewStep)),
      target, epsilon: holeSize, pickMode: picking, sequence: visibleSequence, animation: null });
  }
  if (sequence && won && !wasWon) openWin();
}

function openWin() {
  if (!sequence || !won || dialog.open) return;
  if (reviewStep !== null) { clearReview(); update(); }
  dialog.showModal();
  get(currentPlayer || !canScore() ? (campaign() ? 'result-next' : 'try-again') : 'player-name').focus();
  if (currentPlayer) loadLeaderboard();
}

function resetScores() {
  sharing.close();
  scoreAbort?.abort();
  scoreAbort = null;
  // A saved result may have a personalized refresh pending.
  if (currentPlayer) {
    boardAbort?.abort();
    boardAbort = null;
  }
  currentPlayer = null;
  dialog.close();
  get('score-status').textContent = '';
}

function reset() {
  if (busy) return;
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
  if (level) return;
  get('best-count').textContent = 'Finding optimum…';
  try {
    const search = new Worker(new URL('./quantum-golf-worker.js', import.meta.url), { type: 'module' });
    worker = search;
    const finish = data => {
      if (worker !== search) return;
      get('best-count').textContent = data.status === 'optimal'
        ? `Optimal: ${data.optimalMoves} strokes`
        : data.status === 'error' ? 'Optimum unavailable'
        : data.status === 'boundary' ? 'Boundary requires higher precision'
          : `No solution through ${Math.max(0, data.checkedDepth)} strokes`;
      search.terminate();
      worker = null;
      optimalMoves = data.status === 'optimal' ? data.optimalMoves : null;
      update();
    };
    search.onmessage = ({ data }) => finish(data);
    search.onerror = () => finish({ status: 'error' });
    search.postMessage({ target, epsilon: epsilon() });
  } catch {
    worker?.terminate();
    worker = null;
    get('best-count').textContent = 'Optimum unavailable';
  }
}

function setTarget(point) {
  if (busy || loadingDaily || level || precision) return;
  target = normalize(point);
  reset();
  bestScore();
}

function selectLevel(value) {
  if (busy) { update(); return; }
  const next = value === 'infinite' ? null : LEVELS[Number(value) - 1];
  if (next === undefined) return;
  cancelDaily();
  precision = false;
  level = next;
  if (level) campaignLevel = level;
  target = level ? level.target : randomTarget(freeEpsilon);
  reset();
  bestScore();
  loadLeaderboard();
}

function cancelDaily() {
  dailyAbort?.abort();
  dailyAbort = null;
  clearTimeout(dailyTimer);
  loadingDaily = false;
  get('daily-status').textContent = '';
}

function dailyArchive() {
  const range = `${dailyInfo.startDate}/${dailyInfo.today}`;
  if (archiveRange !== range) {
    archiveRange = range;
    populateDailyArchive(get('daily-date'), dailyInfo);
  }
  get('daily-date').value = level?.date ?? dailyInfo.today;
}

async function loadDaily(date, select = true) {
  if (busy && select) return;
  cancelDaily();
  const request = dailyAbort = new AbortController();
  loadingDaily = select;
  get('daily-status').textContent = 'Loading…';
  update();
  try {
    const info = await fetchJson(`/api/daily${date ? `?date=${encodeURIComponent(date)}` : ''}`, request, { cache: 'no-store' });
    if (dailyAbort !== request) return;
    dailyInfo = info;
    dailyReceived = performance.now();
    clearTimeout(dailyTimer);
    dailyTimer = setTimeout(refreshDaily, Math.max(50, info.nextChangeAt - serverTime() + 50));
    if (select || level?.date === info.date) {
      const same = level?.date === info.date;
      level = { ...info.puzzle, date: info.date, opensAt: info.opensAt, closesAt: info.closesAt,
        acceptingScores: info.acceptingScores };
      precision = false;
      target = level.target;
      if (!same) { reset(); bestScore(); loadLeaderboard(); }
    }
    dailyArchive();
    get('daily-status').textContent = '';
  } catch (error) {
    if (dailyAbort === request) {
      get('daily-status').textContent = error instanceof ScoreError ? error.message : 'Daily puzzle unavailable. Try again.';
      // Retry the requested puzzle, including the first load before dailyInfo exists.
      clearTimeout(dailyTimer);
      const retry = () => {
        if (select && busy) dailyTimer = setTimeout(retry, 1_000);
        else return loadDaily(date, select);
      };
      dailyTimer = setTimeout(retry, 60_000);
    }
  } finally {
    if (dailyAbort === request) { dailyAbort = null; loadingDaily = false; update(); }
  }
}

function refreshDaily() {
  if (dailyAbort || !dailyInfo) return;
  // Keep the current circuit after midnight; yesterday becomes practice.
  update();
  loadDaily(level?.date, false);
}

function leaderboard(data = {}) {
  currentPlayer = renderLeaderboard(data, { optimalMoves: level.optimalMoves, unit: 'stroke', get });
}

async function loadLeaderboard() {
  boardAbort?.abort();
  boardAbort = null;
  get('leaderboard-status').textContent = '';
  if (!level) return;
  const player = currentPlayer ? `&player=${currentPlayer.id}` : '';
  if (!currentPlayer) leaderboard();
  // The controller itself identifies the current request, even after an abort.
  const request = boardAbort = new AbortController();
  try {
    const selector = new URLSearchParams(scoreSelector());
    const data = await fetchJson(`${LEADERBOARD_API}?${selector}${player}`, request);
    if (boardAbort === request) leaderboard(data);
  } catch {
    if (boardAbort === request) {
      get('leaderboard-status').textContent = 'Scores temporarily unavailable.';
    }
  } finally {
    if (boardAbort === request) boardAbort = null;
  }
}

async function submitScore(event) {
  event.preventDefault();
  if (!canScore() || !won || scoreAbort || currentPlayer || !get('score-form').reportValidity()) { update(); return; }
  const name = get('player-name').value.trim();
  if (!name || Array.from(name).length > 24) {
    get('score-status').textContent = 'Use 1–24 characters.';
    return;
  }
  const submission = scoreAbort = new AbortController();
  get('score-status').textContent = 'Saving…';
  update();
  try {
    const data = await fetchJson(LEADERBOARD_API, submission, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...scoreSelector(), name, sequence }),
    });
    if (scoreAbort !== submission) return;
    get('score-status').textContent = 'Score saved.';
    boardAbort?.abort();
    boardAbort = null;
    leaderboard(data);
    get('leaderboard-status').textContent = '';
  } catch (error) {
    if (scoreAbort === submission) {
      get('score-status').textContent = error instanceof ScoreError ? error.message : 'Scores temporarily unavailable.';
      if (error instanceof ScoreError && error.status === 409 && level?.date) {
        level.acceptingScores = false;
        loadDaily(level.date, false);
      }
    }
  } finally {
    if (scoreAbort === submission) {
      scoreAbort = null;
      update();
      if (currentPlayer && dialog.open) get(campaign() ? 'result-next' : 'try-again').focus();
    }
  }
}

async function shareScore(source) {
  if (busy || loadingDaily || !won || !level || !sequence || shareDialog.open) return;
  const styles = typeof getComputedStyle === 'function' ? getComputedStyle(get('sphere')) : null;
  const round = {
    label: level.date ? `Daily puzzle : ${dateLabel(level.date)}` : `Level : ${level.id}`,
    sequence, target: [...target], epsilon: epsilon(), optimalMoves: level.optimalMoves,
    background: styles?.getPropertyValue('--color-bg').trim() || '#18231e',
    textColor: styles?.getPropertyValue('--color-text').trim() || '#dde3d7',
    headingColor: styles?.getPropertyValue('--color-heading').trim() || '#fff3cf',
  };
  const filename = `quantum-golf-${level.date ?? `level-${level.id}`}.gif`;
  await sharing.open(source, round, filename);
}

function animateGate(from, gate, done) {
  const rotate = gateRotation(from, gate);
  const moveCamera = following ? sphere.cameraTo(rotate(1)) : () => {};
  let frameId;
  const start = performance.now();
  const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 400;
  function frame(now) {
    const progress = duration ? Math.max(0, Math.min(1, (now - start) / duration)) : 1;
    const point = rotate(progress);
    moveCamera(progress);
    sphere.setState({ state: point, animation: { gate, rotate, progress } });
    if (progress < 1) frameId = requestAnimationFrame(frame);
    else done(point);
  }
  frameId = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(frameId);
}

function apply(gate) {
  if (busy || loadingDaily || won || picking || reviewStep !== null) return;
  busy = true;
  update();
  animateGate(state, gate, point => {
    sequence += gate;
    state = point;
    busy = false;
    update();
  });
}

function clearReview() {
  stopReplay?.();
  stopReplay = null;
  reviewStep = null;
}

function inspectStep(step) {
  if (busy || loadingDaily) return;
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
  if (busy || loadingDaily || !sequence) return;
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
  if (busy || loadingDaily || !sequence) return;
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
  if (busy || loadingDaily || level || !precision || !won || freeEpsilon <= 0.03) return;
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
  if (busy) return;
  if (campaign()) { cancelDaily(); update(); }
  else selectLevel(campaignLevel.id);
});
onClick('mode-random', () => {
  if (busy) return;
  if (level) selectLevel('infinite');
  else { cancelDaily(); update(); }
});
onClick('mode-daily', () => loadDaily());
onClick('daily-toggle', () => {
  const open = get('daily-archive').hidden;
  get('daily-archive').hidden = !open;
  get('daily-toggle').setAttribute('aria-expanded', String(open));
  if (open && !dailyInfo) loadDaily(undefined, false);
});
get('daily-date').addEventListener('change', () => loadDaily(get('daily-date').value));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshDaily(); });
window.addEventListener('focus', refreshDaily);
for (const id of ['next-level', 'result-next']) onClick(id, nextLevel);
onClick('try-again', reset);
onClick('close-win', () => dialog.close());
onClick('show-rules', () => { if (!busy && !rulesDialog.open) rulesDialog.showModal(); });
onClick('close-rules', () => rulesDialog.close());
onClick('show-results', openWin);
get('score-form').addEventListener('submit', submitScore);
onClick('gate-h', () => apply('H'));
onClick('gate-t', () => apply('T'));
onClick('undo', undo);
for (const id of ['replay', 'replay-result']) onClick(id, replaySolution);
for (const id of ['share-score', 'share-result']) onClick(id, () => shareScore(get(id)));
onClick('resume-round', () => { clearReview(); update(); if (following) sphere.focus(state); });
onClick('toggle-precision', () => {
  if (busy || loadingDaily || level) return;
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
  if (dialog.open || rulesDialog.open || shareDialog.open || loadingDaily) return;
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || event.target.isContentEditable) return;
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

reset();
loadLeaderboard();
