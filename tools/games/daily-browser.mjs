// Daily-game navigation checks. Every API request uses the real
// game validators with an in-memory fixture; no production records are written.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBrowserApi } from '../circuit-reduction/browser-api.mjs';
import { dailyPuzzle as reductionDaily } from '../circuit-reduction/witnesses.js';
import { layoutMoves } from '../circuit-reduction/layout-moves.js';
import { RULES, applyMove as reduceMove } from '../../src/lib/circuit-reduction/engine.js';
import { dailyPuzzle as golfDaily } from '../../src/lib/quantum-golf/daily.js';
import { solveShortest } from '../../src/lib/quantum-golf/solver.js';
import { dailyPuzzle as signalsDaily } from '../../src/lib/quantum-signals/puzzles.js';
import { solvePuzzle } from '../../src/lib/quantum-signals/engine.js';
import { dailyPuzzle as graphDaily } from '../../src/lib/graph-states/puzzles.js';
import { applyMove as graphMove, isSolved as graphSolved, solutionForGraph } from '../../src/lib/graph-states/engine.js';

const require = createRequire(resolve(process.env.PLAYWRIGHT_MODULE_DIR ?? 'tmp/quality-tools/node_modules', 'package.json'));
const { chromium } = require('playwright');
const quality = createRequire(resolve(process.env.QUALITY_MODULE_DIR ?? 'tmp/quality-tools/node_modules', 'package.json'));
const axe = await readFile(quality.resolve('axe-core/axe.min.js'), 'utf8');
const base = process.env.GAME_BASE_URL ?? 'http://127.0.0.1:4323';
const now = '2026-10-17T10:00:00Z', date = '2026-10-17';
const games = ['circuit-reduction', 'quantum-golf', 'quantum-signals', 'graph-states'];
const titles = ['Circuit simplification', 'Quantum golf', 'Quantum signals', 'Graph states'];
const output = resolve('tmp/daily-games-browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {}) });
const errors = [];

async function accessibility(surface, label) {
  await surface.evaluate(axe);
  const report = await surface.evaluate(() => window.axe.run(document, {
    iframes: false,
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] },
  }));
  assert.deepEqual(report.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(node => ({
    target: node.target, issues: [...node.any, ...node.all].map(({ message, data }) => ({ message, data })),
  })) })), [], label);
}

async function boardCircuit(frame) {
  return frame.locator('[data-cell]').evaluateAll(cells => {
    const circuit = [];
    for (const cell of cells) {
      const [row, column] = cell.dataset.cell.split(':').map(Number);
      (circuit[row] ??= [])[column] = cell.dataset.gate;
    }
    return circuit;
  });
}

async function reductionMove(frame, activate, move) {
  if (move.rule === 'arrange' || move.rule === 'insert-space') {
    const target = move.rule === 'arrange' ? move.circuit : reduceMove(await boardCircuit(frame), move);
    for (const spacing of layoutMoves(await boardCircuit(frame), target)) await reductionMove(frame, activate, spacing);
    assert.deepEqual(await boardCircuit(frame), target);
  } else if (move.rule === 'compact-identities') await activate(frame.locator('#compact-identities'));
  else if (move.rule === 'insert-column') {
    for (let index = 0; index < (move.count ?? 1); index++) await activate(frame.locator(`[data-space="0:${move.column}"]`));
  } else if (move.rule === 'remove-space' || move.rule === 'remove-column') {
    // The public keyboard action avoids a long touch hold for every free gap.
    await frame.locator(`[data-cell="${move.row}:${move.column}"]`).press('Delete');
  } else {
    const rule = RULES.find(rule => rule.id === move.rule);
    assert.ok(rule);
    for (let row = 0; row < rule.left.length; row++) for (let column = 0; column < rule.left[0].length; column++) {
      await activate(frame.locator(`[data-cell="${move.row + row}:${move.column + column}"]`));
    }
    await activate(frame.locator(`[data-rule="${move.rule}"]`));
  }
}

async function solve(frame, game, activate) {
  if (game === 'circuit-reduction') {
    const puzzle = reductionDaily(date);
    assert.deepEqual(await boardCircuit(frame), puzzle.circuit);
    for (const move of puzzle.solution) await reductionMove(frame, activate, move);
  } else if (game === 'quantum-golf') {
    const puzzle = golfDaily(date), solution = solveShortest(puzzle.target, puzzle.epsilon, { maxDepth: 12, maxNodes: 5000 });
    assert.equal(solution.status, 'optimal');
    for (const [index, gate] of [...solution.sequence].entries()) {
      await activate(frame.locator('#gate-' + gate.toLowerCase()));
      await frame.waitForFunction(length => document.querySelectorAll('#sequence button').length === length, index + 1);
    }
  } else if (game === 'quantum-signals') {
    const solution = solvePuzzle(signalsDaily(date), { limit: 1 })[0];
    for (const [hole, gate] of Object.entries(solution)) {
      if (gate === 'I') continue;
      await activate(frame.locator(`[data-hole="${hole}"]`));
      await activate(frame.locator(`[data-choice="${gate}"]`));
    }
  } else {
    let graph = graphDaily(date);
    const vertices = solutionForGraph(graph).flatMap(move => Object.hasOwn(move, 'vertex') ? [move.vertex] : [move.edge[0], move.edge[1], move.edge[0]]);
    for (const vertex of vertices) {
      await activate(frame.locator(`#graph-board [data-vertex="${vertex}"]`));
      graph = graphMove(graph, { vertex });
      await frame.waitForFunction(() => !document.querySelector('[data-graph-animating]'));
      const edges = await frame.locator('#graph-board [data-edge]').evaluateAll(nodes => nodes.map(node => node.dataset.edge.split(':').map(Number)));
      assert.deepEqual(edges, graph.edges);
      if (graphSolved(graph)) break;
    }
    assert.ok(graphSolved(graph));
  }
  await frame.locator('#win-dialog[open]').waitFor();
}

async function cards(page, current) {
  const links = page.locator('#daily-games a');
  assert.deepEqual(await links.evaluateAll(nodes => nodes.map(node => node.getAttribute('href'))),
    games.map(game => `/games/${game}/?daily=1`));
  assert.deepEqual(await links.evaluateAll(nodes => nodes.map(node => node.textContent.trim())), titles);
  assert.equal(await links.locator('img').count(), 4, 'Every game has its gameplay illustration');
  assert.equal(await page.locator('#daily-games [aria-current="page"]').count(), current === undefined ? 0 : 1);
  if (current !== undefined) assert.equal(await links.nth(current).getAttribute('aria-current'), 'page');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'The daily navigation fits the viewport');
}

async function dialogFits(page, id) {
  await page.waitForFunction(id => {
    const dialog = document.getElementById(id), box = dialog.getBoundingClientRect();
    return dialog.open && Number(getComputedStyle(dialog).opacity) === 1 && box.width > 0 &&
      box.left >= -1 && box.right <= innerWidth + 1 && box.top >= -1 && box.bottom <= innerHeight + 1;
  }, id);
}

async function shareReplay(page, activate, profile) {
  const workers = [], trackWorker = worker => workers.push(worker);
  page.on('worker', trackWorker);
  try {
    await activate(page.locator('#share-result'));
    await page.locator('#share-preview').waitFor({ state: 'visible' });
    await page.locator('#share-preview').evaluate(image => image.decode());
    assert.equal(workers.length, 1, 'Opening Share renders the still image without encoding a GIF');
    assert.equal(await page.locator('#download-gif').isEnabled(), true);
    await dialogFits(page, 'share-dialog');
    const preview = await page.locator('#share-preview').getAttribute('src');
    const pending = page.waitForEvent('download', { timeout: 120_000 });
    await activate(page.locator('#download-gif'));
    const download = await pending, bytes = await readFile(await download.path());
    assert.match(download.suggestedFilename(), /\.gif$/);
    assert.match(bytes.toString('ascii', 0, 6), /^GIF8[79]a$/);
    assert.ok(bytes.length > 1000);
    assert.equal(workers.length, 2, 'Only Download starts the GIF encoder');
    assert.equal(await page.locator('#share-preview').getAttribute('src'), preview);
    await page.screenshot({ path: resolve(output, `${profile}-share.png`), fullPage: true });
    await activate(page.locator('#close-share'));
    assert.equal(await page.locator('#win-dialog').evaluate(dialog => dialog.open), true);
    assert.equal(await page.locator('#check-daily-puzzles').isEnabled(), true, 'Closing Share preserves the completion and daily navigation');
  } finally { page.off('worker', trackWorker); }
}

try {
  for (const [profile, options] of [['desktop', { viewport: { width: 1440, height: 1050 } }],
    ['mobile', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }]]) {
    const context = await browser.newContext({ ...options, reducedMotion: 'reduce', timezoneId: 'Europe/Paris' });
    const fixture = createBrowserApi({ now: Date.parse(now) });
    await fixture.install(context);
    const submissions = [];
    context.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/leaderboard') submissions.push(request.postDataJSON());
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${profile}: ${error.message}`));
    const activate = locator => options.hasTouch ? locator.tap() : locator.click();
    await page.goto(base + '/games/', { waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('#all-daily-puzzles').getAttribute('href'), '/games/daily/');
    await activate(page.locator('#all-daily-puzzles'));
    assert.match(await page.locator('main').innerText(), /Try each game’s tutorial and levels before starting here\./);
    await cards(page);
    assert.equal(await page.locator('iframe').count(), 0, 'Daily puzzles use normal page navigation');
    await accessibility(page, 'The daily-puzzles menu has no automated accessibility violations');
    await page.screenshot({ path: resolve(output, `${profile}-intro.png`), fullPage: true });
    await activate(page.locator('#daily-games a').first());
    for (const [index, game] of games.entries()) {
      await page.waitForURL(url => url.pathname === `/games/${game}/` && url.searchParams.get('daily') === '1');
      await page.locator('#mode-daily[aria-pressed="true"]').waitFor({ state: 'attached' });
      await page.locator('#daily-heading:not([hidden])').waitFor();
      await page.waitForFunction(() => document.getElementById('daily-status').textContent !== 'Loading…');
      await cards(page, index);
      assert.equal(await page.locator('.mode-menu').isVisible(), true);
      assert.equal(await page.locator('iframe').count(), 0);
      await page.screenshot({ path: resolve(output, `${profile}-${game}.png`), fullPage: true });
      await accessibility(page, `${profile}: accessible daily ${game}`);
      if (!index) {
        await activate(page.locator('#show-rules'));
        await page.locator('#rules-dialog[open]').waitFor();
        await dialogFits(page, 'rules-dialog');
        await activate(page.locator('#close-rules'));
      }
      await solve(page, game, activate);
      if (profile === 'mobile') {
        await page.waitForFunction(() => document.getElementById('score-status').textContent !== 'Saving…');
        if (await page.locator('#score-form').isVisible()) {
          await page.locator('#player-name').fill('Daily games mobile');
          await activate(page.locator('#submit-score'));
        }
        await page.waitForFunction(() => /saved|completed/i.test(document.getElementById('score-status').textContent));
      }
      assert.equal(await page.locator('#check-daily-puzzles').isEnabled(), true, 'Other daily puzzles never require score registration');
      if (game === 'quantum-signals') {
        const target = await page.locator('#signal-target').evaluate(region => {
          const dots = [...region.querySelectorAll('.signal-flow-target')];
          const box = region.getBoundingClientRect(), panel = document.getElementById('flow-panel').getBoundingClientRect();
          return { outsideScroll: !document.getElementById('flow-scroll').contains(region), width: box.width,
            count: dots.length, inView: box.left >= panel.left && box.right <= panel.right && dots.every(dot => {
              const bounds = dot.getBoundingClientRect(); return bounds.left >= box.left && bounds.right <= box.right;
            }) };
        });
        assert.ok(target.outsideScroll, 'Signals targets stay outside the horizontal scroller');
        assert.ok(Math.abs(target.width - 52) <= 1, 'The fixed target stays compact');
        assert.ok(target.count > 0 && target.inView, 'The completed Signals target dots remain horizontally visible');
      }
      if (!index) await shareReplay(page, activate, profile);
      await dialogFits(page, 'win-dialog');
      await page.screenshot({ path: resolve(output, `${profile}-${game}-completed.png`), fullPage: true });
      await activate(page.locator('#check-daily-puzzles'));
      assert.equal(await page.locator('#win-dialog').evaluate(dialog => dialog.open), false);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'daily-games', 'Completion focuses the game chooser');
      const navigation = await page.locator('#daily-games').boundingBox();
      assert.ok(navigation.y >= -1 && navigation.y + navigation.height <= options.viewport.height + 1, 'The game chooser is fully visible');
      await cards(page, index);
      await page.screenshot({ path: resolve(output, `${profile}-${game}-chooser.png`), fullPage: true });
      if (index < games.length - 1) await activate(page.locator('#daily-games a').nth(index + 1));
      console.log(`${profile}: ${titles[index]} daily completed; logo navigation and popup verified.`);
    }
    assert.equal(submissions.length, profile === 'mobile' ? 4 : 0, 'Registration is optional; a saved nickname works across games');
    for (const game of games) {
      await page.goto(`${base}/games/${game}/`, { waitUntil: 'domcontentloaded' });
      await page.locator('#tutorial-panel').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#mode-tutorial').getAttribute('aria-pressed'), 'true', 'Games still open their tutorial without a daily link');
      assert.equal(await page.locator('#daily-games').isVisible(), false);
      for (const mode of ['campaign', 'random']) {
        await activate(page.locator('#mode-' + mode));
        assert.equal(await page.locator('#daily-games').isVisible(), false, 'The logo chooser is exclusive to Daily mode');
        assert.equal(await page.locator('#check-daily-puzzles').evaluate(button => button.hidden), true);
      }
    }
    await context.close();
    console.log(`${profile}: all four daily games, optional scores, responsive logo navigation, accessibility and other modes verified.`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
