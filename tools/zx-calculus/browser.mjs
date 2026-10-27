import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LEVELS as LESSONS, TUTORIAL, applyMove, targetDiagram, ruleFamily } from '../../src/lib/zx-calculus/engine.js';
import solutions from './solutions.json' with { type: 'json' };
import { dailyPuzzle } from '../../src/lib/zx-calculus/leaderboard.js';
import { createBrowserApi } from '../circuit-reduction/browser-api.mjs';

const require = createRequire(resolve(process.env.PLAYWRIGHT_MODULE_DIR ?? 'tmp/quality-tools/node_modules', 'package.json'));
const { chromium } = require('playwright');
const quality = createRequire(resolve(process.env.QUALITY_MODULE_DIR ?? 'tmp/quality-tools/node_modules', 'package.json'));
const axe = await readFile(quality.resolve('axe-core/axe.min.js'), 'utf8');
const base = process.env.GAME_BASE_URL ?? 'http://127.0.0.1:4323';
const output = resolve('tmp/zx-calculus-browser'), date = '2026-10-22';
const LEVELS = LESSONS.map((lesson, index) => ({ ...lesson, solution: solutions[index] }));
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {}) });
await mkdir(output, { recursive: true });
const errors = [], reports = [];
const positions = page => page.locator('#zx-board [data-zx-node]').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.zxNode, node.getAttribute('transform')])));

async function assertDiagram(page, diagram) {
  const actual = await page.locator('#zx-board [data-node]').evaluateAll(nodes => nodes.map(node =>
    ({ id: Number(node.dataset.node), label: node.getAttribute('aria-label') })).sort((a, b) => a.id - b.id));
  const turns = ['no turn', 'quarter turn', 'half turn', 'three-quarter turn'];
  assert.deepEqual(actual, diagram.nodes.filter(node => node.kind !== 'boundary').map(node => ({ id: node.id,
    label: node.kind === 'h' ? 'Hadamard' : `${node.kind === 'z' ? 'Green' : 'Red'} spider, ${turns[node.phase ?? 0]}` })));
  assert.equal(await page.locator('#zx-board .zx-wire').count(), diagram.edges.length);
}
async function selectMove(page, activate, diagram, move) {
  if (move.edge) {
    const edge = [...move.edge].sort((a, b) => a - b);
    const index = diagram.edges.findIndex(candidate => candidate.every((id, offset) => id === edge[offset]));
    assert.ok(index >= 0, 'Insertion selects an existing wire');
    const button = page.locator(`#zx-board [data-edge="${index}"]`);
    if (await button.getAttribute('aria-pressed') !== 'true') await activate(button);
  } else for (const id of move.nodes) await activate(page.locator(`#zx-board [data-node="${id}"]`));
}
async function chooseRule(page, activate, move) {
  const availability = await page.locator('#zx-rules [data-rule]').evaluateAll(buttons =>
    buttons.filter(button => !button.hidden).map(button => !button.disabled));
  assert.ok(availability.every((enabled, index) => !enabled || availability.slice(0, index).every(Boolean)),
    'Applicable equations precede the unavailable equations');
  await activate(page.locator(`#zx-rules [data-rule="${ruleFamily(move.rule)}"]`));
  const dialog = page.locator('#zx-rule-options');
  if (await dialog.isVisible()) {
    const option = move.rule === 'insert' ? Number(move.kind === 'x') : move.rule === 'split' ? move.phase : Number(move.rule === 'add-hopf');
    const count = move.rule === 'split' ? 4 : 2;
    assert.equal(await dialog.locator('[data-option]').count(), count, 'The dialog contains only the applicable alternatives');
    await activate(dialog.locator(`[data-option="${option}"]`));
  }
}
async function solve(page, activate, initial, solution, measure = false) {
  let diagram = initial;
  let performanceReport;
  for (const [index, move] of solution.entries()) {
    const beforePositions = await positions(page);
    await selectMove(page, activate, diagram, move);
    const frames = measure && index === 0 ? page.evaluate(() => new Promise(resolve => {
      document.getElementById('zx-rules').addEventListener('click', () => {
        const board = document.getElementById('zx-board'), samples = [];
        let mutations = 0, started = false;
        const observer = new MutationObserver(records => { mutations += records.length; });
        observer.observe(board, { subtree: true, childList: true });
        function sample(now) {
          if (board.hasAttribute('data-zx-animating')) { started = true; samples.push(now); requestAnimationFrame(sample); }
          else if (!started) requestAnimationFrame(sample);
          else {
            observer.disconnect();
            const gaps = samples.slice(1).map((value, index) => value - samples[index]).sort((a, b) => a - b);
            resolve({ frames: samples.length, elapsedMs: samples.at(-1) - samples[0],
              p95FrameMs: gaps[Math.floor(gaps.length * .95)], childMutations: mutations });
          }
        }
        requestAnimationFrame(sample);
      }, { once: true });
    })) : null;
    await chooseRule(page, activate, move);
    await page.waitForFunction(length => document.querySelectorAll('#sequence [data-step]').length === length, index + 1);
    if (frames) {
      performanceReport = await frames;
      assert.ok(performanceReport.frames >= 12, 'A rewrite has intermediate frames');
      assert.ok(performanceReport.childMutations <= 8, 'Frames reuse a single canvas instead of rebuilding the diagram');
    }
    diagram = applyMove(diagram, move); await assertDiagram(page, diagram);
    const afterPositions = await positions(page);
    for (const [id, point] of Object.entries(afterPositions)) if (beforePositions[id]) assert.equal(point, beforePositions[id], `Rewrite leaves surviving node ${id} in place`);
  }
  await page.locator('#win-dialog[open]').waitFor();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('win-dialog')).opacity === '1');
  return performanceReport;
}
async function canvasControls(page, mobile, label) {
  const original = await positions(page), node = page.locator('#zx-board [data-node="4"]');
  await node.scrollIntoViewIfNeeded();
  await node.evaluate(element => { element.dataset.dragProbe = 'same button'; });
  const box = await node.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
  const dx = x > page.viewportSize().width / 2 ? -44 : 44;
  if (mobile) {
    const touch = await page.context().newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 8; step++) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * step / 8, y: y + 44 * step / 8 }] });
      await page.waitForTimeout(20);
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await touch.detach();
  } else {
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx, y + 44, { steps: 8 }); await page.mouse.up();
  }
  const moved = await positions(page);
  assert.notEqual(moved[4], original[4], 'Dragging moves the node');
  assert.equal(moved[5], original[5], 'Dragging does not rearrange other nodes');
  assert.equal(await node.getAttribute('data-drag-probe'), 'same button', 'Dragging reuses the existing controls');
  assert.equal(await node.getAttribute('aria-pressed'), 'false', 'Dragging does not toggle selection');
  assert.equal(await page.locator('#sequence [data-step]').count(), 0, 'Moving the drawing costs no rewrite');
  await node.focus(); await page.keyboard.press('ArrowRight');
  assert.notEqual((await positions(page))[4], moved[4], 'Keyboard users can move the focused node');
  await page.screenshot({ path: resolve(output, `${label}-dragged.png`), fullPage: true });
  await page.locator('#restart').click();
  assert.deepEqual(await positions(page), original, 'Reset restores the initial node positions');
}
async function importDiagram(page, activate, diagram) {
  await openAdvanced(page, activate);
  await activate(page.locator('#input-json'));
  await page.locator('#puzzle-json-text').fill(JSON.stringify(diagram));
  await activate(page.locator('#puzzle-json-apply'));
  await page.waitForFunction(() => !document.getElementById('puzzle-json-dialog').open);
  await assertDiagram(page, diagram);
}
async function openAdvanced(page, activate) {
  if (!await page.locator('#advanced-features').evaluate(node => node.open)) await activate(page.locator('#advanced-features > summary'));
}
async function audit(page) {
  assert.doesNotMatch(await page.locator('body').innerText(), /π/, 'Gameplay uses quarter-turn sectors rather than angle notation');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Page overflow stays inside the diagram');
  const hitAreas = await page.locator('#zx-board button').evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect(); return { width: rect.width, height: rect.height,
      minimum: node.classList.contains('zx-node') ? 44 : 24, appearance: getComputedStyle(node).appearance };
  }));
  assert.ok(hitAreas.every(rect => rect.width >= rect.minimum && rect.height >= rect.minimum && rect.appearance === 'none'));
  await page.evaluate(axe);
  const result = await page.evaluate(() => window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] },
  }));
  assert.deepEqual(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })), []);
}
try {
  for (const mobile of [false, true]) {
    const label = mobile ? 'mobile' : 'desktop';
    const context = await browser.newContext(mobile
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }
      : { viewport: { width: 1280, height: 900 } });
    await createBrowserApi({ now: Date.parse(`${date}T10:00:00Z`) }).install(context);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${label}: ${error.message}`));
    const activate = node => mobile ? node.tap() : node.click();
    await page.goto(`${base}/games/zx-calculus/`);
    await page.locator('#tutorial-start:not([disabled])').waitFor();
    await audit(page);
    assert.equal(await page.locator('#zx-rules button').count(), 5, 'All modes use one five-equation palette');
    assert.equal(await page.locator('#zx-expansions, #edit-diagram').count(), 0);
    assert.equal(await page.locator('#zx-board .zx-phase-sector').count(), 2, 'The worked example begins with a quarter turn and three-quarter turn');
    assert.equal(await page.locator('#zx-board button[aria-label="Green spider, quarter turn"]').count(), 1);
    assert.equal(await page.locator('#zx-board button[aria-label="Green spider, three-quarter turn"]').count(), 1);
    await activate(page.locator('#show-rules'));
    assert.equal(await page.locator('#zx-phase-cycle .zx-glyph').count(), 5);
    assert.equal(await page.locator('#zx-phase-cycle .zx-phase-sector').count(), 3);
    assert.equal(await page.locator('#zx-phase-examples .zx-phase-sector').count(), 5);
    assert.doesNotMatch(await page.locator('#rules-dialog').innerText(), /π/);
    await page.screenshot({ path: resolve(output, `${label}-phase-rules.png`), fullPage: true });
    await activate(page.locator('#close-rules'));
    await page.screenshot({ path: resolve(output, `${label}-tutorial.png`), fullPage: true });
    await activate(page.locator('#tutorial-start'));
    for (const [index, move] of TUTORIAL.solution.entries()) {
      const rule = page.locator(`#zx-rules [data-rule="${move.rule}"]`);
      assert.equal(await rule.isDisabled(), true, 'The highlighted rewrite remains read-only');
      await activate(page.locator('#tutorial-next'));
      await page.waitForFunction(text => document.getElementById('tutorial-heading').textContent === text,
        index + 1 === TUTORIAL.solution.length ? 'Tutorial complete' : `Step ${index + 2} of ${TUTORIAL.solution.length}`);
    }
    await page.getByText('Tutorial complete', { exact: true }).waitFor();
    await assertDiagram(page, targetDiagram());
    assert.equal(await page.locator('#win-dialog').evaluate(node => node.open), false);
    await activate(page.locator('#tutorial-levels'));
    let phaseFusionAnimation;
    for (const [index, level] of LEVELS.entries()) {
      await page.locator('#level').selectOption(String(index + 1));
      await assertDiagram(page, level.diagram);
      if (index === 0) {
        await canvasControls(page, mobile, label);
        for (const id of level.solution[0].nodes) await activate(page.locator(`#zx-board [data-node="${id}"]`));
        const observed = page.evaluate(() => new Promise(resolve => {
          document.getElementById('zx-rules').addEventListener('click', () => {
            resolve(Boolean(document.querySelector('#zx-board[data-zx-animating="true"][aria-busy="true"] canvas')));
          }, { once: true });
        }));
        await activate(page.locator(`[data-rule="${level.solution[0].rule}"]`));
        assert.equal(await observed, true, 'Rewrites have an animation layer and lock their controls');
        await activate(page.locator('#restart'));
        await assertDiagram(page, level.diagram);
        assert.equal(await page.locator('#zx-board canvas').count(), 0, 'Reset cancels and removes the animation');
        for (const id of level.solution[0].nodes) await activate(page.locator(`#zx-board [data-node="${id}"]`));
        await activate(page.locator(`[data-rule="${level.solution[0].rule}"]`));
        await activate(page.locator('#mode-random'));
        assert.equal(await page.locator('#zx-board canvas').count(), 0, 'Changing mode cancels an unfinished rewrite');
        assert.equal(await page.locator('#sequence [data-step]').count(), 0);
        await activate(page.locator('#mode-campaign'));
        await assertDiagram(page, level.diagram);
      }
      const measured = await solve(page, activate, level.diagram, level.solution, index === 1);
      if (index === 1) phaseFusionAnimation = measured;
      if (index === 0) {
        await page.locator('#player-name').fill('ZX tester'); await activate(page.locator('#submit-score'));
        await page.getByText('Score saved.', { exact: true }).waitFor();
        assert.match(await page.locator('#result-leaderboard-total').textContent(), /1 player has/);
        await activate(page.locator('#close-win')); await activate(page.locator('#restart'));
        const expanded = [
          { rule: 'insert', edge: [1, 3], kind: 'z' }, { rule: 'identity', nodes: [6] },
          { rule: 'split', nodes: [4], phase: 1 }, { rule: 'fusion', nodes: [4, 6] }, ...level.solution,
        ];
        const submission = page.waitForRequest(request => request.method() === 'POST' &&
          new URL(request.url()).pathname === '/api/leaderboard');
        await solve(page, activate, level.diagram, expanded);
        assert.deepEqual((await submission).postDataJSON().sequence, expanded, 'Ranked replays retain the inverse moves');
        await page.getByText('Score saved.', { exact: true }).waitFor();
      }
      await activate(page.locator('#close-win'));
    }
    // The same replay snapshots are used by the UI and the on-demand worker.
    await page.locator('#advanced-features').evaluate(node => { node.open = true; });
    await activate(page.locator('#replay'));
    await page.locator('#zx-board canvas').waitFor();
    assert.equal(await page.locator('#share-replay').isVisible(), true, 'Replay keeps completed-round actions in place');
    await page.waitForFunction(length => document.getElementById('review-note').textContent === `Rewrite ${length} / ${length}`,
      LEVELS.at(-1).solution.length);
    await activate(page.locator('#resume-round'));
    await activate(page.locator('#share-replay'));
    await page.locator('#share-preview:not([hidden])').waitFor();
    const image = await page.locator('#share-preview').evaluate(node => ({ width: node.naturalWidth, height: node.naturalHeight }));
    assert.deepEqual(image, { width: 960, height: 480 });
    const download = page.waitForEvent('download'); await activate(page.locator('#download-gif'));
    const replay = await download; assert.match(replay.suggestedFilename(), /^zx-calculus-8\.gif$/);
    const gifPath = resolve(output, `${label}-replay.gif`); await replay.saveAs(gifPath);
    const gif = await readFile(gifPath); assert.equal(gif.toString('ascii', 0, 6), 'GIF89a');
    assert.ok(gif.length < 1_000_000, 'Replay stays compact');
    await activate(page.locator('#close-share'));
    await activate(page.locator('#mode-random'));
    let opposite = applyMove(targetDiagram(), { rule: 'insert', edge: [0, 2], kind: 'z' });
    opposite = applyMove(opposite, { rule: 'insert', edge: [1, 3], kind: 'x' });
    await importDiagram(page, activate, opposite);
    await solve(page, activate, opposite, [
      { rule: 'insert', edge: [0, 4], kind: 'x' }, { rule: 'identity', nodes: [6] },
      { rule: 'split', nodes: [4], phase: 1 }, { rule: 'fusion', nodes: [4, 6] },
      { rule: 'insert-hh', edge: [0, 4] }, { rule: 'hh', nodes: [6, 7] },
      { rule: 'color', nodes: [4] }, { rule: 'color', nodes: [4] },
      { rule: 'hh', nodes: [6, 8] }, { rule: 'hh', nodes: [7, 9] },
      { rule: 'add-hopf', nodes: [4, 5] }, { rule: 'hopf', nodes: [4, 5] },
      { rule: 'identity', nodes: [4] }, { rule: 'identity', nodes: [5] },
    ]);
    await activate(page.locator('#close-win'));
    await activate(page.locator('#new-diagram'));
    await assertDiagram(page, targetDiagram());
    assert.equal(await page.locator('#zx-generator').isVisible(), false, 'Building hides the random generator');
    assert.equal(await page.locator('#play-diagram').isVisible(), true);
    assert.equal(await page.locator('#zx-rules button').count(), 5);
    assert.equal(await page.locator('#zx-board [data-edge="0"]').getAttribute('aria-pressed'), 'true');
    await page.locator('#zx-board').scrollIntoViewIfNeeded();
    const wirePoint = await page.locator('#zx-board [data-edge-hit="0"]').evaluate(path => {
      const point = path.getPointAtLength(path.getTotalLength() * .2).matrixTransform(path.getScreenCTM());
      return { x: point.x, y: point.y };
    });
    const tapWire = () => mobile ? page.touchscreen.tap(wirePoint.x, wirePoint.y) : page.mouse.click(wirePoint.x, wirePoint.y);
    await tapWire();
    assert.equal(await page.locator('#zx-board [data-edge="0"]').getAttribute('aria-pressed'), 'false', 'The wire itself toggles selection off');
    await tapWire();
    assert.equal(await page.locator('#zx-board [data-edge="0"]').getAttribute('aria-pressed'), 'true', 'The wire itself toggles selection on');
    assert.deepEqual(await page.locator('#zx-rules button:not([disabled])').evaluateAll(nodes => nodes.map(node => node.dataset.rule)), ['identity', 'hh'],
      'A new puzzle starts ready to insert a spider or Hadamards');
    await page.screenshot({ path: resolve(output, `${label}-workshop.png`), fullPage: true });
    await activate(page.locator('#zx-rules [data-rule="identity"]'));
    assert.equal(await page.locator('#zx-rule-options[open] [data-option]').count(), 2);
    await page.keyboard.press('Escape'); await assertDiagram(page, targetDiagram());
    assert.equal(await page.locator('#zx-rule-options').evaluate(node => node.open), false);
    assert.equal(await page.locator('#zx-rules [data-rule="identity"]').evaluate(node => node === document.activeElement), true,
      'Cancelling returns focus to the invoking equation');
    await activate(page.locator('#zx-rules [data-rule="identity"]'));
    await activate(page.locator('#zx-rule-options [data-option="0"]'));
    await page.locator('#zx-board [data-node="4"]').waitFor();
    await activate(page.locator('#zx-board [data-node="4"]'));
    await activate(page.locator('#zx-rules [data-rule="fusion"]'));
    assert.equal(await page.locator('#zx-rule-options[open] [data-option]').count(), 4);
    await audit(page);
    await page.screenshot({ path: resolve(output, `${label}-split-choices.png`), fullPage: true });
    await activate(page.locator('#zx-rule-options [data-option="1"]'));
    await page.locator('#zx-board [data-node="5"]').waitFor();
    await openAdvanced(page, activate);
    await activate(page.locator('#share-json'));
    const shared = JSON.parse(await page.locator('#puzzle-json-text').inputValue());
    assert.deepEqual(Object.keys(shared).sort(), ['edges', 'nodes']);
    await activate(page.locator('#puzzle-json-close'));
    await activate(page.locator('#play-diagram'));
    await activate(page.locator('#zx-board [data-node="4"]')); await activate(page.locator('#zx-board [data-node="5"]'));
    await activate(page.locator('[data-rule="fusion"]'));
    await page.waitForFunction(() => document.querySelectorAll('#sequence [data-step]').length === 1);
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => document.querySelectorAll('#sequence [data-step]').length === 0);
    await importDiagram(page, activate, LEVELS[0].diagram);
    await solve(page, activate, LEVELS[0].diagram, LEVELS[0].solution);
    await activate(page.locator('#close-win'));
    // Invalid custom input is rejected without replacing the current diagram.
    await activate(page.locator('#input-json')); await page.locator('#puzzle-json-text').fill('{"nodes":[],"edges":[]}');
    await activate(page.locator('#puzzle-json-apply'));
    assert.ok(await page.locator('#puzzle-json-status').textContent());
    await activate(page.locator('#puzzle-json-close'));
    await activate(page.locator('#mode-daily'));
    await page.locator('#daily-heading:not([hidden])').waitFor();
    const daily = dailyPuzzle(date); await assertDiagram(page, daily.diagram);
    await audit(page);
    await page.screenshot({ path: resolve(output, `${label}-daily.png`), fullPage: true });
    const animation = await solve(page, activate, daily.diagram, daily.solution, true);
    await page.getByText('Score saved.', { exact: true }).waitFor();
    assert.equal(await page.locator('#daily-result-actions #replay-result').isVisible(), true);
    assert.equal(await page.locator('#daily-games a').count(), 5);
    await activate(page.locator('#check-daily-puzzles'));
    await page.goto(`${base}/games/daily/`); await audit(page);
    assert.equal(await page.locator('#daily-games a').count(), 5);
    reports.push({ viewport: label, levels: LEVELS.length, tutorial: true, daily: true, editor: true, inverseRules: true,
      rankedInverseReplay: true, json: true, replay: true, animation, phaseFusionAnimation, gifBytes: gif.length, accessibility: true });
    await context.close();
  }
  const reduced = await browser.newContext({ reducedMotion: 'reduce' });
  await createBrowserApi({ now: Date.parse(`${date}T10:00:00Z`) }).install(reduced);
  const page = await reduced.newPage();
  page.on('pageerror', error => errors.push(`reduced motion: ${error.message}`));
  await page.goto(`${base}/games/zx-calculus/`);
  await page.locator('#tutorial-start:not([disabled])').waitFor();
  await page.locator('#mode-campaign').click();
  await solve(page, node => node.click(), LEVELS[0].diagram, LEVELS[0].solution);
  assert.equal(await page.locator('#zx-board canvas').count(), 0, 'Reduced motion preserves gameplay without an animation canvas');
  await reduced.close();
  assert.deepEqual(errors, []); await writeFile(resolve(output, 'report.json'), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports, null, 2));
} finally { await browser.close(); }
