// Real pointer/touch checks. Advanced variants must never contact daily or score APIs.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { selectionCells } from '../../src/lib/categorical-circuits/engine.js';
import { getLevels, getTutorial, randomIdentity, generateSignals } from '../../src/lib/categorical-circuits/puzzles.js';

const require = createRequire(resolve(process.env.PLAYWRIGHT_MODULE_DIR ?? 'tmp/quality-tools/node_modules', 'package.json'));
const qualityRequire = createRequire(resolve(process.env.QUALITY_MODULE_DIR ?? 'tmp/quality-tools/node_modules', 'package.json'));
const { chromium } = require('playwright');
let axeSource;
try { axeSource = await readFile(qualityRequire.resolve('axe-core/axe.min.js'), 'utf8'); }
catch (error) { if (error.code !== 'MODULE_NOT_FOUND' && error.code !== 'ENOENT') throw error; }
const base = process.env.GAME_BASE_URL ?? 'http://127.0.0.1:4323';
const output = resolve('tmp/categorical-circuits-browser');
const seed = 'categorical-browser-quality';
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {}) });
const errors = [], apiRequests = [], reports = [];
await mkdir(output, { recursive: true });

async function fits(page) {
  const dimensions = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth }));
  assert.ok(dimensions.document <= dimensions.width + 1, JSON.stringify(dimensions));
}

async function boardCells(page, wire, column) {
  return page.locator(`#categorical-board [data-cell="${wire}:${column}"]`);
}

async function closeWin(page, tap) {
  await page.waitForFunction(() => document.getElementById('win-dialog').open);
  await tap(page.locator('#close-win'));
}

async function replayCheck(page, tap, kind) {
  if (!await page.locator('#advanced-features').evaluate(details => details.open)) {
    await tap(page.locator('#advanced-features > summary'));
  }
  await tap(page.locator('#replay'));
  await page.locator('#review-controls').waitFor({ state: 'visible' });
  const note = await page.locator('#review-note').innerText();
  const count = Number(note.match(/\/ (\d+)$/)?.[1]);
  assert.ok(count >= 1);
  await page.waitForFunction(total => document.getElementById('review-note').textContent === `Step ${total} / ${total}`, count);
  assert.equal(await page.locator('#win-dialog').evaluate(dialog => dialog.open), false, 'A replay does not open a new result');
  if (kind === 'signals') assert.equal(await page.locator('#signal-target').getAttribute('data-match'), 'true');
  else assert.equal(await page.locator('#categorical-board [data-role="target"]').count(), 0);
  await tap(page.locator('#resume-round'));
  assert.equal(await page.locator('#review-controls').isVisible(), false);
}

async function solve(page, tap, puzzle, kind, profile) {
  if (kind === 'signals') {
    const filled = new Set();
    for (const [index, gate] of puzzle.solution.entries()) {
      if (await page.locator('#signal-target').getAttribute('data-match') === 'true' &&
          puzzle.holes.every((hole, index) => hole.choices.includes('I') || filled.has(index))) break;
      if (gate === 'I') continue;
      await tap(page.locator(`#categorical-board [data-hole="${index}"]`).first());
      await tap(page.locator(`#gate-palette [data-choice="${gate}"]`));
      filled.add(index);
    }
    assert.equal(await page.locator('#signal-target').getAttribute('data-match'), 'true');
  } else {
    for (const move of puzzle.solution) {
      // Reaching identity can open results before a witness's final free Tidy.
      // No further operation is needed once every gate has disappeared.
      if (!await page.locator('#categorical-board [data-role="target"]').count()) break;
      if (move.rule === 'tidy') await tap(page.locator('#tidy'));
      else {
        for (const key of selectionCells(move, { profile })) await tap(page.locator(`#categorical-board [data-cell="${key}"]`));
        const rule = page.locator(`#rule-list [data-rule="${move.rule}"]`);
        assert.equal(await rule.isEnabled(), true, `${profile}: ${move.rule} applies to ${JSON.stringify(move)}`);
        await tap(rule);
      }
      assert.equal(await page.locator('#status').innerText(), '', `Move ${move.rule} has no error`);
    }
    assert.equal(await page.locator('#categorical-board [data-role="target"]').count(), 0);
  }
  await closeWin(page, tap);
}

async function desktopInputCheck(page, tap, kind, profile) {
  await page.locator('#level').selectOption('1');
  if (kind === 'signals') {
    await page.locator('#categorical-board [data-hole="0"]').first().focus();
    await page.keyboard.press('Enter');
    await page.locator('#gate-palette [data-choice="SWAP"]').focus();
    await page.keyboard.press('Enter');
    await closeWin(page, tap);
    return;
  }
  const first = await boardCells(page, 0, 0), last = await boardCells(page, 1, 1);
  await first.scrollIntoViewIfNeeded();
  const start = await first.boundingBox(), end = await last.boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 6 });
  await page.mouse.up();
  assert.equal(await page.locator('#categorical-board [aria-pressed="true"]').count(), 4, 'Dragging selects a rectangular gate block');
  assert.equal(await page.locator('#rule-list [data-rule="cancel-swap"]').isEnabled(), true);
  await tap(page.locator('#rule-list [data-rule="cancel-swap"]'));
  await closeWin(page, tap);
  await page.locator('#level').selectOption('1');
  for (const key of selectionCells({ rule: 'cancel-swap', column: 0, wires: [0, 1] }, { profile })) {
    await page.locator(`#categorical-board [data-cell="${key}"]`).focus();
    await page.keyboard.press('Space');
  }
  await page.locator('#rule-list [data-rule="cancel-swap"]').focus();
  await page.keyboard.press('Enter');
  await closeWin(page, tap);
}

async function exported(page, tap) {
  await tap(page.locator('#share-json'));
  assert.equal(await page.locator('#puzzle-json-status').innerText(), '');
  const source = JSON.parse(await page.locator('#puzzle-json-text').inputValue());
  for (const extra of ['id', 'title', 'game', 'version', 'solution']) assert.equal(Object.hasOwn(source, extra), false);
  await tap(page.locator('#puzzle-json-close'));
  return source;
}

async function importJson(page, tap, source) {
  await tap(page.locator('#input-json'));
  await page.locator('#puzzle-json-text').fill(JSON.stringify(source));
  await tap(page.locator('#puzzle-json-apply'));
  assert.equal(await page.locator('#puzzle-json-dialog').evaluate(dialog => dialog.open), false,
    await page.locator('#puzzle-json-status').innerText());
}

async function invalidImports(page, tap) {
  const board = await page.locator('#categorical-board').innerHTML();
  for (const source of ['{', '[]', '{"wires":999999999,"columns":[]}',
    '{"wires":2,"columns":[[{"gate":"<img src=x onerror=alert(1)>","wires":[0]}]]}']) {
    await tap(page.locator('#input-json'));
    await page.locator('#puzzle-json-text').fill(source);
    await tap(page.locator('#puzzle-json-apply'));
    assert.equal(await page.locator('#puzzle-json-dialog').evaluate(dialog => dialog.open), true);
    assert.ok((await page.locator('#puzzle-json-status').innerText()).length > 0);
    await tap(page.locator('#puzzle-json-close'));
    assert.equal(await page.locator('#categorical-board').innerHTML(), board, 'Rejected input preserves the current puzzle');
  }
  await tap(page.locator('#input-json'));
  await page.locator('#puzzle-json-file').setInputFiles({ name: 'too-large.json', mimeType: 'application/json',
    buffer: Buffer.alloc(65_537, 120) });
  await page.waitForFunction(() => document.getElementById('puzzle-json-status').textContent.includes('64 KB'));
  await tap(page.locator('#puzzle-json-close'));
  assert.equal(await page.locator('#categorical-board').innerHTML(), board);
}

async function editorCheck(page, tap, kind, profile, checkDimensions = false) {
  await tap(page.locator('#new-circuit'));
  assert.equal(await page.locator('#editor-controls').isVisible(), true);
  if (kind === 'signals') {
    const choose = async (tool, wire, column) => {
      await tap(page.locator(`[data-editor-tool="${tool}"]`));
      await tap(await boardCells(page, wire, column));
    };
    await choose('H', 0, 0);
    await choose(profile === 'controlled' ? 'H' : 'X', 1, 3);
    await choose('control', 1, 3);
    await tap(page.locator('#play-custom'));
    assert.match(await page.locator('#status').innerText(), /Connect every gate/);
    await tap(await boardCells(page, 0, 3));
    assert.equal(await page.locator('#categorical-board [data-cell="0:3"]').getAttribute('data-role'), 'control');
    await choose('hole', 1, 3);
    await tap(page.locator('#capture-target'));
    const custom = await exported(page, tap);
    assert.equal(Object.hasOwn(custom, 'target'), false, 'Targets export a reference circuit, not floating-point vectors');
    assert.ok(custom.targetCircuit);
    assert.deepEqual(custom.holes[0].controls, [0]);
    assert.deepEqual(custom.holes[0].choices, profile === 'controlled' ? ['I', 'H', 'X', 'Z'] : ['I', 'X', 'Z']);
    await tap(page.locator('#play-custom'));
    assert.equal(await page.locator('#editor-controls').isVisible(), false);
    const targetBefore = await page.locator('#signal-target').innerHTML();
    await tap(page.locator('#categorical-board [data-hole="0"]').first());
    await tap(page.locator('#gate-palette [data-choice="Z"]'));
    assert.equal(await page.locator('#signal-target').innerHTML(), targetBefore, 'Trying another gate keeps target markers fixed');
    await tap(page.locator(`#gate-palette [data-choice="${profile === 'controlled' ? 'H' : 'X'}"]`));
    await closeWin(page, tap);
    assert.equal(await page.locator('#signal-target').getAttribute('data-match'), 'true');
    await tap(page.locator('#edit-circuit'));
    await choose('erase', 1, 3);
    assert.equal(await page.locator('#categorical-board [data-hole]').count(), 0, 'Erase removes a hole through the actual menu');
    await tap(page.locator('#play-custom'));
    assert.ok((await page.locator('#status').innerText()).length > 0, 'An editor without holes cannot start a puzzle');
    await tap(page.locator('#mode-random'));
  } else {
    await page.locator('#reverse-rule').check();
    if (profile === 'controlled') await page.locator('.categorical-context input[value="0"]').check();
    const move = { rule: 'cancel-z', column: 0, wires: [1], reverse: true,
      ...(profile === 'controlled' ? { controls: [0] } : {}) };
    for (const key of selectionCells(move, { profile })) await tap(page.locator(`#categorical-board [data-cell="${key}"]`));
    await tap(page.locator('#rule-list [data-rule="cancel-z"]'));
    assert.equal(await page.locator('#status').innerText(), '');
    if (checkDimensions) {
      const before = await page.locator('#categorical-board').innerHTML();
      await page.locator('#editor-columns').selectOption('5');
      assert.match(await page.locator('#status').innerText(), /Start from scratch/);
      assert.equal(await page.locator('#editor-columns').inputValue(), '6');
      assert.equal(await page.locator('#categorical-board').innerHTML(), before, 'A rejected resize preserves construction');
      await page.locator('#reverse-rule').uncheck();
      await tap(await boardCells(page, 1, 0)); await tap(await boardCells(page, 1, 1));
      await tap(page.locator('#rule-list [data-rule="cancel-z"]'));
      await page.locator('#editor-columns').selectOption('4');
      assert.equal(await page.locator('#undo').isDisabled(), true, 'Resizing empty construction clears its old undo history');
      assert.equal(await page.locator('#move-count').innerText(), '0 moves');
      await page.locator('#reverse-rule').check();
      await tap(await boardCells(page, 1, 0)); await tap(await boardCells(page, 1, 1));
      await tap(page.locator('#rule-list [data-rule="cancel-z"]'));
    }
    const custom = await exported(page, tap);
    assert.equal(custom.columns[0][0].gate, 'Z');
    assert.deepEqual(custom.columns[0][0].controls ?? [], profile === 'controlled' ? [0] : []);
    await tap(page.locator('#play-custom'));
    assert.equal(await page.locator('#editor-controls').isVisible(), false);
    if (profile === 'controlled') {
      await tap(await boardCells(page, 0, 0)); await tap(await boardCells(page, 0, 1));
      assert.equal(await page.locator('#rule-list [data-rule="cancel-z"]').isDisabled(), true,
        'Control dots alone cannot be mistaken for target Z gates');
      await tap(await boardCells(page, 0, 0)); await tap(await boardCells(page, 0, 1));
    }
    await tap(await boardCells(page, 1, 0)); await tap(await boardCells(page, 1, 1));
    assert.equal(await page.locator('#rule-list [data-rule="cancel-z"]').isEnabled(), true,
      'Shared-control cancellation selects only the two target Z cells');
    await tap(page.locator('#rule-list [data-rule="cancel-z"]'));
    await closeWin(page, tap);
    await tap(page.locator('#undo'));
    assert.equal(await page.locator('#categorical-board [data-role="target"]').count(), 2, 'Undo restores both gates');
    await tap(await boardCells(page, 1, 0)); await tap(await boardCells(page, 1, 1));
    await tap(page.locator('#rule-list [data-rule="cancel-z"]'));
    await closeWin(page, tap);
  }
}

async function differentControlContexts(page, tap) {
  await importJson(page, tap, { wires: 3, columns: [0, 1, 0, 1].map(control =>
    [{ gate: 'Z', wires: [2], controls: [control] }]) });
  await tap(await boardCells(page, 2, 0)); await tap(await boardCells(page, 2, 1));
  assert.equal(await page.locator('#rule-list [data-rule="cancel-z"]').isDisabled(), true,
    'Adjacent target Z glyphs cannot cancel when their control contexts differ');
}

async function rejectedEditorKeepsPuzzle(page, tap, source) {
  await importJson(page, tap, { ...source, columns: [...Array.from({ length: 17 }, () => []), ...source.columns] });
  const before = await page.locator('#categorical-board').innerHTML();
  await tap(page.locator('#edit-circuit'));
  assert.match(await page.locator('#status').innerText(), /16 columns/);
  assert.equal(await page.locator('#editor-controls').isVisible(), false, 'An unsupported editor size does not enter editing mode');
  assert.equal(await page.locator('#categorical-board').innerHTML(), before);
  assert.equal(await page.locator('#edit-circuit').isVisible(), true);
  await importJson(page, tap, source);
}

try {
  for (const [name, options] of [
    ['desktop', { viewport: { width: 1440, height: 1000 } }],
    ['mobile', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
  ]) for (const kind of ['simplification', 'signals']) for (const profile of ['prop', 'controlled']) {
    const label = `${name}-${kind}-${profile}`;
    if (process.env.CATEGORICAL_TEST_FILTER && !label.includes(process.env.CATEGORICAL_TEST_FILTER)) continue;
    const context = await browser.newContext({ ...options, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${name}/${kind}/${profile}: ${error.message}`));
    await page.route('**/api/**', route => { apiRequests.push(route.request().url()); return route.abort(); });
    await page.addInitScript(value => { crypto.randomUUID = () => value; }, seed);
    const tap = locator => options.hasTouch ? locator.tap() : locator.click();
    try {
      await page.goto(base + (kind === 'signals' ? '/games/quantum-signals/advanced/' : '/games/circuit-reduction/advanced/'));
      await page.locator('#categorical-board [data-cell]').first().waitFor();
      if (profile !== 'prop') await page.locator('#category-profile').selectOption(profile);
      assert.equal(await page.locator('#mode-daily').count(), 0);
      assert.equal(await page.locator('#leaderboard-section').count(), 0);
      assert.equal(await page.locator('#mode-tutorial').getAttribute('aria-pressed'), 'true');
      await fits(page);
      await tap(page.locator('#tutorial-start'));
      const tutorial = getTutorial(profile, kind);
      for (let index = 0; index < tutorial.steps.length; index++) {
        const current = await page.locator('#tutorial-heading').innerText();
        assert.equal(current, `Step ${index + 1} of ${tutorial.steps.length}`);
        const focus = page.locator('[data-tutorial-focus]');
        assert.equal(await focus.count(), 1);
        if (index % 2) await tap(focus); else await tap(page.locator('#tutorial-next'));
        await page.waitForFunction(({ final, step, count }) => document.getElementById('tutorial-heading').textContent ===
          (final ? 'Tutorial complete' : `Step ${step} of ${count}`),
        { final: index === tutorial.steps.length - 1, step: index + 2, count: tutorial.steps.length });
      }
      assert.equal(await page.locator('#win-dialog').evaluate(dialog => dialog.open), false);
      await tap(page.locator('#tutorial-levels'));
      const levels = getLevels(profile, kind);
      assert.equal(await page.locator('#level option').count(), levels.length);
      for (const [index, level] of levels.entries()) {
        assert.ok((await page.locator(`#level option[value="${index + 1}"]`).innerText()).includes(level.title));
        await page.locator('#level').selectOption(String(index + 1));
        assert.equal(await page.locator('#edit-circuit').isVisible(), false);
        assert.equal(await page.locator('#new-circuit').isVisible(), false);
        await solve(page, tap, level, kind, profile);
        if (index === 0) await replayCheck(page, tap, kind);
      }
      if (name === 'desktop') await desktopInputCheck(page, tap, kind, profile);
      await tap(page.locator('#mode-random'));
      const random = kind === 'signals' ? generateSignals(profile, { seed, difficulty: 2 }) : randomIdentity(profile, { seed, difficulty: 2 });
      const shared = await exported(page, tap);
      await importJson(page, tap, shared);
      assert.deepEqual(await exported(page, tap), shared, 'JSON round trips without extra metadata');
      await solve(page, tap, random, kind, profile);
      await tap(page.locator('#restart'));
      await invalidImports(page, tap);
      if (name === 'desktop' && kind === 'signals' && profile === 'prop') await rejectedEditorKeepsPuzzle(page, tap, shared);
      if (kind === 'simplification' && profile === 'controlled') await differentControlContexts(page, tap);
      await editorCheck(page, tap, kind, profile, name === 'desktop' && profile === 'prop' && kind === 'simplification');
      await fits(page);
      if (kind === 'signals') {
        const initial = await page.locator('#signal-target').boundingBox();
        await page.locator('#flow-scroll').evaluate(node => { node.scrollLeft = node.scrollWidth; });
        const after = await page.locator('#signal-target').boundingBox();
        assert.equal(after.x, initial.x, 'The separate target stays fixed while paths scroll horizontally');
      }
      if (axeSource) {
        await page.evaluate(axeSource);
        const violations = await page.evaluate(async () => (await axe.run(document, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
        })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })));
        assert.deepEqual(violations, [], `${label}: accessibility`);
      }
      await page.screenshot({ path: resolve(output, label + '.png'), fullPage: true });
      reports.push({ label, tutorial: tutorial.steps.length, levels: levels.length, status: 'passed' });
      console.log(`${label}: tutorial, ${levels.length} named levels, random, JSON, invalid inputs, editor, fixed target and layout passed.`);
    } catch (error) {
      await page.screenshot({ path: resolve(output, label + '-failed.png'), fullPage: true }).catch(() => {});
      throw new Error(label + ': ' + error.message, { cause: error });
    } finally { await context.close(); }
  }
  assert.deepEqual(apiRequests, [], 'Advanced games do not request daily puzzles or score endpoints');
  assert.deepEqual(errors, [], 'The advanced games have no uncaught browser errors');
  console.log(JSON.stringify({ surfaces: reports.length, levelsPlayed: reports.reduce((sum, report) => sum + report.levels, 0),
    apiRequests: apiRequests.length, errors: errors.length, reports }, null, 2));
} finally { await browser.close(); }
