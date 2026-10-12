import { ZERO_STATE, applyGate, gateRotation, traceDistance, randomTarget, normalize } from '../lib/quantum-golf/quantum.js';
import { BlochSphere } from '../lib/quantum-golf/sphere.js';
import LEVELS from '../lib/quantum-golf/levels.json' with { type: 'json' };
const LEADERBOARD_API = import.meta.env?.PUBLIC_QUANTUM_GOLF_API || 'https://quantum-golf-scores-colin.astralpine1.chatgpt.site/api/leaderboard';

const get = id => document.getElementById(id);
const onClick = (id, action) => get(id).addEventListener('click', action);
const dialog = get('win-dialog');
let level = LEVELS[0], freeEpsilon = Number(get('epsilon').value);
let state = ZERO_STATE, target = level.target, sequence = '';
let busy = false, picking = false, won = false;
let boardAbort, scoreAbort, worker, currentPlayer = null;
const epsilon = () => level ? level.epsilon : freeEpsilon;
const sphere = new BlochSphere(get('sphere'), { onPick: setTarget });

function update() {
  const wasWon = won;
  won = traceDistance(state, target) <= epsilon() + 1e-12;
  get('epsilon').value = epsilon();
  get('epsilon-value').textContent = `ε = ${epsilon().toFixed(3)}`;
  get('sequence').textContent = [...sequence].join(' ');
  get('status').textContent = picking ? 'Click the sphere' : won ? 'In the hole!' : '';
  get('pick-target').setAttribute('aria-pressed', String(picking));
  get('level').value = level ? String(level.id) : 'infinite';
  get('level').disabled = busy;
  get('previous-level').disabled = busy || level?.id === 1;
  for (const id of ['next-level', 'result-next']) get(id).disabled = busy || !level || !won;
  get('free-controls').hidden = Boolean(level);
  get('leaderboard-section').hidden = !level;
  get('best-count').hidden = Boolean(level);
  get('hole-controls').title = level ? 'Fixed hole for this level' : '';
  for (const gate of ['h', 't']) get(`gate-${gate}`).disabled = busy || won || picking;
  for (const id of ['new-hole', 'pick-target', 'epsilon']) get(id).disabled = busy || Boolean(level);
  get('restart').disabled = busy;
  get('coordinate-form').querySelector('button').disabled = busy || Boolean(level);
  get('undo').disabled = busy || !sequence;
  get('score-form').hidden = Boolean(currentPlayer);
  get('show-results').hidden = !level || !won;
  get('win-results').hidden = !currentPlayer;
  for (const id of ['player-name', 'submit-score']) get(id).disabled = Boolean(scoreAbort || currentPlayer);
  sphere.setState({ state, target, epsilon: epsilon(), pickMode: picking, sequence, animation: null });
  if (level && won && !wasWon) openWin();
}

function openWin() {
  if (!level || !won || dialog.open) return;
  dialog.showModal();
  get(currentPlayer ? 'result-next' : 'player-name').focus();
  if (currentPlayer) loadLeaderboard();
}

function resetScores() {
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
  resetScores();
  state = ZERO_STATE;
  sequence = '';
  picking = false;
  get('target-theta').value = (Math.acos(target[2]) * 180 / Math.PI).toFixed(2);
  get('target-phi').value = ((Math.atan2(target[1], target[0]) * 180 / Math.PI + 360) % 360).toFixed(2);
  update();
}

function bestScore() {
  worker?.terminate();
  worker = null;
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
  if (busy || level) return;
  target = normalize(point);
  reset();
  bestScore();
}

function selectLevel(value) {
  if (busy) { update(); return; }
  const next = value === 'infinite' ? null : LEVELS[Number(value) - 1];
  if (next === undefined) return;
  level = next;
  target = level ? level.target : randomTarget(freeEpsilon);
  reset();
  bestScore();
  loadLeaderboard();
}

function leaderboard({ entries = [], currentPlayer: player = null, total = 0 } = {}) {
  // The server validates scores and returns them in rank order.
  currentPlayer = player;
  get('player-rank').textContent = player
    ? `Your rank: ${player.rank} / ${total} · Best: ${player.moves} ${player.moves === 1 ? 'stroke' : 'strokes'}` : '';
  const ranked = [{ rank: '—', name: 'Optimal', moves: level.optimalMoves }, ...entries];
  for (const id of ['leaderboard-body', 'result-leaderboard-body']) {
    get(id).replaceChildren(...ranked.map((entry, index) => {
      const row = document.createElement('tr');
      const own = index > 0 && entry.id === player?.id;
      row.className = index === 0 ? 'benchmark' : own ? 'current-player' : '';
      for (const value of [entry.rank, entry.name + (own ? ' (you)' : ''), entry.moves]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.appendChild(cell);
      }
      return row;
    }));
  }
}

async function fetchScores(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error('Scores unavailable');
  return response.json();
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
    const data = await fetchScores(`${LEADERBOARD_API}?level=${level.id}${player}`, { signal: request.signal });
    if (boardAbort === request) leaderboard(data);
  } catch (error) {
    if (boardAbort === request && error.name !== 'AbortError') {
      get('leaderboard-status').textContent = 'Scores temporarily unavailable.';
    }
  }
}

async function submitScore(event) {
  event.preventDefault();
  if (!level || !won || scoreAbort || currentPlayer || !get('score-form').reportValidity()) return;
  const name = get('player-name').value.trim();
  if (!name || Array.from(name).length > 24) {
    get('score-status').textContent = 'Use 1–24 characters.';
    return;
  }
  const submission = scoreAbort = new AbortController();
  get('score-status').textContent = 'Saving…';
  update();
  try {
    const data = await fetchScores(LEADERBOARD_API, {
      method: 'POST', signal: submission.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: level.id, name, sequence }),
    });
    if (scoreAbort !== submission) return;
    get('score-status').textContent = 'Score saved.';
    boardAbort?.abort();
    boardAbort = null;
    leaderboard(data);
    get('leaderboard-status').textContent = '';
  } catch (error) {
    if (scoreAbort === submission && error.name !== 'AbortError') {
      get('score-status').textContent = 'Scores temporarily unavailable.';
    }
  } finally {
    if (scoreAbort === submission) {
      scoreAbort = null;
      update();
      if (currentPlayer && dialog.open) get('result-next').focus();
    }
  }
}

function apply(gate) {
  if (busy || won || picking) return;
  const rotate = gateRotation(state, gate);
  const moveCamera = sphere.cameraTo(rotate(1));
  busy = true;
  update();
  const start = performance.now();
  const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 400;
  function frame(now) {
    const progress = duration ? Math.max(0, Math.min(1, (now - start) / duration)) : 1;
    const point = rotate(progress);
    moveCamera(progress);
    sphere.setState({ state: point, animation: { gate, rotate, progress } });
    if (progress < 1) requestAnimationFrame(frame);
    else {
      sequence += gate;
      state = point;
      busy = false;
      update();
    }
  }
  requestAnimationFrame(frame);
}

function undo() {
  if (busy || !sequence) return;
  resetScores();
  sequence = sequence.slice(0, -1);
  state = [...sequence].reduce(applyGate, ZERO_STATE);
  update();
}

function newHole() {
  if (!busy && !level) setTarget(randomTarget(epsilon()));
}

function nextLevel() {
  if (!busy && level && won) selectLevel(level.id === LEVELS.length ? 'infinite' : level.id + 1);
}

get('level').addEventListener('change', () => selectLevel(get('level').value));
onClick('previous-level', () => {
  if (!busy && (!level || level.id > 1)) selectLevel(level ? level.id - 1 : LEVELS.length);
});
onClick('next-level', nextLevel);
onClick('result-next', nextLevel);
onClick('try-again', reset);
onClick('close-win', () => dialog.close());
onClick('show-results', openWin);
get('score-form').addEventListener('submit', submitScore);
onClick('gate-h', () => apply('H'));
onClick('gate-t', () => apply('T'));
onClick('undo', undo);
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
  if (!busy && !level && value > 0 && value < 1) {
    freeEpsilon = value;
    bestScore();
  }
  update();
});
onClick('reset-view', () => sphere.resetView());
onClick('pick-target', () => {
  if (busy || level) return;
  picking = !picking;
  update();
  if (picking) get('sphere').focus({ preventScroll: true });
});
get('coordinate-form').addEventListener('submit', event => {
  event.preventDefault();
  if (busy || level || !get('coordinate-form').reportValidity()) return;
  const theta = Number(get('target-theta').value) * Math.PI / 180;
  const phi = Number(get('target-phi').value) * Math.PI / 180;
  setTarget([Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta)]);
});

document.addEventListener('keydown', event => {
  if (dialog.open) return;
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || event.target.isContentEditable) return;
  const key = event.key.toLowerCase();
  if (key === 'h' || key === 't') { event.preventDefault(); apply(key.toUpperCase()); }
  else if (key === 'backspace') { event.preventDefault(); undo(); }
  else if (key === 'r') reset();
  else if (key === 'n') newHole();
  else if (key === 'escape') { picking = false; update(); }
  else if (event.target === get('sphere')) {
    const delta = { ArrowLeft: [-30, 0], ArrowRight: [30, 0], ArrowUp: [0, -30], ArrowDown: [0, 30] }[event.key];
    if (delta) { event.preventDefault(); sphere.rotateBy(...delta); }
  }
});

reset();
loadLeaderboard();
