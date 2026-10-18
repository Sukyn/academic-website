import { getHoles, applyPlacement, simulate, validatePuzzle, validateCustomPuzzle, puzzleData } from '../lib/quantum-signals/engine.js';
import { createPuzzleEditor } from '../lib/quantum-signals/puzzle-editor.js';
import { LEVELS, generatePuzzle, DAILY_START } from '../lib/quantum-signals/puzzles.js';
import { gateIcon, gateLabel, renderBoard, renderFlow, highlightFlow, highlightFlowBits, pinFlowLabels } from '../lib/quantum-signals/rendering.js';
import { animateFlow, flowElements } from '../lib/quantum-signals/animation.js';
import { createScoreboard } from '../lib/games/scoreboard.js';
import { createDailySession } from '../lib/games/daily-session.js';
import { startDailyFromLink } from '../lib/games/daily-links.js';
import { createReplayShare } from '../lib/games/replay-share.js';
import { createStepReplay } from '../lib/games/step-replay.js';
import { createCircuitViewport } from '../lib/games/circuit-viewport.js';
import { createPuzzleResult } from '../lib/games/puzzle-result.js';
import { createMoveTimeline } from '../lib/games/move-timeline.js';
import { createCustomPuzzleJson } from '../lib/games/custom-puzzle-json.js';
import { createTutorial } from '../lib/games/tutorial.js';
import { renderCircuitInstruction } from '../lib/games/tutorial-gates.js';
import { TUTORIAL_PUZZLE, TUTORIAL_STEPS } from '../lib/quantum-signals/tutorial.js';
import { bindGameDialogs, directionalControl, handleGateShortcut, handleRoundShortcut, updateModeMenu } from '../lib/games/controls.js';
import { formatPuzzleDate, bindDailyControls } from '../lib/games/daily-ui.js';

const GAME = 'quantum-signals', get = id => document.getElementById(id);
const onClick = (id, callback) => get(id).addEventListener('click', callback);
let mode = 'tutorial', campaignIndex = 0, puzzle = TUTORIAL_PUZZLE, placements = {}, sequence = [], states = [placements];
let selected = getHoles(puzzle)[0].id;
let tutorialBits = [], autofocus = false, flowAnimation = null;
const evaluate = createPuzzleResult((puzzle, placements) => simulate(puzzle, placements).solved);
const isWon = () => evaluate(puzzle, placements);
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
const viewport = createCircuitViewport(get('signal-scroll'), get('flow-scroll'), left => pinFlowLabels(get('signal-flow'), left));
function followProgress(hole, finished) {
  viewport.follow(holeButton(hole), finished);
}
function selectHole(id) {
  if (tutorialBlocked() || daily.loading || review.step !== null || selected === id) return;
  selected = id;
  for (const button of get('signal-board').querySelectorAll('[data-hole]')) button.setAttribute('aria-pressed', String(button.dataset.hole === id));
  update({ board: false }); followProgress(selected, false);
}
function navigateHole(key) {
  const next = directionalControl(holeButton(selected), get('signal-board').querySelectorAll('[data-hole]'), key);
  if (next) { selectHole(next.dataset.hole); focusSelected(); }
}
const renderTimeline = createMoveTimeline(get('sequence'), (move, index) => {
  const label = 'Placement ' + (index + 1) + ': ' + move.hole;
  return { text: move.gate === null ? '×' : move.gate === 'I' ? '—' : move.gate,
    label: label + ' · ' + (move.gate ?? 'erase') };
});
// Only play/navigation actions follow progress; network updates preserve exploration.
function update({ board = true, follow = false, animateFrom = null } = {}) {
  const visible = review.step === null ? placements : states[review.step];
  const holes = getHoles(puzzle), locked = daily.loading || review.step !== null, won = isWon();
  const activeHole = review.step === null ? selected : sequence[review.step - 1]?.hole;
  let previousFlow = null;
  if (board) {
    flowAnimation?.cancel(); flowAnimation = null;
    previousFlow = animateFrom === null ? null : flowElements(get('signal-flow'));
    const focused = document.activeElement?.closest('[data-hole]');
    renderBoard(get('signal-board'), puzzle, visible, { selected: activeHole, locked });
    renderFlow(get('signal-flow'), get('signal-target'), puzzle, visible, activeHole);
    if (focused) focusSelected();
  } else {
    for (const button of get('signal-board').querySelectorAll('[data-hole]')) button.disabled = locked;
    highlightFlow(get('signal-flow'), puzzle, activeHole);
  }
  highlightFlowBits(get('signal-flow'), tutorialBits);
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
  get('autofocus').setAttribute('aria-pressed', String(autofocus)); get('autofocus').disabled = locked;
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
  if (previousFlow) {
    const job = flowAnimation = animateFlow(get('signal-flow'), previousFlow, animateFrom);
    job.finished.then(() => { if (flowAnimation === job) flowAnimation = null; });
  }
}
function reset() {
  if (tutorialBlocked() || daily.loading) return;
  review.clear(); closeResult(); placements = {}; sequence = []; states = [placements]; selected = getHoles(puzzle)[0].id;
  get('flow-panel').scrollTop = 0;
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
    if (autofocus && gate !== null) selected = getHoles(puzzle).find(hole => !Object.hasOwn(next, hole.id))?.id ?? selected;
    const column = puzzle.columns.findIndex(entries => entries.some(entry => entry.id === move.hole));
    get('status').textContent = ''; update({ follow: autofocus, animateFrom: column });
    if (isWon()) {
      const job = flowAnimation;
      if (job) job.finished.then(completed => { if (completed && placements === next && review.step === null) openWin(); });
      else openWin();
    }
  } catch (error) { get('status').textContent = error.message; }
}
function share(source) {
  if (tutorial.active || daily.loading || !isWon() || !sequence.length) return;
  sharing.open(source, { label: mode === 'daily' ? 'Daily puzzle : ' + formatPuzzleDate(puzzle.date) : mode === 'campaign' ? 'Level : ' + (campaignIndex + 1) : 'Custom circuit',
    puzzle: validatePuzzle(puzzle), sequence: sequence.map(move => ({ ...move })) },
  'quantum-signals-' + (puzzle.date ?? (mode === 'campaign' ? campaignIndex + 1 : 'custom')) + '.gif');
}

for (const button of choices) button.addEventListener('click', () => place(button.dataset.choice));
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
onClick('autofocus', () => {
  if (tutorialBlocked() || daily.loading || review.step !== null) return;
  autofocus = !autofocus; update({ board: false });
});
onClick('undo', () => {
  if (tutorialBlocked() || daily.loading || !sequence.length) return;
  review.clear(); closeResult(); const move = sequence.pop(); states.pop(); placements = states.at(-1); selected = move.hole;
  update({ follow: autofocus, animateFrom: puzzle.columns.findIndex(entries => entries.some(entry => entry.id === move.hole)) });
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
  if (handleRoundShortcut(event, { blocked: tutorialBlocked() || Boolean(event.target.closest('#custom-details')),
    undo: () => get('undo').click(), reset })) return;
  const inGame = event.target.closest('#signal-board, .signal-palette') || event.target === get('signal-scroll');
  if (!inGame || daily.loading || review.step !== null) return;
  handleGateShortcut(event, { choices: choices.filter(button => !button.hidden).map(button => button.dataset.choice),
    place, erase: () => place(null), navigate: navigateHole });
});
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  review.clear(); update({ follow: true });
  daily.refresh(); completions.load();
});
window.addEventListener('pagehide', () => { flowAnimation?.cancel(); review.clear(); daily.cancel(); completions.dispose(); sharing.close(); customJson.close(); });
const editor = createPuzzleEditor({ get, onPlay: custom => setPuzzle('random', custom) });
const customJson = createCustomPuzzleJson({ get, game: GAME, exportPuzzle: () => puzzleData(puzzle), importPuzzle(value) {
  const custom = validateCustomPuzzle(value); editor.load(custom); setPuzzle('random', custom);
} });
const tutorial = createTutorial({
  renderText: renderCircuitInstruction,
  get, isBlocked: () => daily.loading, intro: 'Fixed gates prepare the input. Fill the holes on the right to match the target.',
  controls: '#signal-board button, .signal-palette button, .round-controls button, #review-controls button, #sequence button, #replay-actions button, #campaign-controls button, #campaign-controls select, #custom-controls button, #custom-controls select, #circuit-editor-controls button, #custom-details select',
  steps: TUTORIAL_STEPS.map(({ hole, gate, text, target, bits }) => ({
    text, target: target ?? '[data-choice="' + gate + '"]', prepare() {
      tutorialBits = bits ?? [];
      if (hole) selectHole(hole);
      highlightFlowBits(get('signal-flow'), tutorialBits);
    },
    action: () => { if (gate) place(gate); },
  })),
  onReset: () => setPuzzle('tutorial', TUTORIAL_PUZZLE),
  onLeave() { tutorialBits = []; highlightFlowBits(get('signal-flow'), tutorialBits); },
});
if (!startDailyFromLink(daily)) tutorial.enter();
