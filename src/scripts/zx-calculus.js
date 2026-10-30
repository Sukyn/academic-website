import { MAX_MOVES, RULES, LEVELS, TUTORIAL, validateDiagram, targetDiagram, availableMoves, applyMove, isSolved, generatePuzzle, ruleFamily } from '../lib/zx-calculus/engine.js';
import { DAILY_START } from '../lib/zx-calculus/leaderboard.js';
import { diagramLayout, renderDiagram, updateDiagramPositions, constrainNodePosition, nodeGlyph, ruleGlyph, hopfResultGlyph, phaseSector } from '../lib/zx-calculus/rendering.js';
import { animateDiagramMove, createRewriteScene, rewriteDuration, REPLAY_MOVE_DURATION } from '../lib/zx-calculus/animation.js';
import { bindNodeDragging } from '../lib/zx-calculus/drag.js';
import { createTutorial } from '../lib/games/tutorial.js';
import { createScoreboard } from '../lib/games/scoreboard.js';
import { createDailySession } from '../lib/games/daily-session.js';
import { bindDailyControls, formatPuzzleDate, updateDailyHeading } from '../lib/games/daily-ui.js';
import { startDailyFromLink } from '../lib/games/daily-links.js';
import { createStepReplay } from '../lib/games/step-replay.js';
import { createReplayShare } from '../lib/games/replay-share.js';
import { createMoveTimeline } from '../lib/games/move-timeline.js';
import { createCustomPuzzleJson } from '../lib/games/custom-puzzle-json.js';
import { createRulePalette } from '../lib/games/rule-palette.js';
import { createPuzzleResult } from '../lib/games/puzzle-result.js';
import { bindGameDialogs, handleRoundShortcut, updateModeMenu, updateResultMenu, updateLevelControls } from '../lib/games/controls.js';

const GAME = 'zx-calculus', get = id => document.getElementById(id);
const labels = Object.fromEntries(RULES.map(({ id, label }) => [id, label]));
const explanations = {
  fusion: 'Connected spiders of the same colour fuse, adding their phases modulo one full turn.',
  identity: 'A fully filled spider with two wires can be removed.',
  hh: 'The yellow squares are Hadamard gates. Two consecutive Hadamards compose to the identity.',
  color: 'Change the spider\'s colour. If every leg has a Hadamard, remove them; otherwise add one on each leg.',
  hopf: 'The Hopf rule removes a pair of parallel wires between spiders of opposite colours.',
};
const coreRules = Object.keys(labels);
const puzzleSolved = createPuzzleResult(isSolved);
let mode = 'tutorial', levelIndex = 0, puzzle = TUTORIAL.diagram, diagram = puzzle, editing = false;
let puzzleDate;
let sequence = [], states = [diagram], selected = new Set(), selectedEdge = null;
const viewOf = ({ positions, width, height }) => ({ positions, width, height });
let layout = diagramLayout(diagram), puzzleLayout = layout, views = [viewOf(layout)];
let moves = [], previousDiagram, animation = null;
let rulePalette, ruleOptions = [];
const click = (id, action) => get(id).addEventListener('click', action);
const blocked = () => daily.loading || Boolean(animation) || dragging.active || review.step !== null || get('zx-rule-options').open || (tutorial.active && !tutorial.executing);
const recordable = () => mode === 'campaign' || (mode === 'daily' && daily.info?.date === puzzleDate && daily.info.acceptingScores &&
  daily.serverTime() >= daily.info.opensAt && daily.serverTime() < daily.info.closesAt);
const selector = () => mode === 'campaign' ? { game: GAME, level: levelIndex + 1 } : mode === 'daily' ? { game: GAME, date: puzzleDate } : null;
const allowedRules = () => mode === 'campaign' ? LEVELS[levelIndex].rules : coreRules;
const sharing = createReplayShare({ get, createWorker: () => new Worker(new URL('./zx-calculus-gif-worker.js', import.meta.url), { type: 'module' }) });
const scores = createScoreboard({ get, selector, sequence: () => sequence, update: () => update(false),
  canSubmit: () => !blocked() && !editing && recordable() && puzzleSolved(diagram),
  onDailyClosed: () => { daily.info.acceptingScores = false; daily.refresh(); },
});
const daily = createDailySession({ game: GAME, startDate: DAILY_START, get, ranked: false,
  selectedDate: () => mode === 'daily' ? puzzleDate : undefined,
  isBusy: () => tutorial.active && tutorial.executing,
  validatePuzzle: validateDiagram, update: () => update(false),
  onPuzzle(info, select) {
    if (select && (mode !== 'daily' || puzzleDate !== info.date)) {
      tutorial.leave(); mode = 'daily'; editing = false;
      puzzle = info.puzzle; puzzleLayout = diagramLayout(puzzle); puzzleDate = info.date; reset();
    } else if (mode === 'daily' && puzzleDate === info.date) scores.load();
  },
});
const review = createStepReplay({ length: () => sequence.length, interval: 160,
  canReview: () => !daily.loading && !animation && !dragging.active && !tutorial.active && !editing,
  onEnter: () => { get('win-dialog').close(); selected.clear(); selectedEdge = null; }, onChange: () => update(),
  transition(step) {
    const scene = createRewriteScene(states[step], sequence[step], states[step + 1], {
      layout: diagramLayout(states[step], views[step]), nextLayout: diagramLayout(states[step + 1], views[step + 1]),
    });
    const job = startAnimation(scene, rewriteDuration(scene, REPLAY_MOVE_DURATION));
    return { cancel: cancelAnimation, finished: job.finished.then(completed => {
      if (animation === job) cancelAnimation();
      return completed;
    }) };
  },
});
const renderTimeline = createMoveTimeline(get('sequence'), (move, index) => ({ text: String(index + 1), label: `${index + 1}: ${labels[ruleFamily(move.rule)]}` }));
function moveNode(id, point) {
  point = constrainNodePosition(layout, id, point);
  const current = layout.positions.get(id);
  if (current.x === point.x && current.y === point.y) return;
  const positions = new Map(layout.positions); positions.set(id, point);
  layout = updateDiagramPositions(get('zx-board'), diagram, { ...viewOf(layout), positions });
  views[sequence.length] = viewOf(layout);
}
const dragging = bindNodeDragging(get('zx-board'), {
  canDrag: () => !daily.loading && !animation && review.step === null && !tutorial.active,
  getPosition: id => layout.positions.get(id), onMove: moveNode,
  onEnd: () => update(false),
});

function buildRules() {
  const buttons = [];
  for (const rule of coreRules) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'zx-rule'; button.dataset.rule = rule;
    button.setAttribute('aria-label', labels[rule]); button.append(ruleGlyph(rule));
    get('zx-rules').append(button); buttons.push(button);
    const item = document.createElement('li'), text = document.createElement('span');
    text.textContent = explanations[rule]; item.append(ruleGlyph(rule), text); get('zx-rule-guide').append(item);
  }
  rulePalette = createRulePalette(buttons, { apply: playMove, ruleOf: move => ruleFamily(move.rule), choose: chooseRule });
  for (const [index, phase] of [0, 1, 2, 3, 0].entries()) {
    if (index) {
      const arrow = document.createElement('span'); arrow.textContent = '→';
      get('zx-phase-cycle').append(arrow);
    }
    get('zx-phase-cycle').append(nodeGlyph('z', phase));
  }
  for (const [left, right, result] of [[1, 3, 0], [3, 3, 2]]) {
    const example = document.createElement('span');
    example.setAttribute('role', 'img');
    example.setAttribute('aria-label', `${phaseSector(left).label} plus ${phaseSector(right).label} gives ${phaseSector(result).label}`);
    example.append(nodeGlyph('z', left));
    for (const [symbol, phase] of [['+', right], ['→', result]]) {
      const operator = document.createElement('span'); operator.textContent = symbol;
      operator.setAttribute('aria-hidden', 'true'); example.append(operator, nodeGlyph('z', Number(phase)));
    }
    get('zx-phase-examples').append(example);
  }
}
function chooseRule(options, trigger) {
  if (blocked()) return;
  ruleOptions = options;
  const family = trigger.dataset.rule, choices = get('zx-option-choices');
  get('zx-option-title').textContent = family === 'fusion' ? 'Split spider' : family === 'identity' ? 'Insert spider' : 'Cancel or add two links';
  choices.replaceChildren(...options.map((move, index) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'button ghost'; button.dataset.option = String(index);
    if (move.rule === 'insert') {
      button.setAttribute('aria-label', `Insert ${move.kind === 'z' ? 'green' : 'red'} spider`);
      button.append(nodeGlyph(move.kind));
    } else if (move.rule === 'split') {
      const node = diagram.nodes.find(node => node.id === move.nodes[0]);
      button.setAttribute('aria-label', `Split off a ${phaseSector(move.phase).label} spider`);
      const wire = document.createElement('span'); wire.className = 'zx-option-wire'; wire.setAttribute('aria-hidden', 'true');
      button.append(nodeGlyph(node.kind, (node.phase ?? 0) - move.phase), wire, nodeGlyph(node.kind, move.phase));
    } else {
      button.setAttribute('aria-label', move.rule === 'hopf' ? 'Remove two links' : 'Add two links');
      button.append(hopfResultGlyph(move.rule === 'add-hopf'));
    }
    return button;
  }));
  get('zx-rule-options').showModal();
}
function matches(move) {
  if (move.edge) {
    const edge = diagram.edges[selectedEdge];
    return edge && move.edge.every((id, index) => id === edge[index]);
  }
  return selectedEdge === null && move.nodes.length === selected.size && move.nodes.every(id => selected.has(id));
}
function updateRules(locked) {
  if (diagram !== previousDiagram) {
    moves = availableMoves(diagram, { expand: true }); previousDiagram = diagram;
  }
  rulePalette.update(moves.filter(matches), { allowed: allowedRules(), disabled: locked });
}
function update(board = true) {
  if (daily.loading && animation) { cancelAnimation(); board = true; }
  const reviewing = review.step !== null, locked = daily.loading || Boolean(animation) || reviewing;
  const solved = puzzleSolved(diagram), won = solved && !editing, scorable = recordable();
  if (board && !animation) renderDiagram(get('zx-board'), reviewing ? states[review.step] : diagram, {
    layout: reviewing ? diagramLayout(states[review.step], views[review.step]) : layout, selected, selectedEdge, locked,
  });
  else for (const button of get('zx-board').querySelectorAll('button')) button.disabled = locked;
  updateModeMenu(get, mode, false, scores.submitting);
  updateLevelControls(get, { mode, level: levelIndex + 1, count: LEVELS.length, loading: daily.loading,
    canAdvance: !scores.submitting && won });
  get('custom-controls').hidden = mode !== 'random';
  get('play-diagram').hidden = !editing;
  get('play-diagram').disabled = locked || solved;
  get('zx-generator').hidden = editing;
  for (const id of ['new-diagram', 'new-puzzle', 'difficulty']) get(id).disabled = locked;
  get('undo').disabled = locked || !sequence.length; get('restart').disabled = daily.loading;
  get('tidy').disabled = locked;
  get('show-results').hidden = mode === 'tutorial' || !won;
  get('leaderboard-section').hidden = mode !== 'campaign' && mode !== 'daily';
  updateDailyHeading(get, { mode, date: puzzleDate, available: daily.info, acceptingScores: scorable });
  get('move-count').hidden = mode === 'tutorial' || editing;
  get('move-count').textContent = `${sequence.length} ${sequence.length === 1 ? 'move' : 'moves'}`;
  get('win-summary').textContent = `Diagram simplified in ${sequence.length} ${sequence.length === 1 ? 'move' : 'moves'}.`;
  for (const id of ['replay', 'replay-result']) get(id).disabled = locked || editing || !sequence.length || review.playing;
  get('replay').hidden = mode === 'tutorial' || editing || !sequence.length;
  for (const id of ['share-replay', 'share-result']) {
    get(id).hidden = mode === 'tutorial' || !won || !sequence.length; get(id).disabled = daily.loading || Boolean(animation);
  }
  get('review-controls').hidden = !reviewing;
  get('review-note').textContent = reviewing ? `Rewrite ${review.step} / ${sequence.length}` : '';
  renderTimeline(sequence, { step: review.step, disabled: daily.loading || Boolean(animation) || review.playing || editing });
  const registered = Boolean(scores.player), showForm = won && scorable && !registered && !scores.automatic;
  get('score-form').hidden = !showForm; get('win-results').hidden = !registered;
  get('win-practice').hidden = mode !== 'daily' || scorable || registered;
  get('result-actions').hidden = showForm;
  for (const id of ['player-name', 'submit-score']) get(id).disabled = daily.loading || scores.submitting || !scorable;
  updateResultMenu(get, mode === 'daily');
  customJson.update({ visible: mode === 'random', disabled: locked, canShare: !editing || !solved });
  updateRules(locked); tutorial.render();
}
function cancelAnimation() {
  const current = animation; animation = null;
  current?.cancel();
  get('zx-board').removeAttribute('data-zx-animating');
  get('zx-board').removeAttribute('aria-busy');
}
function startAnimation(scene, duration) {
  dragging.cancel();
  const job = animation = animateDiagramMove(get('zx-board'), scene, { duration });
  get('zx-board').dataset.zxAnimating = 'true';
  get('zx-board').setAttribute('aria-busy', 'true');
  return job;
}
function closeResult() { sharing.close(); get('win-dialog').close(); }
function reset() {
  if (tutorial.active && !tutorial.executing || daily.loading) return;
  dragging.cancel(); cancelAnimation(); review.clear(); closeResult(); get('zx-rule-options').close(); scores.reset();
  diagram = puzzle; sequence = []; states = [diagram]; selected = new Set(); selectedEdge = editing ? 0 : null;
  layout = puzzleLayout; views = [viewOf(layout)];
  get('status').textContent = ''; update(); scores.load();
}
function setPuzzle(nextMode, next, edit = false, initialLayout) {
  if (nextMode !== 'tutorial') tutorial.leave();
  daily.cancel(); mode = nextMode; puzzle = validateDiagram(next); puzzleLayout = initialLayout ?? diagramLayout(puzzle);
  puzzleDate = undefined; editing = edit; reset();
}
function selectLevel(value) {
  if (tutorial.active && !tutorial.executing) return;
  const index = Number(value) - 1;
  if (Number.isInteger(index) && LEVELS[index]) { levelIndex = index; setPuzzle('campaign', LEVELS[index].diagram); }
}
function randomPuzzle() {
  setPuzzle('random', generatePuzzle(`${Date.now()}:${Math.random()}`, Number(get('difficulty').value)).diagram);
}
function openWin() {
  if (mode === 'tutorial' || editing || daily.loading || animation || !puzzleSolved(diagram) || get('win-dialog').open) return;
  review.clear(); update(); scores.autoSubmit(); get('win-dialog').showModal();
  get(scores.automatic ? 'close-win' : get('score-form').hidden ? 'try-again' : 'player-name').focus();
}
async function playMove(move) {
  if (blocked()) return false;
  let job;
  try {
    if (!move || sequence.length >= MAX_MOVES) throw new RangeError('Undo or reset before adding more moves.');
    const next = applyMove(diagram, move);
    if (!editing && !allowedRules().includes(ruleFamily(move.rule))) return false;
    closeResult();
    const scene = createRewriteScene(diagram, move, next, { layout });
    job = startAnimation(scene); update(false);
    const completed = await job.finished;
    if (animation !== job) return false;
    cancelAnimation();
    if (!completed) { update(); return false; }
    if (puzzleSolved(diagram)) scores.reset();
    diagram = next; layout = scene.afterLayout;
    sequence.push(move); states.push(next); views.push(viewOf(layout)); selected = new Set(); selectedEdge = null;
    get('status').textContent = ''; update();
    openWin();
    return true;
  } catch (error) {
    if (job && animation !== job) return false;
    cancelAnimation(); update(); get('status').textContent = error.message; return false;
  }
}
function share(source) {
  if (mode === 'tutorial' || editing || daily.loading || animation || !puzzleSolved(diagram) || !sequence.length) return;
  if (review.step !== null) { review.clear(); update(); }
  sharing.open(source, {
    puzzle, sequence, views,
    label: mode === 'daily' ? 'Daily puzzle · ' + formatPuzzleDate(puzzleDate) : mode === 'campaign' ? 'Level · ' + (levelIndex + 1) : 'Custom puzzle',
  }, `zx-calculus-${mode === 'daily' ? puzzleDate : mode === 'campaign' ? levelIndex + 1 : 'custom'}.gif`);
}

get('zx-board').addEventListener('click', event => {
  if (blocked()) return;
  const control = event.target.closest('button, [data-edge-hit]'); if (!control || control.disabled) return;
  if (control.dataset.edge !== undefined || control.dataset.edgeHit !== undefined) {
    const edge = Number(control.dataset.edge ?? control.dataset.edgeHit);
    selectedEdge = selectedEdge === edge ? null : edge; selected.clear();
  } else if (control.dataset.node !== undefined) {
    const id = Number(control.dataset.node); selectedEdge = null;
    if (selected.has(id)) selected.delete(id); else selected.add(id);
  }
  update();
});
get('zx-board').addEventListener('keydown', event => {
  const id = Number(event.target.closest('[data-node]')?.dataset.node);
  const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (!direction || !Number.isInteger(id) || blocked() || tutorial.active) return;
  event.preventDefault();
  const point = layout.positions.get(id), step = event.shiftKey ? 30 : 10;
  moveNode(id, { x: Math.max(36, Math.min(2400, point.x + direction[0] * step)), y: Math.max(36, Math.min(1600, point.y + direction[1] * step)) });
});
get('zx-option-choices').addEventListener('click', event => {
  const button = event.target.closest('[data-option]');
  if (!button || button.disabled) return;
  const move = ruleOptions[Number(button.dataset.option)];
  get('zx-rule-options').close(); void playMove(move);
});
click('zx-option-close', () => get('zx-rule-options').close());
get('zx-rule-options').addEventListener('close', () => { ruleOptions = []; });
click('undo', () => {
  if (blocked() || !sequence.length) return;
  closeResult(); scores.reset(); sequence.pop(); states.pop(); views.pop(); diagram = states.at(-1);
  layout = diagramLayout(diagram, views.at(-1));
  selected = new Set(); selectedEdge = null; update(); scores.load();
});
click('restart', reset); click('try-again', reset); click('show-results', openWin);
click('tidy', () => {
  if (blocked()) return;
  layout = diagramLayout(diagram); views[sequence.length] = viewOf(layout); update();
});
click('mode-tutorial', () => tutorial.enter());
click('mode-campaign', () => setPuzzle('campaign', LEVELS[levelIndex].diagram));
click('mode-random', () => { if (mode !== 'random') randomPuzzle(); });
bindDailyControls(daily, get);
get('level').addEventListener('change', event => selectLevel(event.target.value));
click('previous-level', () => selectLevel(levelIndex)); click('next-level', () => selectLevel(levelIndex + 2)); click('result-next', () => selectLevel(levelIndex + 2));
click('new-puzzle', randomPuzzle); get('difficulty').addEventListener('change', randomPuzzle);
click('new-diagram', () => { if (mode === 'random' && !blocked()) setPuzzle('random', targetDiagram(), true); });
click('play-diagram', () => { if (editing && !blocked() && !puzzleSolved(diagram)) setPuzzle('random', diagram, false, layout); });
click('replay', review.play); click('replay-result', review.play); click('resume-round', () => { review.clear(); update(); });
get('sequence').addEventListener('click', event => {
  const button = event.target.closest('[data-step]'); if (button && !button.disabled) review.inspect(Number(button.dataset.step));
});
click('share-replay', () => share(get('share-replay'))); click('share-result', () => share(get('share-result')));
bindGameDialogs(get); get('score-form').addEventListener('submit', scores.submit);
document.addEventListener('keydown', event => handleRoundShortcut(event, { blocked: get('zx-rule-options').open || tutorial.active && !tutorial.executing,
  undo: () => get('undo').click(), reset }));
window.addEventListener('pageshow', event => { if (event.persisted) { review.clear(); update(); daily.refresh(); scores.load(); } });
window.addEventListener('pagehide', () => { dragging.cancel(); cancelAnimation(); review.clear(); daily.cancel(); scores.dispose(); sharing.close(); customJson.close(); get('zx-rule-options').close(); });
const customJson = createCustomPuzzleJson({ get, game: GAME,
  exportPuzzle: () => editing ? diagram : puzzle, importPuzzle: value => setPuzzle('random', value),
});
const tutorial = createTutorial({ get, intro: 'The green and red circles are called spiders. Use ZX rules to reduce the diagram to two straight wires.', isBlocked: () => daily.loading,
  getAnchor: () => ({ elements: [...selected].map(id => get('zx-board').querySelector(`[data-zx-node="${id}"]`)).filter(Boolean),
    avoid: [get('zx-board'), get('zx-target')] }),
  onRender: focus => rulePalette.prioritize(focus?.dataset.rule),
  controls: '#zx-board button, #zx-rules button, .round-controls button, #review-controls button, #sequence button, #replay-actions button, #campaign-controls button, #campaign-controls select, #custom-controls button, #custom-controls select',
  steps: TUTORIAL.solution.map((move, index) => ({
    text: index === 0 ? 'A fully filled spider has zero phase. A cut-out marks a quarter, half or three-quarter turn. Fuse the green pair: their phases add to a full turn, filling the circle again.' : move.rule === 'color' ? 'Change the spider\'s colour to absorb the Hadamards on all its legs.' : explanations[move.rule],
    target: `#zx-rules [data-rule="${move.rule}"]`,
    prepare: () => { selected = new Set(move.nodes); selectedEdge = null; update(); }, action: () => playMove(move),
  })),
  onReset: () => setPuzzle('tutorial', TUTORIAL.diagram),
});
buildRules(); renderDiagram(get('zx-target'), targetDiagram(), { interactive: false });
if (!startDailyFromLink(daily)) tutorial.enter();
