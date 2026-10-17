// Real clicks and touch input; daily/score requests stay in a local fixture.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { applyMove, optimalShots, pathGraph, sequenceCost, solutionForGraph } from '../../src/lib/graph-states/engine.js';
import { COMPLEMENT_DURATION, REPLAY_COMPLEMENT_DURATION, graphMoveStages } from '../../src/lib/graph-states/animation.js';
import { GRAPH_NODE_RADIUS, graphPositions } from '../../src/lib/graph-states/rendering.js';
import { LEVELS } from '../../src/lib/graph-states/puzzles.js';
import { TUTORIAL } from '../../src/lib/graph-states/tutorial.js';
import { createBrowserApi } from '../circuit-reduction/browser-api.mjs';

const require = createRequire(resolve(process.env.PLAYWRIGHT_MODULE_DIR ?? 'tmp/quality-tools/node_modules', 'package.json'));
const qualityRequire = createRequire(resolve(process.env.QUALITY_MODULE_DIR ?? 'tmp/quality-tools/node_modules', 'package.json'));
const { chromium } = require('playwright');
const axeSource = await readFile(qualityRequire.resolve('axe-core/axe.min.js'), 'utf8');
const base = process.env.GAME_BASE_URL ?? 'http://127.0.0.1:4323';
const output = resolve('tmp/graph-states-browser');
const fixture = createBrowserApi({ now: Date.parse('2026-10-17T10:00:00Z') });
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {}) });
const errors = [];
await mkdir(output, { recursive: true });

function moveSelector(move) {
  return Object.hasOwn(move, 'vertex') ? `button[data-vertex="${move.vertex}"]` :
    `button[data-edge="${[...move.edge].sort((a, b) => a - b).join(':')}"]`;
}

async function edges(page) {
  return page.locator('#graph-board button[data-edge]').evaluateAll(buttons => buttons.map(button =>
    button.dataset.edge.split(':').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]));
}

async function fits(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false,
    'Graph/circuit overflow stays inside its own scroll region');
  const report = await page.locator('#graph-board button[data-vertex]').evaluateAll(buttons => buttons.map(button => {
    const box = button.getBoundingClientRect();
    return { width: box.width, height: box.height, appearance: getComputedStyle(button).appearance };
  }));
  assert.ok(report.length >= 3 && report.every(button => button.width >= 44 && button.height >= 44), 'Vertices have touch-sized controls');
  assert.ok(report.every(button => button.appearance === 'none'), 'Graph controls suppress native mobile button backgrounds');
  await compactCircuit(page);
}

async function compactCircuit(page) {
  if (!await page.locator('.graph-circuit-panel').isVisible()) return;
  const report = await page.locator('#clifford-circuit').evaluate(svg => ({
    columns: svg.querySelectorAll('.graph-correction-column').length,
    width: svg.getBoundingClientRect().width,
    available: svg.parentElement.clientWidth,
    overflow: svg.parentElement.scrollWidth > svg.parentElement.clientWidth + 1,
    phaseGlyphs: [...svg.querySelectorAll('.graph-gate[data-gate="S"], .graph-gate[data-gate="SDG"]')].map(gate => ({
      text: gate.querySelector('text') !== null,
      path: gate.querySelector('path') !== null,
    })),
  }));
  assert.ok(report.columns <= 3, 'Accumulated local Clifford corrections need at most three circuit columns');
  assert.ok(report.width <= report.available + 1 && !report.overflow, 'The full correction circuit fits without horizontal panning');
  assert.ok(report.phaseGlyphs.every(gate => !gate.text && gate.path), 'S and its dagger use crisp vector glyphs rather than font characters');
}

async function gateLegend(page, tap) {
  const initial = await edges(page), opener = page.locator('#show-gate-legend');
  const dialog = page.getByRole('dialog', { name: 'What are these gates?', exact: true });
  await tap(opener);
  assert.equal(await dialog.locator('li').count(), 5, 'The legend covers every local Clifford gate');
  const gates = await dialog.locator('.graph-gate').evaluateAll(nodes => nodes.map(node => ({
    gate: node.dataset.gate, width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height,
  })));
  assert.deepEqual(gates.map(({ gate }) => gate).sort(), ['H', 'S', 'SDG', 'X', 'Z']);
  assert.ok(gates.every(({ width, height }) => width > 10 && height > 10), 'The legend uses visible gameplay glyphs');
  assert.equal(await dialog.evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#gate-legend-dialog').evaluate(node => node.open), false);
  assert.equal(await opener.evaluate(node => document.activeElement === node), true, 'Closing returns focus to the legend button');
  await tap(opener);
  await tap(page.locator('#close-gate-legend'));
  assert.equal(await page.locator('#gate-legend-dialog').evaluate(node => node.open), false);
  assert.deepEqual(await edges(page), initial, 'Viewing the gate legend preserves the game');
}

async function captureCorrections(page, name, stage) {
  if (!await page.locator('#advanced-features').evaluate(details => details.open)) {
    await page.locator('#advanced-features > summary').click();
  }
  for (const gate of ['S', 'SDG']) {
    assert.ok(await page.locator(`#clifford-circuit .graph-gate[data-gate="${gate}"]`).count() > 0,
      `The ${stage} visual check includes ${gate}`);
  }
  await page.locator('.graph-circuit-panel').screenshot({ path: resolve(output, `${name}-corrections-${stage}.png`) });
}

async function accessibility(page) {
  await page.evaluate(axeSource);
  const report = await page.evaluate(() => window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] },
  }));
  assert.deepEqual(report.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => ({
    target: node.target, issues: [...node.any, ...node.all].map(({ message, data }) => ({ message, data })),
  })) })), []);
}

async function closeWin(page, tap) {
  if (await page.locator('#win-dialog').evaluate(dialog => dialog.open)) await tap(page.locator('#close-win'));
}

async function importGraph(page, tap, graph) {
  await tap(page.locator('#input-json'));
  await page.locator('#puzzle-json-text').fill(JSON.stringify(graph));
  await tap(page.locator('#puzzle-json-apply'));
  await page.waitForFunction(() => !document.getElementById('puzzle-json-dialog').open);
  assert.deepEqual(await edges(page), graph.edges);
}

async function solve(page, tap, initial) {
  let graph = initial;
  for (const move of solutionForGraph(graph)) {
    await tap(page.locator('#graph-board ' + moveSelector(move)));
    graph = applyMove(graph, move);
    assert.deepEqual(await edges(page), graph.edges, 'Every real click matches the graph engine');
    await compactCircuit(page);
  }
  await page.waitForFunction(() => document.getElementById('win-dialog').open);
  assert.deepEqual(await edges(page), pathGraph(graph.vertices).edges, 'The final labelled graph is exactly the target chain');
}

async function savedScore(page, action, expected, shots) {
  const response = page.waitForResponse(response => response.url().includes('/api/leaderboard') && response.request().method() === 'POST');
  await action();
  const saved = await response, payload = saved.request().postDataJSON(), board = await saved.json();
  assert.equal(saved.status(), 201);
  assert.deepEqual(Object.keys(payload).sort(), ['game', ...Object.keys(expected), 'name', 'sequence'].sort(),
    'The client submits a replay, without a client-controlled shot count');
  assert.equal(payload.game, 'graph-states');
  for (const [key, value] of Object.entries(expected)) assert.equal(payload[key], value);
  assert.equal(sequenceCost(payload.sequence), shots);
  assert.equal(board.currentPlayer.moves, shots, 'The server counts one shot per local complementation and three per pivot');
  await page.waitForFunction(() => document.getElementById('score-status').textContent === 'Score saved.');
  assert.match(await page.locator('#player-rank').innerText(), new RegExp(`Best: ${shots} shot${shots === 1 ? '' : 's'}$`));
  assert.match(await page.locator('#win-summary').innerText(), new RegExp(`\\b${shots} shot${shots === 1 ? '' : 's'}\\b`));
  assert.deepEqual(await page.locator('#win-results th').allTextContents(), ['Rank', 'Player', 'Shots']);
  const initial = expected.level ? LEVELS[expected.level - 1] : fixture.getDaily('graph-states', expected.date).puzzle;
  const optimal = optimalShots(initial);
  const benchmarks = await page.locator('#leaderboard-body .benchmark, #result-leaderboard-body .benchmark').evaluateAll(rows =>
    rows.map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent)));
  assert.deepEqual(benchmarks, Array(2).fill(['—', 'Optimal', String(optimal)]), 'Both leaderboards include the exact optimal shot count');
  assert.equal(await page.locator('#shot-count').innerText(), `Shots: ${shots} · Optimal: ${optimal}`);
  if (shots === optimal) assert.match(await page.locator('#win-summary').innerText(), /^Optimal solution/);
  else assert.match(await page.locator('#win-summary').innerText(), new RegExp(`Optimal: ${optimal}\\.$`));
  return payload;
}

async function captureRewrite(context, name, options, initial) {
  const page = await context.newPage();
  const tap = locator => options.hasTouch ? locator.tap() : locator.click();
  try {
    await page.clock.install({ time: new Date('2026-10-17T09:59:00Z') });
    await fixture.install(page);
    await page.goto(base + '/games/graph-states/');
    await tap(page.locator('#mode-random'));
    await importGraph(page, tap, initial);
    await page.evaluate(() => document.fonts.ready);
    await page.clock.pauseAt(new Date('2026-10-17T10:00:00Z'));
    // Real pointer input is checked separately; freeze only this visual capture.
    await page.locator('#graph-board [data-vertex="2"]').evaluate(node => node.click());
    await page.clock.runFor(.55 * COMPLEMENT_DURATION);
    assert.equal(await page.locator('#graph-board').getAttribute('data-animation-phase'), 'rewrite');
    const clip = await page.locator('#graph-board').boundingBox();
    await page.screenshot({ path: resolve(output, `${name}-animation-rewrite.png`), clip });
  } finally {
    await page.close();
  }
}

async function animatedMoves(name, options) {
  const context = await browser.newContext({ ...options, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(`${name} animation: ${error.message}`));
  const tap = locator => options.hasTouch ? locator.tap() : locator.click();
  const board = page.locator('#graph-board');
  const initial = applyMove(pathGraph(4), { vertex: 1 });
  try {
    await page.clock.setFixedTime(new Date('2026-10-17T10:00:00Z'));
    await fixture.install(page);
    await page.goto(base + '/games/graph-states/');
    await tap(page.locator('#mode-random'));
    await importGraph(page, tap, initial);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => {
      const canvas = document.getElementById('zx-wallpaper');
      return canvas?.width === innerWidth && canvas.height === innerHeight;
    });
    // Record the live stages without pausing requestAnimationFrame or changing
    // the game's clock. Every local complementation keeps the same pace.
    await page.evaluate(() => {
      window.graphWallpaperPaints = 0;
      const clear = CanvasRenderingContext2D.prototype.clearRect;
      CanvasRenderingContext2D.prototype.clearRect = function (...args) {
        if (this.canvas.id === 'zx-wallpaper') window.graphWallpaperPaints++;
        return clear.apply(this, args);
      };
    });
    await board.evaluate(node => {
      window.graphMotion = [];
      window.graphGeometry = [];
      const record = () => {
        const state = { busy: node.dataset.graphAnimating === 'true', phase: node.dataset.animationPhase,
          vertex: node.dataset.animationVertex, time: performance.now() };
        const previous = window.graphMotion.at(-1);
        if (!previous || previous.busy !== state.busy || previous.phase !== state.phase || previous.vertex !== state.vertex) {
          window.graphMotion.push(state);
        }
        if (state.busy && state.phase === 'rewrite' && window.graphGeometry.length < 2 &&
            (!window.graphGeometry.length || state.time - window.graphGeometry[0].time >= 240)) {
          window.graphGeometry.push({ time: state.time, affected: node.querySelectorAll('.graph-node.is-affected').length,
            duplicates: node.querySelectorAll('.is-duplicate').length,
            lines: [...node.querySelectorAll('.graph-animation-edge')].map(line => ({
              appearing: line.classList.contains('is-appearing'), removing: line.classList.contains('is-removing'),
              stroke: getComputedStyle(line).stroke,
              x1: Number(line.getAttribute('x1')), y1: Number(line.getAttribute('y1')),
              x2: Number(line.getAttribute('x2')), y2: Number(line.getAttribute('y2')),
            })),
          });
        }
      };
      new MutationObserver(record).observe(node, { attributes: true, subtree: true });
    });
    await tap(board.locator('[data-vertex="2"]'));
    await page.waitForFunction(() => document.getElementById('graph-board').dataset.graphAnimating === 'true');
    const wallpaperDuringMove = await page.evaluate(() => window.graphWallpaperPaints);
    assert.equal(await board.getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('#undo').isDisabled(), true, 'Undo cannot overlap an unfinished graph rewrite');
    assert.deepEqual(await edges(page), initial.edges, 'The operation is not committed while pulses travel');
    assert.equal(await page.locator('#sequence button').count(), 0);
    assert.equal(await board.locator('.graph-animation-dot').count(), 3, 'A pulse travels to each current neighbour');
    const positions = graphPositions(initial.vertices), stage = graphMoveStages(initial, { vertex: 2 })[0];
    const dots = await board.locator('.graph-animation-dot').evaluateAll(nodes => nodes.map(node => ({
      x: Number(node.getAttribute('cx')), y: Number(node.getAttribute('cy')),
    })));
    for (const [index, dot] of dots.entries()) {
      const source = positions[stage.vertex], target = positions[stage.neighbours[index]];
      assert.ok(Math.hypot(dot.x - source.x, dot.y - source.y) >= GRAPH_NODE_RADIUS - .001,
        'Travelling dots start outside the opaque source vertex');
      assert.ok(Math.hypot(dot.x - target.x, dot.y - target.y) >= GRAPH_NODE_RADIUS - .001,
        'Travelling dots stop outside the opaque destination vertex');
    }
    // A second real pointer action while the graph is busy cannot enqueue a shot.
    const source = await board.locator('[data-vertex="2"]').boundingBox();
    if (options.hasTouch) await page.touchscreen.tap(source.x + source.width / 2, source.y + source.height / 2);
    else await page.mouse.click(source.x + source.width / 2, source.y + source.height / 2);
    await page.waitForFunction(() => window.graphGeometry.length === 2);
    const [firstSample, laterSample] = await page.evaluate(() => window.graphGeometry);
    assert.equal(await page.evaluate(() => window.graphWallpaperPaints), wallpaperDuringMove,
      'The static decorative background does not repaint while the graph is moving');
    assert.equal(firstSample.affected, 3, 'All neighbours glow before their edges change');
    assert.equal(laterSample.lines.filter(line => line.appearing).length, 4,
      'Each missing neighbour edge grows inward from both endpoints');
    assert.equal(laterSample.lines.filter(line => line.removing).length, 2,
      'An existing edge remains a single line, split into two adjoining halves');
    assert.equal(laterSample.duplicates, 0, 'Rewrites never create parallel edge copies');
    assert.ok(laterSample.time - firstSample.time >= 240, 'Geometry is sampled at distinct live animation frames');
    const halves = stage.pairs.flatMap(({ edge, existed }) => {
      const [a, b] = edge.map(vertex => positions[vertex]);
      const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      return [a, b].map(vertex => {
        const dx = middle.x - vertex.x, dy = middle.y - vertex.y, distance = Math.hypot(dx, dy);
        const start = { x: vertex.x + dx * GRAPH_NODE_RADIUS / distance, y: vertex.y + dy * GRAPH_NODE_RADIUS / distance };
        return { start, middle, existed };
      });
    });
    for (const [index, { start, middle, existed }] of halves.entries()) {
      const line = laterSample.lines[index], previous = firstSample.lines[index];
      const length = segment => Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1);
      assert.equal(line.appearing, !existed);
      if (existed) {
        assert.deepEqual([line.x2, line.y2], [middle.x, middle.y], 'Erasure keeps the remaining line joined at the middle');
        assert.ok(length(line) < length(previous), 'Existing edges erase inward from their vertices');
      } else {
        assert.equal(line.stroke, 'rgb(245, 245, 242)', 'New edges are painted white');
        assert.ok(Math.hypot(line.x1 - start.x, line.y1 - start.y) < .001,
          'New edges begin at the visible vertex boundary');
        assert.ok(length(line) > length(previous), 'New edges grow toward the middle');
      }
      for (const [x, y] of [[line.x1, line.y1], [line.x2, line.y2]]) {
        assert.ok(Math.abs((x - start.x) * (middle.y - start.y) - (y - start.y) * (middle.x - start.x)) < .001,
          'Every animated segment stays on the actual edge, without a parallel offset');
      }
    }
    await page.waitForFunction(() => document.getElementById('graph-board').dataset.graphAnimating !== 'true');
    assert.equal(await page.evaluate(() => window.graphWallpaperPaints), wallpaperDuringMove,
      'Completing a graph move does not repaint the static background');
    assert.deepEqual(await edges(page), applyMove(initial, { vertex: 2 }).edges);
    assert.equal(await page.locator('#sequence button').count(), 1, 'Repeated input during animation adds no extra shot');
    let motion = await page.evaluate(() => window.graphMotion);
    assert.deepEqual(motion.filter(state => state.busy && state.phase).map(state => state.phase), ['pulse', 'neighbours', 'rewrite']);
    let duration = motion.at(-1).time - motion.find(state => state.busy).time;
    assert.ok(duration >= COMPLEMENT_DURATION - 100, 'Local complementation does not skip its visual stages');
    assert.ok(duration <= COMPLEMENT_DURATION + 300, `Local complementation follows its configured duration (${duration} ms)`);
    assert.equal(await board.locator('.graph-animation, .is-source, .is-affected').count(), 0, 'Animation artwork is removed after completion');
    await compactCircuit(page);

    await tap(page.locator('#restart'));
    await page.evaluate(() => { window.graphMotion = []; });
    // Enter activates exactly the selected native edge even when diagonals cross.
    await board.locator('[data-edge="0:2"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('graph-board').dataset.graphAnimating === 'true');
    assert.equal(await page.locator('#sequence button').count(), 0);
    await page.waitForFunction(() => document.getElementById('graph-board').dataset.graphAnimating !== 'true');
    assert.deepEqual(await edges(page), applyMove(initial, { edge: [0, 2] }).edges);
    assert.equal(await page.locator('#sequence button').count(), 1, 'A three-shot pivot remains one replay operation');
    assert.match(await page.locator('#win-summary').innerText(), /\b3 shots\b/, 'The pivot counts as three shots');
    motion = await page.evaluate(() => window.graphMotion);
    const vertices = motion.filter(state => state.busy && state.vertex !== undefined).map(state => state.vertex)
      .filter((vertex, index, all) => !index || vertex !== all[index - 1]);
    assert.deepEqual(vertices, ['0', '2', '0'], 'A pivot animates its endpoint complementations in order');
    duration = motion.at(-1).time - motion.find(state => state.busy).time;
    assert.ok(duration >= 3 * COMPLEMENT_DURATION - 100, 'Pivot stages are not compressed to fit a total time limit');
    assert.ok(duration <= 3 * COMPLEMENT_DURATION + 300, `A pivot keeps the same duration for each local complementation (${duration} ms)`);

    await closeWin(page, tap);
    await page.evaluate(() => { window.graphMotion = []; });
    if (!await page.locator('#advanced-features').evaluate(node => node.open)) await tap(page.locator('#advanced-features > summary'));
    await tap(page.locator('#replay'));
    await page.waitForFunction(() => document.getElementById('graph-board').dataset.graphAnimating === 'true');
    assert.equal(await page.locator('#review-note').innerText(), 'Operation 0 / 1', 'Review waits for the full pivot animation');
    await page.waitForFunction(() => document.getElementById('review-note').textContent === 'Operation 1 / 1');
    motion = await page.evaluate(() => window.graphMotion);
    const replayVertices = motion.filter(state => state.busy && state.vertex !== undefined).map(state => state.vertex)
      .filter((vertex, index, all) => !index || vertex !== all[index - 1]);
    assert.deepEqual(replayVertices, ['0', '2', '0'], 'Replay includes all three animated pivot stages');
    assert.ok(motion.some(state => state.phase === 'pulse') && motion.some(state => state.phase === 'rewrite'));
    duration = motion.at(-1).time - motion.find(state => state.busy).time;
    assert.ok(duration >= 3 * REPLAY_COMPLEMENT_DURATION - 100 && duration <= 3 * REPLAY_COMPLEMENT_DURATION + 300,
      `Replay keeps all three stages at its faster pace (${duration} ms)`);
    assert.deepEqual(await edges(page), applyMove(initial, { edge: [0, 2] }).edges);
    assert.equal(await page.locator('#sequence button').count(), 1, 'Animated replay preserves the played sequence');
    await tap(page.locator('#resume-round'));
    await tap(page.locator('#replay'));
    await page.waitForFunction(() => document.getElementById('graph-board').dataset.graphAnimating === 'true');
    await tap(page.locator('#resume-round'));
    assert.notEqual(await board.getAttribute('data-graph-animating'), 'true');
    assert.deepEqual(await edges(page), applyMove(initial, { edge: [0, 2] }).edges, 'Resuming cancels replay motion and restores the live graph');

    await tap(page.locator('#restart'));
    await board.locator('[data-edge="0:2"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('graph-board').dataset.animationVertex === '2');
    const rejectedDaily = route => route.fulfill({ status: 400, contentType: 'application/json',
      body: JSON.stringify({ error: 'Daily unavailable for this test.' }) });
    await page.route('**/api/daily**', rejectedDaily);
    await tap(page.locator('#mode-daily'));
    await page.waitForFunction(() => document.getElementById('daily-status').textContent === 'Daily unavailable for this test.');
    assert.deepEqual(await edges(page), initial.edges, 'A failed daily selection restores the committed graph during an intermediate pivot stage');
    assert.equal(await page.locator('#mode-random').getAttribute('aria-pressed'), 'true');
    await page.waitForTimeout(3 * COMPLEMENT_DURATION + 100);
    assert.deepEqual(await edges(page), initial.edges, 'The interrupted pivot cannot commit after a failed daily request');
    assert.equal(await page.locator('#sequence button').count(), 0);
    await page.unroute('**/api/daily**', rejectedDaily);

    await tap(page.locator('#restart'));
    await tap(board.locator('[data-vertex="2"]'));
    await page.waitForFunction(() => document.getElementById('graph-board').dataset.graphAnimating === 'true');
    const wallpaperBeforeCancel = await page.evaluate(() => window.graphWallpaperPaints);
    await tap(page.locator('#restart'));
    assert.notEqual(await board.getAttribute('data-graph-animating'), 'true');
    assert.deepEqual(await edges(page), initial.edges, 'Restart cancels an unfinished move');
    await page.waitForTimeout(COMPLEMENT_DURATION + 100);
    assert.equal(await page.evaluate(() => window.graphWallpaperPaints), wallpaperBeforeCancel,
      'Cancelling a graph move does not restart decorative background painting');
    assert.deepEqual(await edges(page), initial.edges, 'A cancelled animation cannot commit later');
    assert.equal(await page.locator('#sequence button').count(), 0);

    await tap(board.locator('[data-vertex="2"]'));
    await page.waitForFunction(() => document.getElementById('graph-board').dataset.graphAnimating === 'true');
    await tap(page.locator('#mode-campaign'));
    await page.waitForTimeout(COMPLEMENT_DURATION + 100);
    assert.deepEqual(await edges(page), LEVELS[0].edges, 'Changing mode cancels pending graph operations');
    assert.equal(await page.locator('#sequence button').count(), 0);
    assert.equal(await page.locator('#win-dialog').evaluate(dialog => dialog.open), false, 'Cancelled moves do not open stale results');

    await tap(page.locator('#mode-tutorial'));
    await tap(page.locator('#tutorial-start'));
    await tap(page.locator('#tutorial-next'));
    await page.waitForFunction(() => document.getElementById('graph-board').dataset.graphAnimating === 'true');
    assert.equal(await page.locator('#tutorial-heading').innerText(), `Step 1 of ${TUTORIAL.steps.length}`);
    assert.equal(await page.locator('#tutorial-next').isDisabled(), true, 'The guide waits for the entire local complementation');
    await page.waitForFunction(count => document.getElementById('tutorial-heading').textContent === `Step 2 of ${count}`, TUTORIAL.steps.length);
    assert.equal(await board.locator('[data-tutorial-focus]').count(), 1);
    const tutorialGraph = await edges(page);
    await tap(page.locator('#tutorial-next'));
    await page.waitForFunction(() => document.getElementById('graph-board').dataset.graphAnimating === 'true');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await page.waitForFunction(() => !document.getElementById('tutorial-next').disabled);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    assert.equal(await page.locator('#tutorial-heading').innerText(), `Step 2 of ${TUTORIAL.steps.length}`, 'A suspended animation does not advance the tutorial');
    assert.deepEqual(await edges(page), tutorialGraph);
    assert.equal(await board.locator('[data-tutorial-focus]').count(), 1);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await tap(page.locator('#mode-campaign'));
    const started = performance.now();
    await tap(board.locator('[data-vertex="1"]'));
    await page.waitForFunction(() => document.getElementById('graph-board').dataset.graphAnimating !== 'true');
    assert.deepEqual(await edges(page), pathGraph(3).edges, 'Reduced motion applies the graph operation immediately');
    assert.ok(performance.now() - started < 1000, 'Reduced motion skips the timed animation');
    await closeWin(page, tap);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => {
      const read = () => JSON.stringify(['show-results', 'share-replay', 'share-result', 'next-level', 'result-next', 'score-form', 'result-actions']
        .map(id => { const node = document.getElementById(id); return [id, node.hidden, node.disabled]; }));
      window.graphReplayUi = [read()];
      window.graphReplayObserver = new MutationObserver(() => {
        const state = read();
        if (state !== window.graphReplayUi.at(-1)) window.graphReplayUi.push(state);
      });
      window.graphReplayObserver.observe(document.body, { attributes: true, subtree: true });
    });
    await tap(page.locator('#replay'));
    await page.waitForFunction(() => document.getElementById('graph-board').dataset.graphAnimating === 'true');
    await page.waitForFunction(() => document.getElementById('review-note').textContent === 'Operation 1 / 1');
    assert.equal(await page.evaluate(() => window.graphReplayUi.length), 1,
      'Completed-round buttons and score fields never appear, disappear or change availability during replay');
    assert.equal(await page.locator('#win-dialog').evaluate(dialog => dialog.open), false, 'Replay does not reopen results');
    await page.evaluate(() => window.graphReplayObserver.disconnect());
    await tap(page.locator('#resume-round'));
    await fits(page);
    await captureRewrite(context, name, options, initial);
    console.log(`${name}: pulses, neighbour glow, edge growth/cancellation, pivot stages, input lock, cancellation and reduced motion passed.`);
  } finally {
    await context.close();
  }
}

try {
  for (const [name, options] of [
    ['desktop', { viewport: { width: 1440, height: 1000 } }],
    ['mobile390', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
    ['mobile320', { viewport: { width: 320, height: 780 }, isMobile: true, hasTouch: true }],
  ]) {
    const context = await browser.newContext({ ...options, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const workers = [];
    const submissions = [];
    page.on('worker', worker => workers.push(worker.url()));
    page.on('request', request => {
      if (request.url().includes('/api/leaderboard') && request.method() === 'POST') submissions.push(request.postDataJSON());
    });
    const tap = async locator => {
      if (await locator.getAttribute('data-edge') === null) return options.hasTouch ? locator.tap() : locator.click();
      await locator.scrollIntoViewIfNeeded();
      // Tap the visible line itself, away from the centre where several
      // diagonals can cross, rather than trusting overlapping hit rectangles.
      const point = await locator.evaluate(button => {
        const board = button.closest('#graph-board');
        const [a, b] = button.dataset.edge.split(':').map(vertex => {
          const box = board.querySelector(`[data-vertex="${vertex}"]`).getBoundingClientRect();
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        });
        return { x: a.x + .37 * (b.x - a.x), y: a.y + .37 * (b.y - a.y) };
      });
      return options.hasTouch ? page.touchscreen.tap(point.x, point.y) : page.mouse.click(point.x, point.y);
    };
    page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
    await page.clock.setFixedTime(new Date('2026-10-17T10:00:00Z'));
    await fixture.install(page);
    await page.goto(base + '/games/graph-states/');
    await page.locator('#graph-board button[data-vertex]').first().waitFor();
    assert.equal(await page.locator('#mode-tutorial').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#leaderboard-section').isVisible(), false);
    assert.equal(await page.locator('#graph-editor-controls').isVisible(), false);
    assert.equal(await page.locator('#advanced-features').evaluate(details => details.open), false);
    assert.equal(await page.locator('.graph-circuit-panel').isVisible(), false, 'Clifford corrections are hidden until Advanced is opened');
    await fits(page);
    await tap(page.locator('#tutorial-start'));
    let tutorialStep = 0;
    for (let guard = 0; guard < 16 && await page.locator('#tutorial-next').isVisible(); guard++) {
      const focus = page.locator('[data-tutorial-focus]');
      assert.equal(await focus.count(), 1, 'The guide highlights one real control');
      const final = tutorialStep === TUTORIAL.steps.length - 1;
      if (final) {
        assert.notEqual(await focus.getAttribute('data-edge'), null, 'The final tutorial step demonstrates an actual pivot');
        assert.match(await page.locator('#tutorial-text').innerText(), /complements vertices|three local complementations|3 local complementations/i);
        assert.match(await page.locator('#tutorial-text').innerText(), /3 shots/);
      } else {
        assert.notEqual(await focus.getAttribute('data-vertex'), null, 'The earlier tutorial steps teach local complementation');
        assert.equal(await focus.getAttribute('data-edge'), null, 'Pivoting is introduced only at the end');
      }
      assert.match(await page.locator('#tutorial-heading').innerText(), new RegExp(`^Step ${++tutorialStep} of `));
      await tap(focus);
    }
    assert.equal(tutorialStep, TUTORIAL.steps.length);
    assert.equal(await page.locator('#tutorial-heading').innerText(), 'Tutorial complete');
    assert.equal(sequenceCost(TUTORIAL.steps.map(step => step.move)), TUTORIAL.steps.length + 2,
      'The final pivot contributes three shots after the local complementations');
    assert.equal(await page.locator('#win-dialog').evaluate(dialog => dialog.open), false, 'Tutorials do not submit results');
    await tap(page.locator('#tutorial-levels'));
    await solve(page, tap, LEVELS[0]);
    const nickname = `Graph ${name}`;
    const firstScore = await savedScore(page, async () => {
      await page.locator('#player-name').fill(nickname);
      await tap(page.locator('#submit-score'));
    }, { level: 1 }, 1);
    assert.deepEqual(firstScore.sequence, [{ vertex: 1 }], 'A local complementation contributes one shot');
    await closeWin(page, tap);
    await tap(page.locator('#undo'));
    assert.deepEqual(await edges(page), LEVELS[0].edges, 'Undo restores the starting graph');
    assert.equal(await page.locator('.graph-circuit-panel').isVisible(), false);
    await tap(page.locator('#advanced-features > summary'));
    // Native details toggle events are queued after the click completes.
    await page.locator('#clifford-circuit[viewBox]').waitFor({ state: 'attached' });
    assert.ok(await page.locator('#clifford-circuit').getAttribute('viewBox'), 'The correction circuit is rendered');
    assert.equal(await page.locator('#clifford-circuit .graph-gate').count(), 0, 'Opening Advanced shows corrections for the current move count');
    await gateLegend(page, tap);
    await tap(page.locator('#advanced-features > summary'));
    await solve(page, tap, LEVELS[0]);
    await closeWin(page, tap);
    await tap(page.locator('#advanced-features > summary'));
    await page.locator('#clifford-circuit .graph-gate').first().waitFor();
    assert.ok(await page.locator('#clifford-circuit .graph-gate').count() > 0, 'Reopening Advanced includes moves played while it was closed');
    await compactCircuit(page);
    await tap(page.locator('#replay'));
    await page.locator('#review-controls').waitFor();
    assert.equal(await page.locator('#review-note').innerText(), 'Operation 0 / 1');
    await tap(page.locator('#show-results'));
    await page.waitForFunction(() => document.getElementById('win-dialog').open);
    assert.equal(await page.locator('#review-controls').isVisible(), false, 'Results leave replay review');
    assert.deepEqual(await edges(page), pathGraph(3).edges, 'Results show the final chain behind the popup');
    await closeWin(page, tap);
    await tap(page.locator('#replay'));
    await page.locator('#review-controls').waitFor();
    assert.equal(await page.locator('#undo').isDisabled(), true, 'Review cannot mutate a live round');
    await tap(page.locator('#resume-round'));
    if (name === 'desktop') {
      assert.deepEqual(workers, [], 'Playing and reviewing create no export worker');
      await tap(page.locator('#share-replay'));
      assert.equal(await page.locator('#share-dialog').evaluate(dialog => dialog.open), true);
      await page.locator('#share-preview').waitFor({ state: 'visible' });
      await page.locator('#share-preview').evaluate(image => image.decode());
      const preview = await page.locator('#share-preview').getAttribute('src');
      assert.equal(workers.length, 1, 'Opening Share replay renders a still image without encoding a GIF');
      assert.equal(await page.locator('#copy-gif').isEnabled(), true, 'The still image can be copied before downloading');
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30_000 }),
        tap(page.locator('#download-gif')),
      ]);
      assert.equal(await download.failure(), null);
      const bytes = await readFile(await download.path());
      assert.equal(bytes.subarray(0, 6).toString('ascii'), 'GIF89a');
      assert.ok(bytes.length > 1000, 'The replay contains encoded graph frames');
      assert.equal(workers.length, 2, 'Download starts exactly one GIF worker after the still renderer');
      assert.ok(workers[0].includes('graph-states-gif-worker'));
      assert.equal(await page.locator('#share-preview').getAttribute('src'), preview, 'Downloading keeps the still preview');
      const [repeated] = await Promise.all([
        page.waitForEvent('download'), tap(page.locator('#download-gif')),
      ]);
      assert.deepEqual(await readFile(await repeated.path()), bytes, 'Repeated downloads reuse the encoded GIF');
      assert.equal(workers.length, 2);
      assert.equal(await page.locator('#share-status').innerText(), '');
      await tap(page.locator('#close-share'));
    }

    const pivotScore = await savedScore(page, async () => {
      await page.locator('#level').selectOption('2');
      await solve(page, tap, LEVELS[1]);
    }, { level: 2 }, 3);
    assert.equal(pivotScore.name, nickname, 'The next level reuses the remembered nickname');
    assert.deepEqual(pivotScore.sequence, [{ edge: [0, 1] }], 'A pivot contributes three shots, including all its Clifford corrections');
    assert.equal(await page.locator('#score-form').isVisible(), false, 'The next score is saved without asking for the nickname again');
    await closeWin(page, tap);

    await tap(page.locator('#mode-random'));
    assert.equal(await page.locator('#custom-controls').isVisible(), true);
    const pivotGraph = applyMove(pathGraph(4), { edge: [1, 2] });
    await importGraph(page, tap, pivotGraph);
    await tap(page.locator('#graph-board button[data-edge="1:2"]'));
    await page.waitForFunction(() => document.getElementById('win-dialog').open);
    assert.deepEqual(await edges(page), pathGraph(4).edges, 'An edge tap performs a pivot');
    await closeWin(page, tap);
    await tap(page.locator('#restart'));
    assert.deepEqual(await edges(page), pivotGraph.edges);
    if (name === 'desktop') {
      await page.locator('#graph-board button[data-edge="1:2"]').focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.getElementById('win-dialog').open);
      assert.deepEqual(await edges(page), pathGraph(4).edges, 'Native edge buttons still pivot with keyboard Enter');
      await closeWin(page, tap);
      await tap(page.locator('#restart'));
    }
    await tap(page.locator('#share-json'));
    const exported = JSON.parse(await page.locator('#puzzle-json-text').inputValue());
    assert.deepEqual(exported, pivotGraph, 'JSON contains only graph vertices and edges');
    await tap(page.locator('#puzzle-json-close'));
    await tap(page.locator('#input-json'));
    await page.locator('#puzzle-json-text').fill('{"vertices":6,"edges":[]}');
    await tap(page.locator('#puzzle-json-apply'));
    assert.equal(await page.locator('#puzzle-json-dialog').evaluate(dialog => dialog.open), true);
    assert.ok((await page.locator('#puzzle-json-status').innerText()).length > 0, 'Unreachable imports report a useful error');
    await tap(page.locator('#puzzle-json-close'));
    assert.deepEqual(await edges(page), pivotGraph.edges, 'Invalid imports preserve the current puzzle');

    if (!await page.locator('#advanced-features').evaluate(details => details.open)) await tap(page.locator('#advanced-features > summary'));
    await tap(page.locator('#new-graph'));
    await page.locator('#editor-vertices').selectOption('4');
    assert.deepEqual(await edges(page), pathGraph(4).edges);
    await tap(page.locator('#graph-board button[data-vertex="1"]'));
    const draft = applyMove(pathGraph(4), { vertex: 1 });
    assert.deepEqual(await edges(page), draft.edges);
    await tap(page.locator('#save-graph'));
    assert.equal(await page.locator('#custom-details').isVisible(), false);
    await solve(page, tap, draft);
    await closeWin(page, tap);

    // A long editor history used to make the correction circuit wider than the
    // screen. Keep it playable and inspect the actual populated gate artwork.
    if (!await page.locator('#advanced-features').evaluate(details => details.open)) await tap(page.locator('#advanced-features > summary'));
    await tap(page.locator('#new-graph'));
    await page.locator('#editor-vertices').selectOption('8');
    let longGraph = pathGraph(8);
    for (let index = 0; index < 37; index++) {
      const move = index % 5 === 4 ? { edge: longGraph.edges[Math.floor(longGraph.edges.length / 2)] } : { vertex: [1, 4, 2, 6][index % 4] };
      await tap(page.locator('#graph-board ' + moveSelector(move)));
      longGraph = applyMove(longGraph, move);
      assert.deepEqual(await edges(page), longGraph.edges, `${name}: long-history operation ${index + 1} applies the intended move`);
      await compactCircuit(page);
      if (index === 7) await captureCorrections(page, name, 'midgame');
    }
    await fits(page);
    await captureCorrections(page, name, 'long-history');

    await tap(page.locator('#mode-daily'));
    await page.waitForFunction(() => document.getElementById('mode-daily').getAttribute('aria-pressed') === 'true');
    assert.equal(await page.locator('#custom-controls').isVisible(), false);
    assert.equal(await page.locator('#graph-editor-controls').isVisible(), false, 'Daily puzzles hide editing controls');
    const dailyPuzzle = fixture.getDaily('graph-states', '2026-10-17');
    assert.equal(dailyPuzzle.acceptingScores, true);
    assert.equal(dailyPuzzle.puzzle.optimalMoves, optimalShots(dailyPuzzle.puzzle), 'The daily payload publishes the exact shot benchmark');
    await savedScore(page, () => solve(page, tap, dailyPuzzle.puzzle), { date: '2026-10-17' }, sequenceCost(solutionForGraph(dailyPuzzle.puzzle)));
    await closeWin(page, tap);
    await tap(page.locator('#daily-toggle'));
    await page.locator('#daily-date').selectOption('2026-10-16');
    await page.waitForFunction(() => !document.getElementById('daily-date').disabled && document.getElementById('daily-title').textContent.includes('16 Oct'));
    const savedBeforePractice = submissions.length;
    await solve(page, tap, fixture.getDaily('graph-states', '2026-10-16').puzzle);
    assert.equal(await page.locator('#score-form').isVisible(), false, 'Archived daily puzzles cannot submit ranked scores');
    assert.equal(await page.locator('#win-practice').isVisible(), true);
    assert.equal(submissions.length, savedBeforePractice, 'Completing practice sends no score request');
    await closeWin(page, tap);
    await fits(page);
    await accessibility(page);
    await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });

    await page.route('**/api/daily**', route => route.abort());
    await tap(page.locator('#mode-campaign'));
    const campaignGraph = await page.locator('#graph-board').innerHTML();
    await tap(page.locator('#mode-daily'));
    await page.locator('#daily-status').filter({ hasText: 'Daily puzzle unavailable. Try again.' }).waitFor();
    assert.equal(await page.locator('#mode-campaign').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#graph-board').innerHTML(), campaignGraph, 'A daily API outage preserves the campaign graph');
    await context.close();
    console.log(`${name}: tutorial, vertex/edge shots, remembered scores, undo, replay, visual editor, JSON, daily/practice/outages and accessibility passed.`);
  }
  await animatedMoves('desktop', { viewport: { width: 1440, height: 1000 } });
  await animatedMoves('mobile390', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  assert.deepEqual(errors, [], 'The game has no uncaught browser errors');
} finally {
  await browser.close();
}
