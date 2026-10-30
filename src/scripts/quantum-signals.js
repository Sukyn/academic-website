import { getHoles, applyPlacement, simulate, validatePuzzle, validateCustomPuzzle, puzzleData } from '../lib/quantum-signals/engine.js';
import { createPuzzleEditor } from '../lib/quantum-signals/puzzle-editor.js';
import { LEVELS, generatePuzzle, DAILY_START } from '../lib/quantum-signals/puzzles.js';
import { gateIcon, gateLabel, renderBoard, renderFlow, highlightFlow, highlightSignalFocus, pinFlowLabels } from '../lib/quantum-signals/rendering.js';
import { createGateMemo } from '../lib/quantum-signals/gate-memo.js';
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
import { TUTORIAL_PUZZLE, TUTORIAL_PUZZLES, TUTORIAL_STEPS, TUTORIAL_INTRO } from '../lib/quantum-signals/tutorial.js';
import { bindGameDialogs, directionalControl, handleGateShortcut, handleRoundShortcut, updateLevelControls, updateModeMenu, updateResultMenu } from '../lib/games/controls.js';
import { formatPuzzleDate, bindDailyControls } from '../lib/games/daily-ui.js';

const GAME = 'quantum-signals', get = id => document.getElementById(id);
const onClick = (id, callback) => get(id).addEventListener('click', callback);
let mode = 'tutorial', campaignIndex = 0, puzzle = TUTORIAL_PUZZLE, placements = {}, sequence = [], states = [placements];
let selected = getHoles(puzzle)[0].id;
let tutorialStep = null, tutorialChapter = -1, tutorialView = 'paths', autofocus = false, flowAnimation = null;
const evaluate = createPuzzleResult((puzzle, placements) => simulate(puzzle, placements).solved);
const isWon = () => evaluate(puzzle, placements);
const choices = [...document.querySelectorAll('[data-choice]')];
const paletteWires = new WeakMap();
const memo = createGateMemo({ get });
const mobileTutorial = window.matchMedia('(max-width: 600px), (max-height: 500px) and (max-width: 1000px)');
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
const tutorialSide = () => tutorialStep.anchor.kind === 'gate' ? 'above' : 'below';
function followProgress(hole, finished) {
  viewport.follow(holeButton(hole), finished);
}
function syncTutorialFocus() {
  const active = tutorial.active && !tutorial.finished && tutorialStep;
  // Returning from an interrupted movie restores the step's original view.
  if (active && !tutorial.executing) tutorialView = tutorialStep.view;
  const content = get('signal-scroll').closest('.game-content');
  if (active) {
    content.dataset.signalTutorialView = tutorialView;
    content.dataset.signalTutorialSide = tutorialSide();
    content.style.setProperty('--signal-circuit-height', get('signal-board').style.height);
  } else {
    delete content.dataset.signalTutorialView;
    delete content.dataset.signalTutorialSide;
    content.style.removeProperty('--signal-circuit-height');
  }
  highlightSignalFocus(get('signal-board'), get('signal-flow'), active ? tutorialStep.focus : {});
}
function tutorialAnchor() {
  if (!tutorialStep) return null;
  const inPaths = tutorialView === 'paths';
  const anchor = inPaths && tutorial.executing && !mobileTutorial.matches ? tutorialStep.animationAnchor ?? tutorialStep.anchor : tutorialStep.anchor;
  const flow = get('signal-flow');
  let elements;
  if (anchor.kind === 'gate') elements = [anchor.hole ? holeButton(anchor.hole) :
    get('signal-board').querySelector(`.signal-fixed[data-column="${anchor.column}"]`)];
  else if (anchor.kind === 'goal') elements = [get('signal-target').querySelector('.signal-flow-target')];
  else if (anchor.kind === 'memo') elements = [get('signal-memo').querySelector('summary')];
  else if (anchor.kind === 'bits') elements = anchor.wires.map(wire => flow.querySelector(`.signal-flow-label[data-basis="${anchor.basis}"] tspan[data-wire="${wire}"]`));
  else if (anchor.kind === 'node' && tutorialStep.focus.phase) elements = (tutorialStep.focus.bases ?? [anchor.basis])
    .map(basis => flow.querySelector(`.signal-flow-node[data-basis="${basis}"][data-boundary="${anchor.boundary}"]`));
  else elements = [flow.querySelector(`.${anchor.kind === 'wall' ? 'signal-flow-cancellation' : 'signal-flow-node'}[data-basis="${anchor.basis}"][data-boundary="${anchor.boundary}"]`)];
  elements = elements.filter(Boolean);
  const region = get(mobileTutorial.matches ? 'signal-stage' : inPaths ? 'flow-panel' : 'signal-scroll'), panel = region.getBoundingClientRect();
  const memo = anchor.kind === 'memo' ? get('signal-memo') : null;
  const besideMemo = mobileTutorial.matches && window.innerWidth > 600;
  const speaker = anchor.kind === 'node' ? elements.find(node => Number(node.dataset.basis) === anchor.basis) : elements[0];
  const speakerBounds = speaker?.getBoundingClientRect();
  return { elements, ...(anchor.kind === 'node' ? { rect: speakerBounds } : {}),
    avoid: memo ? [memo, memo.open && !besideMemo ? get('signal-target').querySelector('.signal-flow-target') : region] : [region],
    preferredSide: mobileTutorial.matches && !memo?.open ? tutorialSide() :
      memo?.open || speakerBounds?.top < panel.top + panel.height / 2 ? 'above' : 'below' };
}
function revealTutorialFocus() {
  syncTutorialFocus();
  if (!tutorialStep || tutorial.finished) return;
  const column = tutorialStep.focus.column;
  get('signal-scroll').scrollTop = 0;
  viewport.follow(holeButton(tutorialStep.hole) ?? get('signal-board').querySelector('.signal-gate-focus') ?? get('signal-board').querySelector('[data-column="' + column + '"]'));
  if (mobileTutorial.matches || tutorialView === 'paths') {
    const panel = get('flow-panel'), bounds = panel.getBoundingClientRect();
    const focused = [...get('signal-flow').querySelectorAll('.signal-flow-focus.signal-flow-node, .signal-flow-focus.signal-flow-cancellation')];
    if (focused.length) {
      const rects = focused.map(node => node.getBoundingClientRect());
      const top = Math.min(...rects.map(rect => rect.top)), bottom = Math.max(...rects.map(rect => rect.bottom));
      panel.scrollTop += (top + bottom - bounds.top - bounds.bottom) / 2;
    }
  }
  const region = get(mobileTutorial.matches ? 'signal-stage' : tutorialView === 'paths' ? 'flow-panel' : 'signal-scroll');
  region.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
}
mobileTutorial.addEventListener('change', () => {
  if (mode !== 'tutorial') return;
  update(); revealTutorialFocus(); tutorial.reposition();
});
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
    const compact = mode === 'tutorial' && mobileTutorial.matches;
    renderBoard(get('signal-board'), puzzle, visible, { selected: activeHole, locked, compact });
    renderFlow(get('signal-flow'), get('signal-target'), puzzle, visible, activeHole, { compact });
    if (focused) focusSelected();
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
  get('autofocus').setAttribute('aria-pressed', String(autofocus)); get('autofocus').disabled = locked;
  if (focusedControl?.hidden) focusSelected();
  memo.update(hole);
  updateModeMenu(get, mode, false, completions.submitting);
  get('custom-controls').hidden = mode !== 'random';
  get('circuit-editor-controls').hidden = mode !== 'random';
  customJson.update({ visible: mode === 'random', disabled: daily.loading });
  get('leaderboard-section').hidden = mode === 'random' || mode === 'tutorial';
  get('daily-heading').hidden = mode !== 'daily';
  get('daily-date').disabled = !daily.info;
  updateLevelControls(get, { mode, level: campaignIndex + 1, count: LEVELS.length, loading: daily.loading,
    canAdvance: !completions.submitting && won });
  get('undo').disabled = daily.loading || !sequence.length; get('restart').disabled = daily.loading;
  get('show-results').hidden = mode === 'tutorial' || !won;
  for (const id of ['replay', 'replay-result']) get(id).disabled = daily.loading || !sequence.length || review.playing;
  get('replay').hidden = mode === 'tutorial' || !sequence.length;
  for (const id of ['share-replay', 'share-result']) { get(id).hidden = mode === 'tutorial' || !won || !sequence.length; get(id).disabled = daily.loading; }
  updateResultMenu(get, mode === 'daily');
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
    const job = flowAnimation = animateFlow(get('signal-flow'), previousFlow, animateFrom,
      { duration: tutorial.active ? tutorialStep?.duration : undefined });
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
    const job = flowAnimation;
    if (isWon()) {
      if (job) job.finished.then(completed => { if (completed && placements === next && review.step === null) openWin(); });
      else openWin();
    }
    return job ? job.finished.then(completed => completed && placements === next) : true;
  } catch (error) { get('status').textContent = error.message; return false; }
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
  get, isBlocked: () => daily.loading, intro: TUTORIAL_INTRO,
  onRender: syncTutorialFocus, revealTarget: revealTutorialFocus, getAnchor: tutorialAnchor,
  controls: '#signal-board button, .signal-palette button, .round-controls button, #review-controls button, #sequence button, #replay-actions button, #campaign-controls button, #campaign-controls select, #custom-controls button, #custom-controls select, #circuit-editor-controls button, #custom-details select',
  steps: TUTORIAL_STEPS.map(step => ({
    text: step.text, target: step.gate ? '[data-choice="' + step.gate + '"]' : '#tutorial-next',
    prepare() {
      tutorialStep = step; tutorialView = step.view;
      if (tutorialChapter !== step.chapter) {
        tutorialChapter = step.chapter;
        if (puzzle !== TUTORIAL_PUZZLES[step.chapter]) setPuzzle('tutorial', TUTORIAL_PUZZLES[step.chapter]);
      }
      if (step.hole) selectHole(step.hole);
      syncTutorialFocus();
    },
    action() {
      if (!step.gate) return true;
      tutorialView = 'paths'; revealTutorialFocus(); tutorial.reposition();
      return place(step.gate);
    },
  })),
  onReset: () => { tutorialChapter = -1; setPuzzle('tutorial', TUTORIAL_PUZZLE); },
  onLeave() { tutorialStep = null; syncTutorialFocus(); },
});
for (const type of ['toggle', 'click', 'keydown']) get('signal-memo').addEventListener(type, tutorial.reveal);
get('signal-memo').addEventListener('toggle', () => {
  if (tutorial.active && mobileTutorial.matches) revealTutorialFocus();
});
if (!startDailyFromLink(daily)) tutorial.enter();
