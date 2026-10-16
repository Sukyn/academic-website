// Exercise the shared guide through real mouse/touch controls, without score writes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBrowserApi } from '../circuit-reduction/browser-api.mjs';
import { CIRCUIT_COLORS } from '../../src/lib/games/circuit-graphics.js';

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

async function checkInstructionSymbols(page, game) {
  const symbols = await page.locator('#tutorial-text .tutorial-gate').evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect(), paragraph = node.parentElement.getBoundingClientRect();
    return { gate: node.dataset.gate, label: node.getAttribute('aria-label'), role: node.getAttribute('role'),
      color: getComputedStyle(node).color, letter: node.classList.contains('tutorial-letter'),
      clipped: box.width <= 0 || box.height <= 0 || box.left < paragraph.left - 1 || box.right > paragraph.right + 1,
      shapes: [...node.querySelectorAll('.gate-glyph')].map(svg => ({
        rect: svg.querySelector('rect')?.getAttribute('fill'),
        circle: svg.querySelector('circle')?.getAttribute('fill'),
        stroke: svg.querySelector('path')?.getAttribute('stroke'),
        radius: Number(svg.querySelector('circle')?.getAttribute('r')),
      })),
    };
  }));
  for (const symbol of symbols) {
    assert.equal(symbol.role, 'img', 'Inline gates retain an accessible name');
    assert.equal(symbol.label, ['CX', 'XC'].includes(symbol.gate) ? 'CNOT' : symbol.gate);
    assert.equal(symbol.clipped, false, 'Inline symbols fit the instruction at this viewport');
    if (game === 'quantum-golf') {
      assert.equal(symbol.letter, true);
      assert.equal(symbol.color, symbol.gate === 'H' ? 'rgb(238, 159, 134)' : 'rgb(181, 162, 234)');
      assert.equal(symbol.color, await page.locator('#gate-' + symbol.gate.toLowerCase()).evaluate(button => getComputedStyle(button).color),
        'Golf gate letters use the same color as their real buttons');
      continue;
    }
    const cells = symbol.gate === 'CX' ? ['Z', 'X'] : symbol.gate === 'XC' ? ['X', 'Z'] : symbol.gate === 'CZ' ? ['Z', 'Z'] : [symbol.gate];
    assert.equal(symbol.shapes.length, cells.length);
    for (const [index, cell] of cells.entries()) {
      const shape = symbol.shapes[index];
      if (cell === 'H') assert.equal(shape.rect, CIRCUIT_COLORS.h);
      else if (cell === 'X') assert.equal(shape.stroke, CIRCUIT_COLORS.x);
      else { assert.equal(shape.circle, CIRCUIT_COLORS.z); assert.equal(shape.radius, 8, 'Inline controls use the readable shared dot size'); }
    }
  }
  return symbols.map(symbol => symbol.gate);
}

async function rulePositions(page) {
  return page.locator('[data-rule]').evaluateAll(buttons => buttons.map(button => {
    const bounds = button.getBoundingClientRect(), palette = button.parentElement.getBoundingClientRect();
    return { rule: button.dataset.rule, order: getComputedStyle(button).order,
      x: Math.round((bounds.left - palette.left) * 100), y: Math.round((bounds.top - palette.top) * 100) };
  }));
}

async function circuitSnapshot(page) {
  return page.locator('#circuit-board [data-cell]').evaluateAll(cells => {
    const rows = [];
    for (const cell of cells) {
      const [row, column] = cell.dataset.cell.split(':').map(Number);
      (rows[row] ??= [])[column] = cell.dataset.gate;
    }
    return { width: rows[0].length, gates: rows.map(row => row.filter(gate => gate !== '.')),
      moves: Number(document.getElementById('move-count').textContent.split(' ')[0]) };
  });
}

async function checkControlAppearance(page, game) {
  const selector = game === 'circuit-reduction' ? '[data-cell], [data-space], [data-rule]' :
    game === 'quantum-signals' ? '#signal-board button, [data-choice]' : '.gates button';
  assert.deepEqual(await page.locator(selector).evaluateAll(buttons => buttons.filter(button => {
    const style = getComputedStyle(button);
    return style.appearance !== 'none' || style.getPropertyValue('-webkit-appearance') !== 'none' || style.backgroundImage !== 'none';
  }).map(button => button.id || button.className)), [], 'Game buttons suppress native mobile styling');
  const glyphSelector = game === 'circuit-reduction' ? '#circuit-board .circuit-cell > .gate-glyph, #circuit-board .space-handle > .space-glyph' :
    '#signal-board .signal-endpoint > .gate-glyph';
  if (game !== 'quantum-golf') assert.deepEqual(await page.locator(glyphSelector).evaluateAll(glyphs => glyphs.filter(glyph => {
    const rect = glyph.getBoundingClientRect(), parent = glyph.parentElement.getBoundingClientRect();
    return Math.abs(rect.left + rect.width / 2 - parent.left - parent.width / 2) > 1 ||
      Math.abs(rect.top + rect.height / 2 - parent.top - parent.height / 2) > 1;
  }).map(glyph => glyph.parentElement.className)), [], 'Gate and add-space symbols stay centered in their controls');
  if (game !== 'quantum-golf') assert.deepEqual(await page.locator('.gate-glyph path').evaluateAll(paths =>
    paths.filter(path => getComputedStyle(path).stroke !== 'rgb(229, 168, 157)').map(path => getComputedStyle(path).stroke)),
  [], 'X targets keep their circuit color rather than native button/link blue');
}

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
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('#mode-tutorial').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await page.locator('#mode-tutorial,#mode-campaign,#mode-random,#mode-daily').allTextContents(),
      ['Tutorial', 'Levels', 'Custom/Random', 'Daily Puzzle']);
    assert.equal(await page.locator('#tutorial-start').innerText(), 'Start tutorial');
    await checkInstructionSymbols(page, game);
    await checkControlAppearance(page, game);
    const palettePositions = game === 'circuit-reduction' ? await rulePositions(page) : null;
    if (palettePositions) assert.ok(palettePositions.every(button => button.order === '0'), 'Tutorial preserves the printed rule order');
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
    await page.locator('#tutorial-panel').screenshot({ path: resolve(output, `${profile}-${game}-instruction.png`) });
    let steps = 0;
    const symbolsSeen = new Set(), freeActions = [];
    while (await page.locator('#tutorial-next').isVisible()) {
      assert.ok(steps < 20, 'Worked examples have a finite number of steps');
      await page.waitForFunction(() => !document.getElementById('tutorial-next').disabled);
      assert.equal(await page.locator('[data-tutorial-focus]').count(), 1);
      assert.equal(await page.locator('[data-tutorial-focus]').isEnabled(), true);
      for (const gate of await checkInstructionSymbols(page, game)) symbolsSeen.add(gate);
      await checkControlAppearance(page, game);
      if (palettePositions) {
        const current = await rulePositions(page);
        assert.deepEqual(current.map(({ rule, order }) => ({ rule, order })), palettePositions.map(({ rule, order }) => ({ rule, order })),
          'Highlighting preserves every rule and its CSS order');
        for (const [index, position] of current.entries()) {
          // Existing hover styling lifts a button by one pixel; its grid slot stays fixed.
          assert.ok(Math.abs(position.x - palettePositions[index].x) <= 101 && Math.abs(position.y - palettePositions[index].y) <= 101,
            'Highlighting never changes a rule button’s grid position');
        }
      }
      const freeAction = game === 'circuit-reduction' ? await page.locator('[data-tutorial-focus]').evaluate(button =>
        button.hasAttribute('data-space') ? 'space' : button.id === 'compact-identities' ? 'tidy' : null) : null;
      if (freeAction === 'space') {
        const glyph = page.locator('[data-tutorial-focus] .space-glyph');
        assert.equal(await glyph.isVisible(), true);
        assert.equal(await glyph.evaluate(node => getComputedStyle(node).opacity), '1', 'The guided add-space icon is visible before hover on desktop and mobile');
      }
      const before = freeAction ? await circuitSnapshot(page) : null;
      const instruction = await page.locator('#tutorial-heading').innerText();
      // Exercise layout lessons through the real circuit/Tidy control, not just Next.
      await activate(freeAction || !(steps % 2) ? page.locator('[data-tutorial-focus]') : page.locator('#tutorial-next'));
      await page.waitForFunction(previous => document.getElementById('tutorial-heading').textContent !== previous, instruction);
      if (freeAction) {
        const after = await circuitSnapshot(page);
        assert.deepEqual(after.gates, before.gates, 'Spacing preserves the ordered gates on every wire');
        assert.equal(after.moves, before.moves, 'Layout actions do not count as rewrites');
        assert.ok(freeAction === 'space' ? after.width > before.width : after.width < before.width,
          'The actual layout control changes circuit spacing');
        freeActions.push(freeAction);
        await page.screenshot({ path: resolve(output, `${profile}-${game}-${freeAction}.png`), fullPage: true });
      }
      steps++;
      assert.equal(await page.locator('#win-dialog[open]').count(), 0, 'Normal result popup never covers the explanation');
    }
    assert.ok(steps >= 5, 'The demonstration uses a challenging worked example');
    assert.equal(await page.locator('#tutorial-heading').innerText(), 'Tutorial complete');
    if (game === 'quantum-golf') assert.equal(await page.locator('#status').innerText(), 'In the hole!');
    if (game === 'quantum-signals') assert.equal(await page.locator('#signal-flow').getAttribute('data-match'), 'true');
    if (game === 'circuit-reduction') {
      assert.equal(await page.locator('.circuit-cell[data-gate]:not([data-gate="."])').count(), 0);
      assert.deepEqual(freeActions, ['space', 'tidy']);
      assert.equal(await page.locator('#move-count').innerText(), '7 moves');
      assert.ok(symbolsSeen.has('XC') && symbolsSeen.has('CZ') && symbolsSeen.has('H') && symbolsSeen.has('X') && symbolsSeen.has('Z'));
    }
    if (game === 'quantum-golf') assert.deepEqual([...symbolsSeen].sort(), ['H', 'T']);
    if (game === 'quantum-signals') assert.deepEqual([...symbolsSeen].sort(), ['CX', 'CZ', 'H', 'Z']);
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
