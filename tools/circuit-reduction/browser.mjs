// Run with an Astro preview. Default scoring uses a validated transport fixture;
// GAME_API_URL opts into the local PostgreSQL API harness instead.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LEVELS, dailyPuzzle } from './witnesses.js';
import { RULES, sequenceCost, moveCost, isSolved, solveShortest, applyMove } from '../../src/lib/circuit-reduction/engine.js';
import { TUTORIAL_CIRCUIT, TUTORIAL_STEPS } from '../../src/lib/circuit-reduction/tutorial.js';
import { createBrowserApi } from './browser-api.mjs';
import { layoutMoves } from './layout-moves.js';

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
// Full-page captures can reset Chromium's coarse pointer emulation.
const screenshot = (page, name) => page.screenshot({ path: resolve(output, name), fullPage: !touchPages.has(page) });

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
  assert.equal(await page.locator('#mode-tutorial').getAttribute('aria-pressed'), 'true', 'The game opens in Tutorial mode');
  await activate(page, page.locator('#mode-campaign'));
  assert.equal(await page.locator('#advanced-features, #toggle-trace, #sequence').count(), 0, 'The main game has no Advanced or trace controls');
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
    await page.locator('#share-preview').waitFor({ state: 'visible' });
    await page.locator('#share-preview').evaluate(image => image.decode());
    const preview = await page.locator('#share-preview').getAttribute('src');
    assert.equal(workers.length, 1, 'Sharing renders one still image without encoding a GIF');
    assert.equal(await page.locator('#copy-gif').isEnabled(), true, 'The still image can be copied before downloading');
    const pending = page.waitForEvent('download');
    await activate(page, button);
    const download = await pending;
    assert.match(download.suggestedFilename(), /\.gif$/);
    const bytes = await readFile(await download.path());
    assert.match(bytes.toString('ascii', 0, 6), /^GIF8[79]a$/);
    assert.ok(bytes.length > 1000);
    assert.equal(workers.length, 2, 'Download starts exactly one GIF encoder after the still renderer');
    assert.equal(await page.locator('#share-preview').getAttribute('src'), preview, 'Downloading keeps the still preview');
    const repeated = page.waitForEvent('download');
    await activate(page, button);
    const second = await repeated;
    assert.deepEqual(await readFile(await second.path()), bytes);
    assert.equal(workers.length, 2, 'Repeated download reuses the GIF');
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
async function addSpace(page, row, column, count = 1) {
  for (let index = 0; index < count; index++) {
    await activate(page, page.locator(`[data-space="${row}:${column}"]`));
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
  let steps = 0;
  for (const move of layoutMoves(await boardCircuit(page), target)) steps += await apply(page, move);
  assert.deepEqual(await boardCircuit(page), target, 'Public wire-space controls reproduce the witness layout');
  return steps;
}
async function apply(page, move) {
  if (move.rule === 'arrange') {
    return arrange(page, move.circuit);
  } else if (move.rule === 'compact-identities') {
    await activate(page, page.locator('#compact-identities'));
  } else if (move.rule === 'insert-space') {
    return arrange(page, applyMove(await boardCircuit(page), move));
  } else if (move.rule === 'remove-space') {
    await removeSpace(page, move.row, move.column);
  } else if (move.rule === 'insert-column') {
    await addSpace(page, 0, move.column, move.count ?? 1);
    return move.count ?? 1;
  } else if (move.rule.endsWith('column')) {
    await removeSpace(page, 0, move.column);
  } else {
    const rule = RULES.find(rule => rule.id === move.rule);
    assert.ok(rule, `Known playable rule ${move.rule}`);
    assert.equal(await page.locator(`[data-rule="${move.rule}"]`).evaluate(button => button.hidden), false, 'A witness uses only rules unlocked by the current lesson');
    for (let y = 0; y < rule.left.length; y++) for (let x = 0; x < rule.left[0].length; x++) await activate(page, page.locator(`[data-cell="${move.row + y}:${move.column + x}"]`));
    await activate(page, page.locator(`[data-rule="${move.rule}"]`));
  }
  return 1;
}
async function finish(page, sequence, { optimalMoves = sequenceCost(sequence), parMoves = null } = {}) {
  let replaySteps = 0;
  for (const move of sequence) replaySteps += await apply(page, move);
  await page.locator('#win-dialog[open]').waitFor();
  await page.waitForFunction(() => document.getElementById('score-status').textContent !== 'Saving…');
  const moves = sequenceCost(sequence);
  assert.match(await page.locator('#move-count').innerText(), new RegExp(`^${moves} moves?$`));
  if (optimalMoves !== null) assert.match(await page.locator('#win-summary').innerText(), /Optimal solution/);
  else {
    assert.doesNotMatch(await page.locator('#win-summary').innerText(), /Optimal/);
    const benchmark = page.locator('#leaderboard-body .benchmark');
    assert.match(await benchmark.innerText(), new RegExp(`Best known\\s+${parMoves}`), 'Uncertified missions advertise a known solution honestly');
  }
  return replaySteps;
}

async function registerScore(page, name) {
  await page.waitForFunction(() => document.getElementById('score-status').textContent !== 'Saving…');
  if (await page.locator('#score-form').isVisible()) {
    await page.locator('#player-name').fill(name);
    await activate(page, page.locator('#submit-score'));
  } else assert.equal(await page.locator('#nickname-value').inputValue(), name, 'Automatic scores use the remembered nickname');
  await page.getByText('Score saved.', { exact: true }).waitFor();
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

async function openJson(page, action = 'input-json') {
  if (!await page.locator('#puzzle-json-dialog').evaluate(dialog => dialog.open)) await activate(page, page.locator('#' + action));
  await page.locator('#puzzle-json-dialog[open]').waitFor();
}

async function importJson(page, puzzle) {
  await openJson(page);
  await page.locator('#puzzle-json-text').fill(JSON.stringify(puzzle));
  await activate(page, page.locator('#puzzle-json-apply'));
  await page.locator('#puzzle-json-dialog').waitFor({ state: 'hidden' });
}

async function exportJson(page, game) {
  await openJson(page, 'share-json');
  const data = JSON.parse(await page.locator('#puzzle-json-text').inputValue());
  assert.deepEqual(Object.keys(data).sort(), game === 'quantum-golf' ? ['epsilon', 'target'] : ['circuit'], 'Custom JSON contains only the puzzle data');
  await screenshot(page, `custom-json-${game}-${await page.evaluate(() => innerWidth)}.png`);
  const pending = page.waitForEvent('download');
  await activate(page, page.locator('#puzzle-json-download'));
  const download = await pending;
  assert.match(download.suggestedFilename(), /\.json$/);
  assert.deepEqual(JSON.parse(await readFile(await download.path(), 'utf8')), data, 'Downloaded JSON preserves the complete exported puzzle');
  await page.keyboard.press('Escape');
  return data;
}

async function customBuilder(page) {
  await activate(page, page.locator('#mode-random'));
  await activate(page, page.locator('#create-circuit'));
  await fullRulePalette(page);
  const identity = () => boardCircuit(page).then(rows => rows.every(row => row.every(gate => gate === '.')));
  assert.equal(await identity(), true, 'Creating a circuit starts from identity');
  assert.equal(await page.locator('#save-circuit').isDisabled(), true, 'Empty identity cannot be saved as a puzzle');
  assert.equal(await page.locator('#share-json').isDisabled(), true, 'Empty identity cannot be shared as a puzzle');
  assert.equal(await page.locator('#input-json').isEnabled(), true);
  assert.equal(await page.locator('#win-dialog').evaluate(dialog => dialog.open), false, 'Identity construction does not open a victory dialog');
  await screenshot(page, `custom-identity-${await page.evaluate(() => innerWidth)}.png`);
  await page.locator('#editor-wires').selectOption('3');
  assert.equal((await boardCircuit(page)).length, 3);
  await page.locator('#editor-wires').selectOption('2');
  await addSpace(page, 0, 1);
  assert.equal((await boardCircuit(page))[0].length, 7);
  await activate(page, page.locator('#undo'));
  assert.equal((await boardCircuit(page))[0].length, 6);
  const construction = [{ rule: 'cancel-x', row: 0, column: 1 }, { rule: 'cancel-h', row: 1, column: 3 }];
  for (const move of construction) await apply(page, move);
  assert.equal(await page.locator('#save-circuit').isEnabled(), true, 'Inverse rewrite rules build a saveable identity circuit');
  await page.keyboard.press('r');
  assert.equal(await identity(), true, 'Reset returns construction to its initial identity');
  assert.equal(await page.locator('#circuit-editor-controls').isVisible(), true);
  for (const move of construction) await apply(page, move);
  const built = await boardCircuit(page);
  await noOverflow(page);
  await screenshot(page, `custom-builder-${await page.evaluate(() => innerWidth)}.png`);
  await activate(page, page.locator('#save-circuit'));
  await page.locator('#custom-status').filter({ hasText: 'Shortest solution: 2 moves.' }).waitFor();
  assert.equal(await page.locator('#circuit-editor-controls').isVisible(), false);
  assert.equal(await page.locator('#move-count').innerText(), '0 moves');
  assert.equal(await page.locator('#replay').isDisabled(), true, 'Construction history is not a gameplay replay');
  await screenshot(page, `custom-saved-${await page.evaluate(() => innerWidth)}.png`);
  const exported = await exportJson(page, 'circuit-simplification');
  assert.deepEqual(exported.circuit, built, 'Play and JSON export preserve the constructed circuit');
  await openJson(page);
  for (const invalid of ['{', JSON.stringify({ circuit: [['H', '.']] }), JSON.stringify({ circuit: [['X', 'X'], ['.']] })]) {
    await page.locator('#puzzle-json-text').fill(invalid);
    await activate(page, page.locator('#puzzle-json-apply'));
    assert.ok(await page.locator('#puzzle-json-status').innerText(), 'Malformed and nonidentity circuits receive a readable error');
    assert.deepEqual(await boardCircuit(page), built, 'Rejected imports preserve the active circuit');
  }
  await page.keyboard.press('Escape'); await openJson(page);
  assert.deepEqual(JSON.parse(await page.locator('#puzzle-json-text').inputValue()), { circuit: [['X', 'X'], ['.']] }, 'Closing and reopening Input JSON preserves the raw draft');
  await importJson(page, exported);
  await page.locator('#custom-status').filter({ hasText: 'Shortest solution: 2 moves.' }).waitFor();
  await finish(page, construction);
  assert.equal(await page.locator('#score-form').isVisible(), false, 'Custom puzzle scores are not submitted');
  await activate(page, page.locator('#close-win'));
  await importJson(page, { circuit: [['H', 'Z', 'H', 'X']] });
  await page.locator('#custom-status').filter({ hasText: 'Shortest solution: 2 moves.' }).waitFor();
  const custom = solveShortest([['H', 'Z', 'H', 'X']]);
  assert.equal(custom.status, 'optimal'); assert.equal(custom.optimalMoves, 2);
  await finish(page, custom.solution, custom); await activate(page, page.locator('#close-win'));
  console.log('Custom reduction: identity construction, inverse rules, reset/spacing, play, raw JSON download/import and invalid circuits verified.');
}

async function focusedCustom() {
  for (const options of [{ viewport: { width: 1440, height: 1050 } }, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]) {
    const page = await pageFor(options);
    await customBuilder(page);
    await openJson(page);
    await page.locator('#mode-daily').evaluate(button => button.click());
    await page.locator('#daily-heading:not([hidden])').waitFor();
    assert.equal(await page.locator('#puzzle-json-dialog').isVisible(), false, 'Entering daily mode closes a stale JSON dialog');
    for (const selector of ['#custom-controls', '#circuit-editor-controls', '#share-json', '#input-json']) assert.equal(await page.locator(selector).isVisible(), false);
    await page.goto(`${base}/games/quantum-golf/`);
    await activate(page, page.locator('#mode-campaign'));
    await golfCustomJson(page);
  }
  assert.deepEqual(errors, [], 'No uncaught custom puzzle errors');
}

async function focusedRegistration() {
  for (const options of [{ viewport: { width: 1440, height: 1050 } }, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]) {
    const page = await pageFor(options), name = options.hasTouch ? 'Remembered mobile' : 'Remembered desktop';
    for (const level of LEVELS.slice(0, 2)) {
      await page.locator('#level').selectOption(String(level.id));
      await finish(page, level.solution, level);
      await registerScore(page, name); await activate(page, page.locator('#close-win'));
    }
    await activate(page, page.locator('#mode-daily'));
    await page.locator('#daily-heading:not([hidden])').waitFor();
    const info = fixture.getDaily('circuit-reduction'), puzzle = dailyPuzzle(info.date);
    await finish(page, puzzle.solution, puzzle); await registerScore(page, name);
    await activate(page, page.locator('#close-win'));
  }
  assert.deepEqual(errors, [], 'No uncaught score registration errors');
  console.log('Remembered Reduction nickname: manual first level, automatic next level and current daily score verified on desktop/mobile.');
}

async function focusedTutorial() {
  for (const [profile, options] of [['desktop', { viewport: { width: 1440, height: 1050 } }],
    ['mobile', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]]) {
    const page = await pageFor(options), workers = [];
    let requests = 0;
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests++; });
    page.on('worker', worker => workers.push(worker.url()));
    const ruleOrder = async () => page.locator('[data-rule]:visible').evaluateAll(buttons => ({
      dom: buttons.map(button => button.dataset.rule),
      visual: buttons.map(button => ({ id: button.dataset.rule, top: button.offsetTop, left: button.offsetLeft }))
        .sort((a, b) => a.top - b.top || a.left - b.left).map(button => button.id),
    }));
    try {
      await activate(page, page.locator('#mode-tutorial'));
      await page.evaluate(() => document.fonts.ready);
      assert.match(await page.locator('#tutorial-text').innerText(), /identity.*empty wires.*every input unchanged/i,
        'The introduction states the goal and what identity means');
      assert.match(await page.locator('#tutorial-text').innerText(), /rule matching the selected gates/i);
      assert.deepEqual(await boardCircuit(page), TUTORIAL_CIRCUIT);
      assert.deepEqual(TUTORIAL_CIRCUIT.map(row => row.slice(0, 4)), [['X', 'X', 'H', 'H'], ['.', '.', '.', '.']]);
      const order = await ruleOrder();
      assert.deepEqual(order.dom, RULES.map(rule => rule.id), 'The tutorial presents the normal rule order');
      assert.deepEqual(order.visual, order.dom, 'CSS does not move the active rule ahead of the others');
      await screenshot(page, `${profile}-tutorial-intro.png`);
      await activate(page, page.locator('#tutorial-start'));
      await boardSizing(page, Boolean(options.hasTouch));
      let expected = structuredClone(TUTORIAL_CIRCUIT), moves = 0;
      for (const [index, step] of TUTORIAL_STEPS.entries()) {
        if (step.layout) expected = applyMove(expected, { rule: 'arrange', row: 0, column: 0, circuit: step.layout });
        assert.deepEqual(await boardCircuit(page), expected, `Step ${index + 1} starts on its exact worked layout`);
        assert.equal(await page.locator('#tutorial-heading').innerText(), `Step ${index + 1} of ${TUTORIAL_STEPS.length}`);
        const target = page.locator('[data-tutorial-focus]');
        assert.equal(await target.count(), 1, 'Exactly one real game control is highlighted');
        assert.equal(await target.evaluate((node, selector) => node.matches(selector), step.target ?? `[data-rule="${step.move.rule}"]`), true);
        assert.equal(await target.isDisabled(), false);
        const rule = RULES.find(rule => rule.id === step.move.rule);
        if (rule) {
          const selected = [];
          for (let row = 0; row < rule.left.length; row++) for (let column = 0; column < rule.left[0].length; column++) {
            selected.push(`${step.move.row + row}:${step.move.column + column}`);
          }
          assert.deepEqual(await page.locator('[data-cell][aria-pressed="true"]').evaluateAll(nodes => nodes.map(node => node.dataset.cell)), selected,
            'The guide selects the gate block for the matching rule');
          const pattern = expected.slice(step.move.row, step.move.row + rule.left.length)
            .map(row => row.slice(step.move.column, step.move.column + rule.left[0].length));
          assert.ok([rule.left, rule.right].some(side => JSON.stringify(side) === JSON.stringify(pattern)),
            'The displayed selected pattern is one side of the highlighted rule');
        }
        const tokens = [...step.text.matchAll(/\b(CNOT|CZ|H|T|X|Z)\b/g)].map(match => ({ CNOT: 'XU', CZ: 'ZU' })[match[1]] ?? match[1]);
        assert.deepEqual(await page.locator('#tutorial-text .tutorial-gate').evaluateAll(nodes => nodes.map(node => node.dataset.gate)), tokens,
          'Tutorial gate names render as gameplay icons');
        assert.equal(await page.locator('#tutorial-text .tutorial-gate:not(:has(svg))').count(), 0);
        assert.equal(await page.locator('#tutorial-text .tutorial-pair').count(), 0, 'Rule instructions show only their single-wire endpoints');
        if (index === 4) await screenshot(page, `${profile}-tutorial-controlled-rule.png`);
        assert.deepEqual(await ruleOrder(), order, 'A matching rule keeps its normal place in the palette');
        if (index < 2) assert.equal(step.move.rule, index ? 'cancel-h' : 'cancel-x', 'The first two steps teach simple cancellations');
        await activate(page, step.target || index % 2 === 0 ? target : page.locator('#tutorial-next'));
        expected = applyMove(expected, step.move); moves += moveCost(step.move);
        const next = TUTORIAL_STEPS[index + 1];
        const prepared = next?.layout ? applyMove(expected, { rule: 'arrange', row: 0, column: 0, circuit: next.layout }) : expected;
        assert.deepEqual(await boardCircuit(page), prepared, 'The real action and next preparation match the circuit engine');
        assert.equal(await page.locator('#move-count').innerText(), `${moves} move${moves === 1 ? '' : 's'}`,
          'Only logical rewrites count, including after free spacing and Tidy');
        assert.equal(await page.locator('#win-dialog').evaluate(dialog => dialog.open), false, 'The guide never opens a result popup');
        await noOverflow(page);
      }
      assert.equal(moves, 11);
      assert.ok(isSolved(await boardCircuit(page)), 'The worked example finishes on empty identity wires');
      assert.equal(await page.locator('#tutorial-heading').innerText(), 'Tutorial complete');
      assert.deepEqual(await ruleOrder(), order, 'The rule order remains fixed after completion');
      assert.equal(requests, 0, 'The tutorial never requests or submits scores');
      assert.deepEqual(workers, [], 'The fixed walkthrough starts no solver or replay encoder');
      await activate(page, page.locator('#tutorial-levels'));
      assert.equal(await page.locator('#mode-campaign').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#tutorial-panel').isVisible(), false);
      await activate(page, page.locator('#mode-tutorial'));
      await activate(page, page.locator('#tutorial-start'));
      await activate(page, page.locator('[data-tutorial-focus]'));
      await activate(page, page.locator('#tutorial-start'));
      assert.deepEqual(await boardCircuit(page), TUTORIAL_CIRCUIT, 'Restart restores the simple prefix and worked example');
      assert.equal(await page.locator('#move-count').innerText(), '0 moves');
      assert.equal(await page.locator('#tutorial-heading').innerText(), `Step 1 of ${TUTORIAL_STEPS.length}`);
      await activate(page, page.locator('#mode-campaign'));
      assert.deepEqual(await boardCircuit(page), LEVELS[0].circuit, 'Leaving the restarted tutorial restores the campaign circuit');
      await noOverflow(page);
    } finally {
      await page.context().close();
    }
    console.log(`${profile}: identity goal, uncontrolled then controlled rules, matching icons, fixed order, full solution, free layout, restart and Levels verified.`);
  }
  assert.deepEqual(errors, [], 'The tutorial has no uncaught browser errors');
}

async function golfCustomJson(page) {
  await activate(page, page.locator('#mode-random'));
  await importJson(page, { target: [2, 2, 0], epsilon: 0.1 });
  const exported = await exportJson(page, 'quantum-golf');
  assert.ok(Math.abs(exported.target[0] - Math.SQRT1_2) < 1e-9 && Math.abs(exported.target[1] - Math.SQRT1_2) < 1e-9);
  assert.equal(exported.epsilon, 0.1);
  await openJson(page);
  const angles = await page.locator('#target-theta, #target-phi, #epsilon').evaluateAll(nodes => nodes.map(node => node.value));
  for (const invalid of ['{', JSON.stringify({ target: [0, 0, 0], epsilon: 0.1 }), JSON.stringify({ target: [1, 0, 0], epsilon: 2 })]) {
    await page.locator('#puzzle-json-text').fill(invalid);
    await activate(page, page.locator('#puzzle-json-apply'));
    assert.ok(await page.locator('#puzzle-json-status').innerText());
    assert.deepEqual(await page.locator('#target-theta, #target-phi, #epsilon').evaluateAll(nodes => nodes.map(node => node.value)), angles, 'Rejected Golf imports preserve the active target');
  }
  await page.locator('#puzzle-json-file').setInputFiles({ name: 'custom-golf.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
  await page.waitForFunction(data => JSON.stringify(JSON.parse(document.querySelector('#puzzle-json-text').value)) === JSON.stringify(data), exported);
  await activate(page, page.locator('#puzzle-json-apply'));
  await page.locator('#puzzle-json-dialog').waitFor({ state: 'hidden' });
  await activate(page, page.locator('#gate-t'));
  await page.locator('#win-dialog[open]').waitFor();
  assert.equal(await page.locator('#score-form').isVisible(), false, 'Imported Golf puzzles are unranked');
  await activate(page, page.locator('#close-win'));
  await openJson(page);
  await page.locator('#mode-daily').evaluate(button => button.click());
  await page.locator('#daily-heading:not([hidden])').waitFor();
  assert.equal(await page.locator('#puzzle-json-dialog').isVisible(), false);
  for (const selector of ['#share-json', '#input-json', '#custom-json-actions']) assert.equal(await page.locator(selector).isVisible(), false);
  await noOverflow(page);
  console.log('Golf custom JSON: normalized target, file round trip, playable unranked import and daily hiding verified.');
}
async function desktopSelection(page) {
  const selected = () => page.locator('[data-cell][aria-pressed="true"]').evaluateAll(cells => cells.map(cell => cell.dataset.cell));
  async function drag(from, to) {
    const start = page.locator(`[data-cell="${from}"]`), end = page.locator(`[data-cell="${to}"]`);
    await start.scrollIntoViewIfNeeded(); await end.scrollIntoViewIfNeeded();
    const a = await start.boundingBox(), b = await end.boundingBox(); assert.ok(a && b);
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 }); await page.mouse.up();
  }
  const original = await boardCircuit(page);
  await drag('0:1', '0:2');
  assert.deepEqual(await selected(), ['0:1', '0:2'], 'A real drag selects both gates and keeps its origin selected on release');
  assert.deepEqual(await boardCircuit(page), original, 'Dragging across a space handle does not insert an identity');
  await page.keyboard.press('Enter'); await page.locator('#win-dialog[open]').waitFor();
  assert.equal(await page.locator('#move-count').innerText(), '1 move');
  await page.locator('#close-win').click(); await page.keyboard.press('Control+z');
  assert.deepEqual(await boardCircuit(page), original, 'The standard undo shortcut restores a completed circuit');
  assert.equal(await page.locator('#move-count').innerText(), '0 moves');

  // Native Enter still activates a focused rule button exactly once.
  await page.locator('[data-cell="0:1"]').click(); await page.locator('[data-cell="0:2"]').click();
  await page.locator('[data-rule="cancel-x"]').focus(); await page.keyboard.press('Enter');
  await page.locator('#win-dialog[open]').waitFor();
  assert.equal(await page.locator('#move-count').innerText(), '1 move');
  await page.locator('#close-win').click(); await page.locator('#restart').click();

  const lesson = LEVELS.find(level => level.circuit.length > 1 && level.circuit[0].length > 3);
  await page.locator('#level').selectOption(String(lesson.id));
  const rectangle = ['0:0', '0:1', '0:2', '1:0', '1:1', '1:2'];
  await drag('1:2', '0:0');
  assert.deepEqual(await selected(), rectangle, 'A reverse drag selects a rectangle across wires');
  await page.keyboard.press('Escape'); assert.deepEqual(await selected(), []);
  await page.locator('[data-cell="0:0"]').click();
  await page.locator('[data-cell="1:2"]').click({ modifiers: ['Shift'] });
  assert.deepEqual(await selected(), rectangle, 'Shift-click extends from the previous clicked cell');
  await page.keyboard.press('Escape');
  await page.locator('[data-cell="1:2"]').click({ modifiers: ['Shift'] });
  assert.deepEqual(await selected(), ['1:2'], 'Escape also clears the Shift-click anchor');
  await page.locator('#level').selectOption('1');
  console.log('Desktop selection: drag across wires and spacing handles, Shift-click, Enter, native rule activation and Ctrl+Z verified');
}
async function columnSpacing(page) {
  const lesson = LEVELS.find(level => level.circuit.length > 1);
  await page.locator('#level').selectOption(String(lesson.id));
  const original = await boardCircuit(page);
  const expected = applyMove(original, { rule: 'insert-column', row: 0, column: 1 });
  await addSpace(page, 1, 1);
  assert.deepEqual(await boardCircuit(page), expected, 'A normal + on the lower wire inserts space on every wire');
  assert.equal(await page.locator('#move-count').innerText(), '0 moves');
  if (!touchPages.has(page)) {
    await page.locator('#restart').click();
    await page.locator('[data-space="1:1"]').click({ modifiers: ['Shift'] });
    assert.deepEqual(await boardCircuit(page), expected, 'Shift does not change the standard + behavior');
  }
  await page.locator('#level').selectOption('1');
}

async function boardSizing(page, touch = false) {
  const dimensions = await page.evaluate(() => {
    const rect = selector => document.querySelector(selector).getBoundingClientRect();
    const cell = rect('[data-cell]'), gate = document.querySelector('[data-cell] .gate-glyph')?.getBoundingClientRect();
    const handle = rect('[data-space]'), plus = rect('[data-space] .space-glyph');
    return { cell: [cell.width, cell.height], gate: gate?.width, handle: handle.width, plus: plus.width };
  });
  assert.deepEqual(dimensions.cell, touch ? [80, 80] : [64, 64], 'Touch cells are enlarged while desktop sizing stays unchanged');
  if (dimensions.gate !== undefined) assert.equal(dimensions.gate, touch ? 55 : 44, 'Gate symbols grow with the touch board');
  assert.equal(dimensions.plus, 20, 'Space symbols retain their original visible size');
  assert.equal(dimensions.cell[0] - dimensions.handle, touch ? 55 : 40,
    'The cell area outside the overlapping space handles is wider on touch screens');
}

async function mobileBoardLayout(page) {
  const lesson = LEVELS.find(level => level.circuit.length > 1);
  await page.locator('#level').selectOption(String(lesson.id));
  const original = await boardCircuit(page);
  for (const width of [320, 390, 844]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 844 });
    await boardSizing(page, true);
    await noOverflow(page);
    const rowSpacing = await page.evaluate(() => {
      const cell = key => document.querySelector(`[data-cell="${key}"]`).getBoundingClientRect();
      return cell('1:0').top - cell('0:0').top;
    });
    assert.equal(rowSpacing, 90, 'Wire rows stay aligned after changing orientation');
    const gate = page.locator('[data-cell]:not([data-gate="."])').first();
    await gate.scrollIntoViewIfNeeded();
    const size = await gate.boundingBox();
    for (const x of [15, size.width - 15]) {
      await gate.tap({ position: { x, y: size.height / 2 } });
      assert.equal(await gate.getAttribute('aria-pressed'), 'true', 'Taps near either gate edge select the gate');
      assert.deepEqual(await boardCircuit(page), original, 'Near-edge gate taps do not insert space');
      await page.keyboard.press('Escape');
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await addSpace(page, 0, 1);
  assert.deepEqual(await boardCircuit(page), applyMove(original, { rule: 'insert-column', row: 0, column: 1 }),
    'Deliberately tapping + still inserts a column');
  await activate(page, page.locator('#restart'));

  // A touch-capable laptop or tablet can also be used with a mouse or pen.
  await page.setViewportSize({ width: 844, height: 844 });
  const first = page.locator('[data-cell="0:0"]'), last = page.locator('[data-cell="1:1"]');
  await first.scrollIntoViewIfNeeded(); await last.scrollIntoViewIfNeeded();
  const start = await first.boundingBox(), end = await last.boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 });
  await page.mouse.up();
  assert.deepEqual(await page.locator('[data-cell][aria-pressed="true"]').evaluateAll(cells => cells.map(cell => cell.dataset.cell)),
    ['0:0', '0:1', '1:0', '1:1'], 'Mouse dragging uses the enlarged touch-board coordinates');
  assert.deepEqual(await boardCircuit(page), original, 'Dragging across the enlarged space handles preserves the circuit');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot(page, 'mobile-enlarged.png');
  await boardSizing(page, true);
  await page.locator('#level').selectOption('1');
  console.log('Mobile circuit: larger safe selection area, near-edge touch taps, deliberate spacing, orientation changes and mouse dragging verified.');
}

async function focusedMobileLayout() {
  const desktop = await pageFor({ viewport: { width: 1440, height: 1050 } });
  await boardSizing(desktop);
  await desktopSelection(desktop);
  const mobile = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobileBoardLayout(mobile);
  assert.deepEqual(errors, [], 'No uncaught desktop or touch-board errors');
}
try {
  if (process.env.GAME_TEST_SCOPE === 'tutorial') await focusedTutorial();
  else if (process.env.GAME_TEST_SCOPE === 'custom') await focusedCustom();
  else if (process.env.GAME_TEST_SCOPE === 'registration') await focusedRegistration();
  else if (process.env.GAME_TEST_SCOPE === 'mobile-layout') await focusedMobileLayout();
  else {
  let desktop, beforeRemoval;
  if (process.env.GAME_TEST_SCOPE !== 'mobile') {
    desktop = await pageFor({ viewport: { width: 1440, height: 1050 } });
    await boardSizing(desktop);
    await noOverflow(desktop);
    await desktopSelection(desktop);
    await columnSpacing(desktop);
    await screenshot(desktop, 'desktop.png');
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
      if (level.id === LEVELS.at(-1).id) await screenshot(desktop, 'desktop-advanced.png');
      await finish(desktop, level.solution, level);
      if (level.id === 1) {
        await registerScore(desktop, 'Desktop test');
        assert.match(await desktop.locator('#player-rank').innerText(), /Your rank:/);
      }
      await desktop.locator('#close-win').click();
      if (level.id === 1) {
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
        await addSpace(desktop, 0, 0, 100);
        assert.equal((await boardCircuit(desktop))[0].length, 102);
        await activate(desktop, desktop.locator('#compact-identities'));
        assert.deepEqual(await boardCircuit(desktop), [['.', '.']]);
        assert.equal(await desktop.locator('#move-count').innerText(), '1 move');
        await noOverflow(desktop);
        await desktop.locator('#restart').click();
      }
    }
    console.log(`Desktop: all ${LEVELS.length} campaign levels completed with progressive rules; final two Best known benchmarks, free 100-slot spacing, compaction, replay/undo/reset/share verified`);
    await customBuilder(desktop);
    await desktop.locator('#mode-daily').click();
    await desktop.locator('#daily-heading:not([hidden])').waitFor();
    assert.equal(await desktop.locator('#custom-json-actions').isVisible(), false, 'Daily mode hides JSON exchange');
    await fullRulePalette(desktop);
    assert.ok(await desktop.locator('.circuit-cell').count() >= 30);
    await screenshot(desktop, 'desktop-daily.png');
    {
      const data = api ? await (await desktop.request.get(`${api}/api/daily?game=circuit-reduction`)).json() : fixture.getDaily('circuit-reduction');
      const puzzle = dailyPuzzle(data.date);
      assert.ok(puzzle.optimalMoves >= 10 && puzzle.optimalMoves <= 14);
      const replaySteps = await finish(desktop, puzzle.solution, puzzle);
      await registerScore(desktop, 'Desktop test');
      await desktop.locator('#close-win').click();
      await desktop.locator('#replay').click();
      await desktop.locator('#review-note').filter({ hasText: `Step ${replaySteps} / ${replaySteps}` }).waitFor({ timeout: Math.max(20000, replaySteps * 800) });
      await desktop.locator('#resume-round').click();
      console.log(`Daily: certified ${puzzle.optimalMoves}-move puzzle solved and score accepted through ${scoreTransport}`);
    }
    await screenshot(desktop, 'desktop-daily-completed.png');
  }

  const mobile = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await noOverflow(mobile);
  await mobileBoardLayout(mobile);
  await columnSpacing(mobile);
  const cellSize = await mobile.locator('.circuit-cell').first().boundingBox();
  assert.ok(cellSize.width >= 44 && cellSize.height >= 44, 'Touchable cells are at least44px');
  await screenshot(mobile, 'mobile.png');
  await addSpace(mobile, 0, 1, 1);
  beforeRemoval = await boardCircuit(mobile);
  await removeSpace(mobile, 0, 1);
  assert.deepEqual(await boardCircuit(mobile), applyMove(beforeRemoval, { rule: 'remove-space', row: 0, column: 1 }), 'Holding an identity removes it through touch input');
  assert.equal(await mobile.locator('[data-cell][aria-pressed="true"]').count(), 0, 'Touch removal does not also select a rule window');
  assert.equal(await mobile.locator('#move-count').innerText(), '0 moves');
  await mobile.locator('#restart').click();
  await finish(mobile, LEVELS[0].solution); await mobile.locator('#close-win').click();
  await downloadReplay(mobile);
  for (const lesson of [15, 20, 22].map(id => LEVELS.find(level => level.id === id))) {
    console.log(`Mobile: playing campaign level ${lesson.id}`);
    await mobile.locator('#level').selectOption(String(lesson.id));
    await noOverflow(mobile);
    if (lesson.id === 22) await screenshot(mobile, 'mobile-advanced.png');
    await finish(mobile, lesson.solution, lesson);
    await activate(mobile, mobile.locator('#close-win'));
  }
  await customBuilder(mobile);
  await mobile.locator('#mode-daily').click(); await mobile.locator('#daily-heading:not([hidden])').waitFor(); await noOverflow(mobile);
  assert.equal(await mobile.locator('#custom-json-actions').isVisible(), false, 'Daily mode hides JSON exchange');
  await fullRulePalette(mobile);
  await screenshot(mobile, 'mobile-daily.png');
  {
    const info = api ? await (await mobile.request.get(`${api}/api/daily?game=circuit-reduction`)).json() : fixture.getDaily('circuit-reduction');
    const puzzle = dailyPuzzle(info.date);
    assert.ok(puzzle.optimalMoves >= 10 && puzzle.optimalMoves <= 14);
    await finish(mobile, puzzle.solution, puzzle);
    await registerScore(mobile, 'Mobile test'); await mobile.locator('#close-win').click();
    console.log(`Mobile daily: solved through touch input and score accepted through ${scoreTransport}`);
  }
  await screenshot(mobile, 'mobile-daily-completed.png');
  await boardSizing(mobile, true);
  for (const width of [320, 768]) { await mobile.setViewportSize({ width, height: 900 }); await noOverflow(mobile); await fullRulePalette(mobile); }
  await mobile.setViewportSize({ width: 390, height: 844 });
  console.log('Mobile: three complex PDF missions completed using touch, advanced commutation, Hadamard changes of basis, identity spacing, daily horizontal scrolling and responsive page layout verified');
  for (const page of [desktop, mobile].filter(Boolean)) {
    await page.goto(`${base}/games/quantum-golf/`); await activate(page, page.locator('#mode-campaign')); await page.locator('#gate-t').waitFor();
    await noOverflow(page); await page.locator('#gate-t').click(); await page.locator('#win-dialog[open]').waitFor();
    await page.waitForFunction(() => document.getElementById('score-status').textContent !== 'Saving…');
    assert.match(await page.locator('#win-summary').innerText(), /Optimal solution in 1 move/);
    await activate(page, page.locator('#close-win'));
    await openDetails(page, '#advanced-features');
    await downloadReplay(page);
    await golfCustomJson(page);
  }
  console.log(`Golf: ${desktop ? 'desktop/mobile' : 'mobile'} winning gate, shared overlays and lazy replay downloads verified`);
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  }
} finally { await browser.close(); }
