import { getHoles, applyPlacement, simulate, validatePuzzle, validateCustomPuzzle, puzzleData } from '../lib/quantum-signals/engine.js';
import { createPuzzleEditor } from '../lib/quantum-signals/puzzle-editor.js';
import { LEVELS, generatePuzzle, DAILY_START } from '../lib/quantum-signals/puzzles.js';
import { gateIcon, gateLabel, renderBoard, renderFlow, highlightFlow, pinFlowLabels } from '../lib/quantum-signals/rendering.js';
import { createScoreboard } from '../lib/games/scoreboard.js';
import { createDailySession } from '../lib/games/daily-session.js';
import { startDailyFromLink } from '../lib/games/daily-links.js';
import { createReplayShare } from '../lib/games/replay-share.js';
import { createStepReplay } from '../lib/games/step-replay.js';
import { createMoveTimeline } from '../lib/games/move-timeline.js';
import { createCustomPuzzleJson } from '../lib/games/custom-puzzle-json.js';
import { createTutorial } from '../lib/games/tutorial.js';
import { renderCircuitInstruction } from '../lib/games/tutorial-gates.js';
import { TUTORIAL_PUZZLE, TUTORIAL_STEPS } from '../lib/quantum-signals/tutorial.js';
import { bindGameDialogs, ignoresGameShortcut, updateModeMenu } from '../lib/games/controls.js';
import { formatPuzzleDate, bindDailyControls } from '../lib/games/daily-ui.js';

const GAME = 'quantum-signals', get = id => document.getElementById(id);
const onClick = (id, callback) => get(id).addEventListener('click', callback);
let mode = 'tutorial', campaignIndex = 0, puzzle = TUTORIAL_PUZZLE, placements = {}, sequence = [], states = [placements];
let selected = getHoles(puzzle)[0].id;
// Puzzles and placements are replaced rather than mutated. Selection, replay
// and leaderboard updates can reuse this single current-round result.
let evaluatedPuzzle, evaluatedPlacements, cachedWin = false;
function isWon() {
  if (evaluatedPuzzle !== puzzle || evaluatedPlacements !== placements) {
    cachedWin = simulate(puzzle, placements).solved;
    evaluatedPuzzle = puzzle; evaluatedPlacements = placements;
  }
  return cachedWin;
}
const choices = [...document.querySelectorAll('[data-choice]')];
const paletteWires = new WeakMap();
const tutorialBlocked = () => tutorial.active && !tutorial.executing;
const canRecord = () => mode === 'campaign' || mode === 'daily';
const selector = () => mode === 'tutorial' || mode === 'random' ? null : { game: GAME, ...(mode === 'daily' ? { date: puzzle.date } : { level: campaignIndex + 1 }) };
const sharing = createReplayShare({ get,
  createWorker: () => new Worker(new URL('./quantum-signals-gif-worker.js', import.meta.url), { type: 'module' }),
});
const completions = createScoreboard({
  get, selector, completionOnly: true, sequence: () => sequence, update: () => update({ board: false }),
  canSubmit: () => !daily.loading && canRecord() && isWon(),
});
const daily = createDailySession({
  game: GAME, startDate: DAILY_START, ranked: false, get, update: () => update({ board: false }),
  selectedDate: () => mode === 'daily' ? puzzle.date : undefined,
  validatePuzzle,
  onPuzzle(info, select) {
    if (select && (mode !== 'daily' || puzzle.date !== info.date)) {
      tutorial.leave();
      completions.reset();
      mode = 'daily';
      puzzle = { ...info.puzzle, date: info.date };
      reset();
    } else if (mode === 'daily' && puzzle.date === info.date) completions.load();
  },
});
const review = createStepReplay({
  length: () => sequence.length, canReview: () => !tutorial.active && !daily.loading,
  onEnter: () => get('win-dialog').close(), onChange: () => update({ follow: true }),
});

function closeResult() { sharing.close(); get('win-dialog').close(); }
const holeButton = id => id ? get('signal-board').querySelector('[data-hole="' + id + '"]') : null;
function focusSelected() { holeButton(selected)?.focus({ preventScroll: true }); }
function scrollTogether(left) {
  const circuit = get('signal-scroll'), flow = get('flow-scroll');
  // Native clamping includes reserved scrollbar gutters on touch and desktop.
  circuit.scrollLeft = left; flow.scrollLeft = circuit.scrollLeft;
  circuit.scrollLeft = flow.scrollLeft;
  pinFlowLabels(get('signal-flow'), flow.scrollLeft);
}
function followProgress(hole, finished) {
  const scroll = get('signal-scroll');
  if (finished) { scrollTogether(scroll.scrollWidth); return; }
  const button = holeButton(hole);
  if (!button) { scrollTogether(0); return; }
  const bounds = scroll.getBoundingClientRect(), target = button.getBoundingClientRect();
  // Leave the pinned basis labels clear and show both sides of the active gate.
  scrollTogether(scroll.scrollLeft + target.left + target.width / 2 - bounds.left - scroll.clientLeft - (40 + scroll.clientWidth) / 2);
}
function selectHole(id) {
  if (tutorialBlocked() || daily.loading || review.step !== null || selected === id) return;
  selected = id;
  for (const button of get('signal-board').querySelectorAll('[data-hole]')) button.setAttribute('aria-pressed', String(button.dataset.hole === id));
  update({ board: false }); followProgress(selected, false);
}
function navigateHole(key) {
  const origin = holeButton(selected)?.getBoundingClientRect();
  if (!origin) return;
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight', direction = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
  const candidates = [...get('signal-board').querySelectorAll('[data-hole]')].map(button => {
    const rect = button.getBoundingClientRect();
    const dx = rect.left + rect.width / 2 - origin.left - origin.width / 2;
    const dy = rect.top + rect.height / 2 - origin.top - origin.height / 2;
    return { id: button.dataset.hole, forward: direction * (horizontal ? dx : dy), across: Math.abs(horizontal ? dy : dx) };
  }).filter(candidate => candidate.forward > 1);
  candidates.sort((a, b) => a.across - b.across || a.forward - b.forward);
  if (candidates.length) { selectHole(candidates[0].id); focusSelected(); }
}
const renderTimeline = createMoveTimeline(get('sequence'), (move, index) => {
  const label = 'Placement ' + (index + 1) + ': ' + move.hole;
  return { text: move.gate === null ? '×' : move.gate === 'I' ? '—' : move.gate,
    label: label + ' · ' + (move.gate ?? 'erase') };
});
// Only play/navigation actions follow progress; network updates preserve exploration.
function update({ board = true, follow = false } = {}) {
  const visible = review.step === null ? placements : states[review.step];
  const holes = getHoles(puzzle), locked = daily.loading || review.step !== null, won = isWon();
  const activeHole = review.step === null ? selected : sequence[review.step - 1]?.hole;
  if (board) {
    const focused = document.activeElement?.closest('[data-hole]');
    renderBoard(get('signal-board'), puzzle, visible, { selected: activeHole, locked });
    if (focused) focusSelected();
    renderFlow(get('signal-flow'), puzzle, visible, activeHole);
  } else {
    for (const button of get('signal-board').querySelectorAll('[data-hole]')) button.disabled = locked;
    highlightFlow(get('signal-flow'), puzzle, activeHole);
  }
  const hole = holes.find(entry => entry.id === (activeHole ?? selected));
  const wires = hole?.wires.join(':');
  const focusedControl = document.activeElement?.closest('.signal-palette button');
  let shortcut = 0;
  for (const button of choices) {
    button.hidden = !hole?.choices.includes(button.dataset.choice);
    button.disabled = locked;
    button.setAttribute('aria-pressed', String(visible[activeHole ?? selected] === button.dataset.choice));
    if (!button.hidden) {
      const key = String(++shortcut), gate = button.dataset.choice;
      if (paletteWires.get(button) !== wires) {
        button.replaceChildren(gateIcon(gate, hole.wires));
        button.setAttribute('aria-label', gateLabel(gate, hole.wires));
        paletteWires.set(button, wires);
      }
      button.setAttribute('aria-keyshortcuts', key + (gate.length === 1 ? ' ' + gate : ''));
    } else button.removeAttribute('aria-keyshortcuts');
  }
  get('erase-gate').hidden = !Object.hasOwn(visible, selected);
  get('erase-gate').disabled = locked || !Object.hasOwn(placements, selected);
  if (focusedControl?.hidden) focusSelected();
  updateModeMenu(get, mode, false, completions.submitting);
  get('campaign-controls').hidden = mode !== 'campaign'; get('custom-controls').hidden = mode !== 'random';
  get('circuit-editor-controls').hidden = mode !== 'random';
  customJson.update({ visible: mode === 'random', disabled: daily.loading });
  get('leaderboard-section').hidden = mode === 'random' || mode === 'tutorial';
  get('daily-heading').hidden = mode !== 'daily';
  get('daily-date').disabled = !daily.info; get('level').disabled = daily.loading;
  get('level').value = String(campaignIndex + 1);
  get('previous-level').disabled = daily.loading || mode !== 'campaign' || campaignIndex === 0;
  get('next-level').disabled = daily.loading || completions.submitting || mode !== 'campaign' || !won || campaignIndex === LEVELS.length - 1;
  get('result-next').disabled = get('next-level').disabled; get('result-next').hidden = mode !== 'campaign' || campaignIndex === LEVELS.length - 1;
  get('undo').disabled = daily.loading || !sequence.length; get('restart').disabled = daily.loading;
  get('show-results').hidden = mode === 'tutorial' || !won;
  for (const id of ['replay', 'replay-result']) get(id).disabled = daily.loading || !sequence.length || review.playing;
  get('replay').hidden = mode === 'tutorial' || !sequence.length;
  for (const id of ['share-replay', 'share-result']) { get(id).hidden = mode === 'tutorial' || !won || !sequence.length; get(id).disabled = daily.loading; }
  get('review-controls').hidden = review.step === null;
  get('review-note').textContent = review.step === null ? '' : 'Placement ' + review.step + ' / ' + sequence.length;
  renderTimeline(sequence, { step: review.step, disabled: daily.loading });
  const recordable = canRecord(), registered = Boolean(completions.player);
  get('score-form').hidden = !won || !recordable || registered || completions.automatic;
  get('win-results').hidden = !registered;
  for (const id of ['player-name', 'submit-score']) get(id).disabled = daily.loading || completions.submitting || !recordable;
  get('win-summary').textContent = 'Target reached.';
  if (mode === 'daily') {
    get('daily-title').textContent = 'Daily puzzle · ' + formatPuzzleDate(puzzle.date);
  }
  tutorial.render();
  if (follow) followProgress(activeHole, won && (review.step === null || review.step === sequence.length));
}
function reset() {
  if (tutorialBlocked() || daily.loading) return;
  review.clear(); closeResult(); placements = {}; sequence = []; states = [placements]; selected = getHoles(puzzle)[0].id;
  get('flow-scroll').scrollTop = 0;
  get('status').textContent = ''; update({ follow: true }); completions.load();
}
function setPuzzle(nextMode, next) {
  if (nextMode !== 'tutorial') tutorial.leave();
  daily.cancel(); completions.reset(); mode = nextMode; puzzle = next; reset();
}
function selectLevel(value) {
  if (tutorialBlocked()) return;
  const index = Number(value) - 1;
  if (Number.isInteger(index) && LEVELS[index]) { campaignIndex = index; setPuzzle('campaign', LEVELS[index]); }
}
function randomPuzzle() {
  if (tutorialBlocked()) return;
  setPuzzle('random', generatePuzzle(Date.now() + ':' + Math.random(), Number(get('difficulty').value)));
}
function openWin() {
  if (mode === 'tutorial' || !isWon() || get('win-dialog').open) return;
  review.clear(); update(); completions.autoSubmit(); get('win-dialog').showModal();
  get(completions.automatic ? 'close-win' : get('score-form').hidden ? 'try-again' : 'player-name').focus();
}
function place(gate) {
  if (tutorialBlocked() || daily.loading || review.step !== null || !selected || (Object.hasOwn(placements, selected) ? placements[selected] : null) === gate) return;
  try {
    if (sequence.length >= 512) throw new Error('Undo or reset before adding more placements.');
    const move = { hole: selected, gate };
    const next = applyPlacement(puzzle, placements, move);
    closeResult(); placements = next; sequence.push(move); states.push(next);
    if (gate !== null) selected = getHoles(puzzle).find(hole => !Object.hasOwn(next, hole.id))?.id ?? selected;
    get('status').textContent = ''; update({ follow: true });
    if (isWon()) openWin();
  } catch (error) { get('status').textContent = error.message; }
}
function share(source) {
  if (tutorial.active || daily.loading || !isWon() || !sequence.length) return;
  sharing.open(source, { label: mode === 'daily' ? 'Daily puzzle : ' + formatPuzzleDate(puzzle.date) : mode === 'campaign' ? 'Level : ' + (campaignIndex + 1) : 'Custom circuit',
    puzzle: validatePuzzle(puzzle), sequence: sequence.map(move => ({ ...move })) },
  'quantum-signals-' + (puzzle.date ?? (mode === 'campaign' ? campaignIndex + 1 : 'custom')) + '.gif');
}

for (const button of choices) button.addEventListener('click', () => place(button.dataset.choice));
for (const [source, target] of [['signal-scroll', 'flow-scroll'], ['flow-scroll', 'signal-scroll']]) {
  get(source).addEventListener('scroll', () => {
    if (Math.abs(get(target).scrollLeft - get(source).scrollLeft) > 1) scrollTogether(get(source).scrollLeft);
    else pinFlowLabels(get('signal-flow'), get('flow-scroll').scrollLeft);
  }, { passive: true });
}
for (const type of ['click', 'focusin']) get('signal-board').addEventListener(type, event => {
  const hole = event.target.closest('[data-hole]');
  if (hole && !hole.disabled) selectHole(hole.dataset.hole);
});
get('signal-board').addEventListener('contextmenu', event => {
  const hole = event.target.closest('[data-hole]');
  if (!hole || hole.disabled) return;
  event.preventDefault(); selectHole(hole.dataset.hole);
  if (Object.hasOwn(placements, selected)) place(null);
});
onClick('erase-gate', () => place(null));
onClick('undo', () => {
  if (tutorialBlocked() || daily.loading || !sequence.length) return;
  review.clear(); closeResult(); const move = sequence.pop(); states.pop(); placements = states.at(-1); selected = move.hole; update({ follow: true });
});
onClick('restart', reset); onClick('try-again', reset); onClick('show-results', openWin);
onClick('mode-tutorial', () => tutorial.enter());
onClick('mode-campaign', () => { if (mode === 'campaign') { daily.cancel(); update(); } else setPuzzle('campaign', LEVELS[campaignIndex]); });
onClick('mode-random', () => { tutorial.leave(); if (mode === 'random') { daily.cancel(); update(); } else randomPuzzle(); });
bindDailyControls(daily, get);
get('level').addEventListener('change', event => selectLevel(event.target.value));
onClick('previous-level', () => selectLevel(campaignIndex)); onClick('next-level', () => selectLevel(campaignIndex + 2)); onClick('result-next', () => selectLevel(campaignIndex + 2));
onClick('new-puzzle', randomPuzzle); get('difficulty').addEventListener('change', randomPuzzle);
onClick('replay', review.play); onClick('replay-result', review.play); onClick('resume-round', () => { review.clear(); update({ follow: true }); });
get('sequence').addEventListener('click', event => {
  const button = event.target.closest('[data-step]'); if (button && !button.disabled) review.inspect(Number(button.dataset.step));
});
onClick('share-replay', () => share(get('share-replay'))); onClick('share-result', () => share(get('share-result')));
for (const id of ['edit-circuit', 'new-circuit']) onClick(id, () => {
  if (mode !== 'random' || daily.loading) return;
  editor.load(id === 'edit-circuit' ? puzzle : undefined);
  get('custom-details').hidden = false;
  get('editor-wires').focus();
});
bindGameDialogs(get);
get('score-form').addEventListener('submit', completions.submit);
document.addEventListener('keydown', event => {
  if (tutorialBlocked() || ignoresGameShortcut(event) || event.target.closest('#custom-details')) return;
  if (event.ctrlKey || event.metaKey) {
    if (!event.shiftKey && event.key.toLowerCase() === 'z') { event.preventDefault(); get('undo').click(); }
    return;
  }
  if (event.key === 'Backspace') { event.preventDefault(); get('undo').click(); }
  if (event.key.toLowerCase() === 'r') { event.preventDefault(); reset(); }
  const inGame = event.target.closest('#signal-board, .signal-palette') || event.target === get('signal-scroll');
  if (!inGame || daily.loading || review.step !== null) return;
  const number = /^Digit[1-4]$/.test(event.code) ? Number(event.code.at(-1)) : /^[1-4]$/.test(event.key) ? Number(event.key) : 0;
  const available = choices.filter(button => !button.hidden);
  const gate = number ? available[number - 1]?.dataset.choice : event.key.toUpperCase();
  if (available.some(button => button.dataset.choice === gate)) { event.preventDefault(); place(gate); }
  if (event.key === 'Delete') { event.preventDefault(); place(null); }
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault(); navigateHole(event.key);
  }
});
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  review.clear(); update({ follow: true });
  daily.refresh(); completions.load();
});
window.addEventListener('pagehide', () => { review.clear(); daily.cancel(); completions.dispose(); sharing.close(); customJson.close(); });
const editor = createPuzzleEditor({ get, onPlay: custom => setPuzzle('random', custom) });
const customJson = createCustomPuzzleJson({ get, game: GAME, exportPuzzle: () => puzzleData(puzzle), importPuzzle(value) {
  const custom = validateCustomPuzzle(value); editor.load(custom); setPuzzle('random', custom);
} });
const tutorial = createTutorial({
  renderText: renderCircuitInstruction,
  get, isBlocked: () => daily.loading, intro: 'Fill the holes to match the target. This tutorial selects each hole for you.',
  controls: '#signal-board button, .signal-palette button, .round-controls button, #review-controls button, #sequence button, #replay-actions button, #campaign-controls button, #campaign-controls select, #custom-controls button, #custom-controls select, #circuit-editor-controls button, #custom-details select',
  steps: TUTORIAL_STEPS.map(({ hole, gate, text, target }) => ({
    text, target: target ?? '[data-choice="' + gate + '"]', prepare: hole ? () => selectHole(hole) : undefined,
    action: () => { if (gate) place(gate); },
  })),
  onReset: () => setPuzzle('tutorial', TUTORIAL_PUZZLE),
});
if (!startDailyFromLink(daily)) tutorial.enter();
