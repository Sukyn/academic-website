// Exercise the shared guide through real mouse/touch controls, without score writes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBrowserApi } from '../circuit-reduction/browser-api.mjs';

const require = createRequire(resolve(process.env.PLAYWRIGHT_MODULE_DIR ?? 'tmp/quality-tools/node_modules', 'package.json'));
const qualityRequire = createRequire(resolve(process.env.QUALITY_MODULE_DIR ?? 'tmp/quality-tools/node_modules', 'package.json'));
const { chromium } = require('playwright');
const axeSource = await readFile(qualityRequire.resolve('axe-core/axe.min.js'), 'utf8');
const base = process.env.GAME_BASE_URL ?? 'http://127.0.0.1:4323';
const output = resolve('tmp/tutorial-browser');
const fixture = createBrowserApi({ now: Date.parse('2026-10-15T10:00:00Z') });
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {}) });
await mkdir(output, { recursive: true });

try {
  for (const [profile, options] of [
    ['desktop', { viewport: { width: 1440, height: 1000 } }],
    ['mobile', { viewport: { width: 320, height: 780 }, isMobile: true, hasTouch: true }],
  ]) for (const game of ['quantum-golf', 'circuit-reduction', 'quantum-signals']) {
    const context = await browser.newContext({ ...options, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [], requests = [], workers = [];
    const activate = locator => options.hasTouch ? locator.tap() : locator.click();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/leaderboard') requests.push(request.method()); });
    page.on('worker', worker => workers.push(worker.url()));
    await page.clock.setFixedTime(new Date('2026-10-15T10:00:00Z'));
    await fixture.install(page);
    await page.goto(`${base}/games/${game}/`);
    await page.locator('#tutorial-panel:visible').waitFor();
    assert.equal(await page.locator('#mode-tutorial').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await page.locator('#mode-tutorial,#mode-campaign,#mode-random,#mode-daily').allTextContents(),
      ['Tutorial', 'Levels', 'Custom/Random', 'Daily Puzzle']);
    assert.equal(await page.locator('#tutorial-start').innerText(), 'Start tutorial');
    assert.equal(await page.locator('#campaign-controls').isVisible(), false);
    assert.equal(await page.locator('#leaderboard-section').isVisible(), false);
    assert.equal(requests.length, 0, 'Tutorial does not fetch leaderboard data');
    await activate(page.locator('#show-rules'));
    await page.locator('#rules-dialog[open]').waitFor();
    await activate(page.locator('#close-rules'));
    await activate(page.locator('#tutorial-start'));
    await page.locator('[data-tutorial-focus]').waitFor();
    assert.match(await page.locator('#tutorial-heading').innerText(), /^Step 1 of /);
    // Preview a step, then prove that restarting restores the first instruction.
    await activate(page.locator('[data-tutorial-focus]'));
    await page.waitForFunction(() => document.getElementById('tutorial-heading').textContent.startsWith('Step 2'));
    await activate(page.locator('#tutorial-start'));
    assert.match(await page.locator('#tutorial-heading').innerText(), /^Step 1 of /);
    await page.screenshot({ path: resolve(output, `${profile}-${game}-step.png`), fullPage: true });
    let steps = 0;
    while (await page.locator('#tutorial-next').isVisible()) {
      assert.ok(steps < 20, 'Worked examples have a finite number of steps');
      await page.waitForFunction(() => !document.getElementById('tutorial-next').disabled);
      assert.equal(await page.locator('[data-tutorial-focus]').count(), 1);
      assert.equal(await page.locator('[data-tutorial-focus]').isEnabled(), true);
      const instruction = await page.locator('#tutorial-heading').innerText();
      await activate(steps % 2 ? page.locator('#tutorial-next') : page.locator('[data-tutorial-focus]'));
      await page.waitForFunction(previous => document.getElementById('tutorial-heading').textContent !== previous, instruction);
      steps++;
      assert.equal(await page.locator('#win-dialog[open]').count(), 0, 'Normal result popup never covers the explanation');
    }
    assert.ok(steps >= 5, 'The demonstration uses a challenging worked example');
    assert.equal(await page.locator('#tutorial-heading').innerText(), 'Tutorial complete');
    if (game === 'quantum-golf') assert.equal(await page.locator('#status').innerText(), 'In the hole!');
    if (game === 'quantum-signals') assert.equal(await page.locator('#signal-flow').getAttribute('data-match'), 'true');
    if (game === 'circuit-reduction') assert.equal(await page.locator('.circuit-cell[data-gate]:not([data-gate="."])').count(), 0);
    assert.deepEqual(requests, [], 'Guided solutions do not load or submit scores');
    assert.deepEqual(workers, [], 'Guided examples do not start solver or export workers');
    await page.evaluate(axeSource);
    const report = await page.evaluate(() => window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] },
    }));
    assert.deepEqual(report.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })), []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'No page overflow');
    await page.screenshot({ path: resolve(output, `${profile}-${game}.png`), fullPage: true });
    await activate(page.locator('#tutorial-levels'));
    await page.locator('#campaign-controls:visible').waitFor();
    await page.locator('#level').selectOption('2');
    await activate(page.locator('#mode-tutorial'));
    assert.equal(await page.locator('#tutorial-start').innerText(), 'Start tutorial');
    await activate(page.locator('#mode-campaign'));
    assert.equal(await page.locator('#level').inputValue(), '2', 'Tutorial preserves campaign selection');
    await activate(page.locator('#mode-tutorial'));
    await activate(page.locator('#mode-random'));
    await page.locator(game === 'quantum-golf' ? '#free-controls:visible' : '#custom-controls:visible').waitFor();
    if (game !== 'quantum-golf') assert.equal(await page.locator('#custom-controls button').first().isEnabled(), true, 'Leaving restores controls');
    await activate(page.locator('#mode-tutorial'));
    await activate(page.locator('#tutorial-start'));
    let dailyRequest;
    await page.route(url => url.pathname === '/api/daily', route => { dailyRequest = route; });
    await activate(page.locator('#mode-daily'));
    await page.waitForFunction(() => document.getElementById('tutorial-next').disabled);
    assert.equal(await page.locator('#tutorial-start').isEnabled(), false, 'Loading pauses the guide');
    assert.equal(await page.locator('[data-tutorial-focus]').count(), 0);
    assert.ok(dailyRequest, 'Daily request is intercepted');
    await dailyRequest.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"Invalid test request"}' });
    await page.locator('#daily-status').filter({ hasText: 'Invalid test request' }).waitFor();
    assert.equal(await page.locator('#tutorial-panel').isVisible(), true, 'A failed request preserves the guide');
    assert.match(await page.locator('#tutorial-heading').innerText(), /^Step 1 of /);
    assert.equal(await page.locator('#tutorial-next').isEnabled(), true);
    assert.deepEqual(errors, [], `${profile} ${game}: no uncaught errors`);
    console.log(`${profile} ${game}: ${steps} steps, restart, real controls, mode transitions, no score requests, accessibility passed`);
    await context.close();
  }
} finally { await browser.close(); }
