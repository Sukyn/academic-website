// Run with an Astro preview. Default scoring uses a validated transport fixture;
// GAME_API_URL opts into the local PostgreSQL API harness instead.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LEVELS, dailyPuzzle } from './witnesses.js';
import { RULES, sequenceCost, solveShortest, applyMove } from '../../src/lib/circuit-reduction/engine.js';
import { createBrowserApi } from './browser-api.mjs';

const require = createRequire(process.env.PLAYWRIGHT_MODULE_DIR ? resolve(process.env.PLAYWRIGHT_MODULE_DIR, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const base = process.env.GAME_BASE_URL ?? 'http://127.0.0.1:4321';
const api = process.env.GAME_API_URL;
const fixture = createBrowserApi();
const scoreTransport = api ? 'real API' : 'validated fixture (no database)';
const output = resolve('tmp/circuit-reduction-browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {}) });
const errors = [];
const touchPages = new WeakSet();
const touchSessions = new WeakMap();
const activate = (page, locator) => touchPages.has(page) ? locator.tap() : locator.click();

async function pageFor(options) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  if (options.hasTouch) touchPages.add(page);
  page.on('pageerror', error => errors.push(error.message));
  if (process.env.GAME_TEST_TIME) await page.clock.setFixedTime(new Date(process.env.GAME_TEST_TIME));
  if (api) await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const response = await context.request.fetch(`${api}${url.pathname}${url.search}`, {
      method: request.method(), headers: { ...request.headers(), origin: api },
      ...(request.postDataBuffer() ? { data: request.postDataBuffer() } : {}),
    });
    await route.fulfill({ response });
  });
  else await fixture.install(page);
  await page.goto(`${base}/games/circuit-reduction/`);
  await page.locator('.circuit-cell').first().waitFor();
  return page;
}
async function openDetails(page, selector) {
  if (!await page.locator(selector).evaluate(element => element.open)) await activate(page, page.locator(`${selector} > summary`));
}
async function downloadReplay(page) {
  const workers = [];
  const trackWorker = worker => workers.push(worker);
  page.on('worker', trackWorker);
  try {
    await activate(page, page.locator('#share-score'));
    const button = page.getByRole('button', { name: 'Download the replay', exact: true });
    await button.waitFor();
    assert.equal(workers.length, 0, 'Sharing does not start a GIF worker');
    assert.equal(await page.locator('#share-preview').isVisible(), false);
    assert.equal(await page.locator('#copy-gif').isDisabled(), true);
    const pending = page.waitForEvent('download');
    await activate(page, button);
    const download = await pending;
    assert.match(download.suggestedFilename(), /\.gif$/);
    const bytes = await readFile(await download.path());
    assert.match(bytes.toString('ascii', 0, 6), /^GIF8[79]a$/);
    assert.ok(bytes.length > 1000);
    assert.equal(workers.length, 1, 'Download starts exactly one encoder');
    await page.locator('#share-preview').evaluate(image => image.decode());
    const repeated = page.waitForEvent('download');
    await activate(page, button);
    const second = await repeated;
    assert.deepEqual(await readFile(await second.path()), bytes);
    assert.equal(workers.length, 1, 'Repeated download reuses the GIF');
    await activate(page, page.locator('#close-share'));
  } finally {
    page.off('worker', trackWorker);
  }
}
async function boardCircuit(page) {
  return page.locator('[data-cell]').evaluateAll(cells => {
    const circuit = [];
    for (const cell of cells) {
      const [row, column] = cell.dataset.cell.split(':').map(Number);
      (circuit[row] ??= [])[column] = cell.dataset.gate;
    }
    return circuit;
  });
}
async function addSpace(page, wire, column, count) {
  for (let index = 0; index < count; index++) {
    const gap = page.locator(`[data-space="${wire === 'all' ? 0 : wire}:${column}"]`);
    if (wire === 'all' && !touchPages.has(page)) {
      await page.keyboard.down('Shift');
      try { await activate(page, gap); } finally { await page.keyboard.up('Shift'); }
    } else await activate(page, gap);
  }
}
async function removeSpace(page, row, column) {
  const cell = page.locator(`[data-cell="${row}:${column}"]`);
  if (!touchPages.has(page)) return cell.click({ button: 'right' });
  // A real touch hold exercises pointer cancellation and the browser's
  // compatibility-click behavior, as a finger does on the board.
  await cell.scrollIntoViewIfNeeded();
  const bounds = await cell.boundingBox(); assert.ok(bounds);
  let session = touchSessions.get(page);
  if (!session) { session = await page.context().newCDPSession(page); touchSessions.set(page, session); }
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }] });
  await page.waitForTimeout(500);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function arrange(page, target) {
  await activate(page, page.locator('#compact-identities'));
  const seen = target.map(() => 0);
  for (let column = 0; column < target[0].length; column++) for (let row = 0; row < target.length; row++) {
    const symbol = target[row][column];
    if (symbol === '.') continue;
    const current = (await boardCircuit(page))[row].flatMap((cell, index) => cell === '.' ? [] : [{ cell, index }])[seen[row]++];
    assert.equal(current.cell, symbol, 'Free arrangements retain gate order');
    if (symbol.endsWith('D')) continue;
    assert.ok(current.index <= column, 'The layout can be recreated by adding identity space');
    if (current.index < column) await addSpace(page, row, current.index, column - current.index);
  }
  while ((await boardCircuit(page))[0].length > target[0].length) {
    const circuit = await boardCircuit(page), column = circuit[0].length - 1;
    assert.ok(circuit.every(row => row[column] === '.'));
    await removeSpace(page, 0, column);
  }
  const currentWidth = (await boardCircuit(page))[0].length;
  if (currentWidth < target[0].length) await addSpace(page, 'all', currentWidth, target[0].length - currentWidth);
  assert.deepEqual(await boardCircuit(page), target, 'Public wire-space controls reproduce the witness layout');
}
async function apply(page, move) {
  if (move.rule === 'arrange') {
    await arrange(page, move.circuit);
  } else if (move.rule === 'compact-identities') {
    await activate(page, page.locator('#compact-identities'));
  } else if (move.rule === 'insert-space') {
    await addSpace(page, move.row, move.column, move.count ?? 1);
  } else if (move.rule === 'remove-space') {
    await removeSpace(page, move.row, move.column);
  } else if (move.rule === 'insert-column') {
    await addSpace(page, 'all', move.column, move.count ?? 1);
  } else if (move.rule.endsWith('column')) {
    await removeSpace(page, 0, move.column);
  } else {
    const rule = RULES.find(rule => rule.id === move.rule);
    assert.ok(rule, `Known playable rule ${move.rule}`);
    assert.equal(await page.locator(`[data-rule="${move.rule}"]`).evaluate(button => button.hidden), false, 'A witness uses only rules unlocked by the current lesson');
    for (let y = 0; y < rule.left.length; y++) for (let x = 0; x < rule.left[0].length; x++) await activate(page, page.locator(`[data-cell="${move.row + y}:${move.column + x}"]`));
    await activate(page, page.locator(`[data-rule="${move.rule}"]`));
  }
}
async function finish(page, sequence, { optimalMoves = sequenceCost(sequence), parMoves = null } = {}) {
  for (const move of sequence) await apply(page, move);
  await page.locator('#win-dialog[open]').waitFor();
  const moves = sequenceCost(sequence);
  assert.match(await page.locator('#move-count').innerText(), new RegExp(`^${moves} moves?$`));
  if (optimalMoves !== null) assert.match(await page.locator('#win-summary').innerText(), /Optimal solution/);
  else {
    assert.doesNotMatch(await page.locator('#win-summary').innerText(), /Optimal/);
    const benchmark = page.locator('#leaderboard-body .benchmark');
    assert.match(await benchmark.innerText(), new RegExp(`Best known\\s+${parMoves}`), 'Uncertified missions advertise a known solution honestly');
  }
}
async function noOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'No horizontal page overflow');
}
async function fullRulePalette(page) {
  const rules = page.locator('[data-rule]:visible');
  assert.equal(await rules.count(), RULES.length, 'Every rule is visible without a disclosure');
  assert.deepEqual(await rules.evaluateAll(buttons => buttons.filter(button => {
    const bounds = button.getBoundingClientRect();
    return Array.from(button.querySelectorAll('.rule-preview, .rule-mini, .rule-mini > svg')).some(diagram => {
      const rect = diagram.getBoundingClientRect();
      return rect.left < bounds.left - 1 || rect.right > bounds.right + 1;
    });
  }).map(button => button.dataset.rule)), [], 'Rule diagrams fit inside their buttons');
}
try {
  let desktop, beforeRemoval;
  if (process.env.GAME_TEST_SCOPE !== 'mobile') {
    desktop = await pageFor({ viewport: { width: 1440, height: 1050 } });
    await noOverflow(desktop);
    await desktop.screenshot({ path: resolve(output, 'desktop.png'), fullPage: true });
    assert.equal(await desktop.locator('#space-wire, #space-position, #space-count, #add-space, #insert-column, #remove-column').count(), 0, 'Spacing is edited directly on the circuit');
    await addSpace(desktop, 0, 1, 1);
    beforeRemoval = await boardCircuit(desktop);
    await removeSpace(desktop, 0, 1);
    assert.deepEqual(await boardCircuit(desktop), applyMove(beforeRemoval, { rule: 'remove-space', row: 0, column: 1 }));
    assert.equal(await desktop.locator('#move-count').innerText(), '0 moves');
    const gateBoard = await boardCircuit(desktop);
    const gateColumn = gateBoard[0].indexOf('X'); await removeSpace(desktop, 0, gateColumn);
    assert.deepEqual(await boardCircuit(desktop), gateBoard, 'Right-clicking a gate preserves it');
    await desktop.locator('#restart').click();
    await desktop.locator('#show-rules').click();
    assert.ok(await desktop.locator('#rules-dialog').evaluate(dialog => dialog.open));
    await desktop.locator('#close-rules').click();
    for (const level of LEVELS) {
      await desktop.locator('#level').selectOption(String(level.id));
      const available = await desktop.locator('[data-rule]').evaluateAll(buttons => buttons.filter(button => !button.hidden).map(button => button.dataset.rule));
      assert.deepEqual(available.sort(), [...level.allowedRules].sort(), `Progressive rule palette in lesson ${level.id}`);
      if (level.id <= 2) {
        assert.equal(available.length, level.id, 'The first lessons each introduce one cancellation');
        assert.equal(await desktop.locator('#paper-rules').count(), 0);
      }
      if (level.id === LEVELS.at(-1).id) await desktop.screenshot({ path: resolve(output, 'desktop-advanced.png'), fullPage: true });
      await finish(desktop, level.solution, level);
      if (level.id === 1) {
        await desktop.locator('#player-name').fill('Desktop test');
        await desktop.locator('#score-form button').click();
        await desktop.getByText('Score saved.', { exact: true }).waitFor();
        assert.match(await desktop.locator('#player-rank').innerText(), /Your rank:/);
      }
      await desktop.locator('#close-win').click();
      if (level.id === 1) {
        await openDetails(desktop, '#advanced-features');
        await desktop.locator('#replay').click();
        await desktop.locator('#review-note').filter({ hasText: 'Step 1 / 1' }).waitFor();
        await desktop.locator('#resume-round').click();
        await downloadReplay(desktop);
        console.log('Circuit replay: lazy encoding, GIF download and cached repeat verified');
        await desktop.locator('#undo').click(); assert.match(await desktop.locator('#move-count').innerText(), /^0 moves$/);
        await desktop.locator('#restart').click();
        // Hundreds of slots are a free layout choice even after a circuit is solved.
        await addSpace(desktop, 0, 1, 100);
        assert.equal((await boardCircuit(desktop))[0].length, 104);
        assert.equal(await desktop.locator('#move-count').innerText(), '0 moves');
        await activate(desktop, desktop.locator('#compact-identities'));
        assert.deepEqual(await boardCircuit(desktop), [['X', 'X']]);
        await finish(desktop, [{ rule: 'cancel-x', row: 0, column: 0 }]);
        await desktop.locator('#close-win').click();
        await addSpace(desktop, 'all', 0, 100);
        assert.equal((await boardCircuit(desktop))[0].length, 102);
        await activate(desktop, desktop.locator('#compact-identities'));
        assert.deepEqual(await boardCircuit(desktop), [['.', '.']]);
        assert.equal(await desktop.locator('#move-count').innerText(), '1 move');
        await noOverflow(desktop);
        await desktop.locator('#restart').click();
      }
    }
    console.log(`Desktop: all ${LEVELS.length} campaign levels completed with progressive rules; final two Best known benchmarks, free 100-slot spacing, compaction, replay/undo/reset/share verified`);
    await desktop.locator('#mode-random').click();
    await fullRulePalette(desktop);
    await desktop.locator('#custom-controls details > summary').click();
    await desktop.locator('#custom-circuit').fill('H .'); await desktop.locator('#custom-form button').click();
    assert.match(await desktop.locator('#custom-status').innerText(), /not the identity/);
    await desktop.locator('#custom-circuit').fill('H Z H X'); await desktop.locator('#custom-form button').click();
    await desktop.locator('#custom-status').filter({ hasText: 'Shortest solution: 2 moves.' }).waitFor();
    const custom = solveShortest([['H', 'Z', 'H', 'X']]);
    assert.equal(custom.status, 'optimal'); assert.equal(custom.optimalMoves, 2);
    await finish(desktop, custom.solution, custom);
    assert.ok(await desktop.locator('#score-form').evaluate(form => form.hidden), 'Custom scores are not submitted');
    await desktop.locator('#close-win').click();
    await desktop.locator('#mode-daily').click();
    await desktop.locator('#daily-heading:not([hidden])').waitFor();
    await fullRulePalette(desktop);
    assert.ok(await desktop.locator('.circuit-cell').count() >= 30);
    await desktop.screenshot({ path: resolve(output, 'desktop-daily.png'), fullPage: true });
    {
      const data = api ? await (await desktop.request.get(`${api}/api/daily?game=circuit-reduction`)).json() : fixture.getDaily('circuit-reduction');
      const puzzle = dailyPuzzle(data.date);
      assert.ok(puzzle.optimalMoves >= 10 && puzzle.optimalMoves <= 14);
      await finish(desktop, puzzle.solution, puzzle);
      await desktop.locator('#player-name').fill('Daily test'); await desktop.locator('#score-form button').click();
      await desktop.getByText('Score saved.', { exact: true }).waitFor();
      await desktop.locator('#close-win').click();
      const replaySteps = await desktop.locator('#sequence [data-step]').count();
      await openDetails(desktop, '#advanced-features');
      await desktop.locator('#replay').click();
      await desktop.locator('#review-note').filter({ hasText: `Step ${replaySteps} / ${replaySteps}` }).waitFor({ timeout: Math.max(20000, replaySteps * 800) });
      await desktop.locator('#resume-round').click();
      console.log(`Daily: certified ${puzzle.optimalMoves}-move puzzle solved and score accepted through ${scoreTransport}`);
    }
    await desktop.screenshot({ path: resolve(output, 'desktop-daily-completed.png'), fullPage: true });
  }

  const mobile = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await noOverflow(mobile);
  const cellSize = await mobile.locator('.circuit-cell').first().boundingBox();
  assert.ok(cellSize.width >= 44 && cellSize.height >= 44, 'Touchable cells are at least44px');
  await mobile.screenshot({ path: resolve(output, 'mobile.png'), fullPage: true });
  await addSpace(mobile, 0, 1, 1);
  beforeRemoval = await boardCircuit(mobile);
  await removeSpace(mobile, 0, 1);
  assert.deepEqual(await boardCircuit(mobile), applyMove(beforeRemoval, { rule: 'remove-space', row: 0, column: 1 }), 'Holding an identity removes it through touch input');
  assert.equal(await mobile.locator('[data-cell][aria-pressed="true"]').count(), 0, 'Touch removal does not also select a rule window');
  assert.equal(await mobile.locator('#move-count').innerText(), '0 moves');
  await mobile.locator('#restart').click();
  await finish(mobile, LEVELS[0].solution); await mobile.locator('#close-win').click();
  await openDetails(mobile, '#advanced-features');
  await downloadReplay(mobile);
  for (const lesson of [15, 20, 22].map(id => LEVELS.find(level => level.id === id))) {
    console.log(`Mobile: playing campaign level ${lesson.id}`);
    await mobile.locator('#level').selectOption(String(lesson.id));
    await noOverflow(mobile);
    if (lesson.id === 22) await mobile.screenshot({ path: resolve(output, 'mobile-advanced.png'), fullPage: true });
    await finish(mobile, lesson.solution, lesson);
    await activate(mobile, mobile.locator('#close-win'));
  }
  await mobile.locator('#mode-daily').click(); await mobile.locator('#daily-heading:not([hidden])').waitFor(); await noOverflow(mobile);
  await fullRulePalette(mobile);
  await mobile.screenshot({ path: resolve(output, 'mobile-daily.png'), fullPage: true });
  {
    const info = api ? await (await mobile.request.get(`${api}/api/daily?game=circuit-reduction`)).json() : fixture.getDaily('circuit-reduction');
    const puzzle = dailyPuzzle(info.date);
    assert.ok(puzzle.optimalMoves >= 10 && puzzle.optimalMoves <= 14);
    await finish(mobile, puzzle.solution, puzzle);
    await mobile.locator('#player-name').fill('Mobile test'); await mobile.locator('#score-form button').click();
    await mobile.getByText('Score saved.', { exact: true }).waitFor(); await mobile.locator('#close-win').click();
    console.log(`Mobile daily: solved through touch input and score accepted through ${scoreTransport}`);
  }
  await mobile.screenshot({ path: resolve(output, 'mobile-daily-completed.png'), fullPage: true });
  for (const width of [320, 768]) { await mobile.setViewportSize({ width, height: 900 }); await noOverflow(mobile); await fullRulePalette(mobile); }
  await mobile.setViewportSize({ width: 390, height: 844 });
  console.log('Mobile: three complex PDF missions completed using touch, advanced commutation, Hadamard changes of basis, identity spacing, daily horizontal scrolling and responsive page layout verified');
  for (const page of [desktop, mobile].filter(Boolean)) {
    await page.goto(`${base}/games/quantum-golf/`); await page.locator('#gate-t').waitFor();
    await noOverflow(page); await page.locator('#gate-t').click(); await page.locator('#win-dialog[open]').waitFor();
    assert.match(await page.locator('#win-summary').innerText(), /Optimal solution in 1 move/);
    await activate(page, page.locator('#close-win'));
    await openDetails(page, '#advanced-features');
    await downloadReplay(page);
  }
  console.log(`Golf: ${desktop ? 'desktop/mobile' : 'mobile'} winning gate, shared overlays and lazy replay downloads verified`);
  assert.deepEqual(errors, [], 'No uncaught browser errors');
} finally { await browser.close(); }
