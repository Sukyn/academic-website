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

async function categoryNavigation(page, kind, profile) {
  const path = kind === 'signals' ? '/games/quantum-signals/' : '/games/circuit-reduction/';
  const category = page.locator('#circuit-category');
  const selected = () => category.evaluate(select => select.selectedOptions[0].dataset.category);
  if (profile === 'prop') {
    await page.goto(base + path);
    await page.locator(kind === 'signals' ? '#signal-board button' : '#circuit-board button').first().waitFor();
    assert.equal(await selected(), 'pro');
    assert.equal(await page.locator('#mode-daily').count(), 1, 'The basic PRO version retains daily puzzles');
    assert.equal(await category.evaluate(select => Boolean(select.closest('.mode-menu')) && Boolean(
      document.getElementById('mode-daily').compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING)), true,
    'Category follows Daily Puzzle in the basic mode menu');
    await Promise.all([page.waitForURL(base + path + 'advanced/'), category.selectOption({ label: 'PROP' })]);
  } else {
    // Unknown query values retain PROP; only the explicit controlled value opts in.
    await page.goto(base + path + 'advanced/?profile=unknown');
    await page.locator('#categorical-board [data-cell]').first().waitFor();
    assert.equal(await selected(), 'prop');
    assert.equal(await page.locator('#level option').count(), getLevels('prop', kind).length);
    await Promise.all([page.waitForURL(base + path + 'advanced/?profile=controlled'),
      category.selectOption({ label: 'Controlled PROP' })]);
  }
  await page.locator('#categorical-board [data-cell]').first().waitFor();
  assert.deepEqual(await category.locator('option').allTextContents(), ['PRO', 'PROP', 'Controlled PROP']);
  assert.equal(await selected(), profile);
  assert.equal(await category.evaluate(select => Boolean(select.closest('.mode-menu')) && Boolean(
    document.getElementById('mode-random').compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING)), true,
  'Category follows Custom/Random in the advanced mode menu');
  assert.equal(await page.locator('#mode-daily').count(), 0, 'Advanced categories have no daily puzzles');
  assert.equal(await page.locator('#level option').count(), getLevels(profile, kind).length);
  if (kind === 'signals') {
    assert.equal(await page.locator('#autofocus').evaluate(button => button.closest('#advanced-features') !== null), true,
      'Autofocus belongs to Advanced');
    assert.equal(await page.locator('#autofocus').isVisible(), false);
    assert.equal(await page.locator('#autofocus').getAttribute('aria-pressed'), 'false');
  }
  assert.equal(await category.locator('[data-category="pro"]').getAttribute('value'), path);
  if (profile === 'controlled') {
    await page.reload();
    await page.locator('#categorical-board [data-cell]').first().waitFor();
    assert.equal(await selected(), 'controlled');
    assert.equal(await page.locator('#level option').count(), getLevels('controlled', kind).length);
  }
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

const activeHole = page => page.locator('#categorical-board [data-hole][aria-pressed="true"]').first().getAttribute('data-hole');

async function backdropCheck(page, tap, mobile) {
  const before = await page.locator('#categorical-board').innerHTML();
  await tap(page.locator('#show-rules'));
  assert.equal(await page.locator('#rules-dialog').evaluate(dialog => dialog.open), true);
  await page.keyboard.press('r');
  assert.equal(await page.locator('#categorical-board').innerHTML(), before, 'An open shared overlay protects the current round from shortcuts');
  const bounds = await page.locator('#rules-dialog').boundingBox();
  assert.ok(bounds.x > 1 || bounds.y > 1, 'The overlay leaves a clickable backdrop');
  if (mobile) await page.touchscreen.tap(1, 1); else await page.mouse.click(1, 1);
  assert.equal(await page.locator('#rules-dialog').evaluate(dialog => dialog.open), false, 'Shared backdrop behavior closes the rules');
}

async function reviewShortcutCheck(page, tap, kind) {
  if (!await page.locator('#advanced-features').evaluate(details => details.open)) await tap(page.locator('#advanced-features > summary'));
  await tap(page.locator('#replay'));
  await page.locator('#review-controls').waitFor({ state: 'visible' });
  const total = Number((await page.locator('#review-note').innerText()).match(/\/ (\d+)$/)?.[1]);
  assert.ok(total > 0);
  await page.waitForFunction(total => document.getElementById('review-note').textContent === `Step ${total} / ${total}`, total);
  const before = await page.locator('#categorical-board').innerHTML();
  await page.locator('#categorical-scroll').focus();
  await page.keyboard.press(kind === 'signals' ? 'H' : 'Enter');
  assert.equal(await page.locator('#categorical-board').innerHTML(), before, 'Replay inspection blocks gate and rule shortcuts');
  await page.keyboard.press('Backspace');
  assert.equal(await page.locator('#review-controls').isVisible(), false, 'Undo leaves replay review and restores the preceding live state');
}

async function signalShortcutParity(page, tap, mobile) {
  await page.locator('#level').selectOption('2');
  assert.equal(await page.locator('#autofocus').getAttribute('aria-pressed'), 'false');
  const target = await page.locator('#signal-target').innerHTML();
  const path = await page.locator('.signal-flow-path').first().elementHandle();
  await tap(page.locator('#categorical-board [data-hole="1"]').first());
  assert.equal(await path.evaluate(node => node.isConnected), true, 'Selecting a hole preserves the existing path nodes');
  await tap(page.locator('#categorical-board [data-hole="0"]').first());
  assert.equal(await path.evaluate(node => node.isConnected), true);
  await path.dispose();
  await page.locator('#restart').focus();
  await page.keyboard.press('H');
  assert.equal(await page.locator('#undo').isDisabled(), true, 'Gate keys outside the circuit or palette do not edit it');
  const first = () => page.locator('#categorical-board [data-hole="0"]').first();
  const placeSwap = async () => { await first().focus(); await page.keyboard.press('2'); };
  await placeSwap();
  assert.equal(await activeHole(page), '0', 'Autofocus stays off while trying gates');
  assert.equal(await page.locator('#categorical-board .categorical-swap-path').count(), 2, 'Numeric shortcuts use visible palette order');
  await page.keyboard.press('Control+Shift+z');
  assert.equal(await page.locator('#categorical-board .categorical-swap-path').count(), 2, 'Redo modifiers do not trigger undo');
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('#categorical-board .categorical-swap-path').count(), 0);
  await placeSwap(); await page.keyboard.press('Meta+z');
  assert.equal(await page.locator('#categorical-board .categorical-swap-path').count(), 0);
  await placeSwap(); await first().focus(); await page.keyboard.press('Delete');
  assert.equal(await page.locator('#categorical-board .categorical-swap-path').count(), 0);
  assert.equal(await page.locator('#erase-gate').isVisible(), false, 'Delete unsets the placement instead of storing an explicit identity');
  if (!mobile) {
    await placeSwap(); await first().click({ button: 'right' });
    assert.equal(await page.locator('#erase-gate').isVisible(), false, 'Right-click clears the selected hole');
  }
  await tap(page.locator('#restart'));
  await first().focus(); await page.keyboard.press('ArrowRight');
  assert.equal(await activeHole(page), '1');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await activeHole(page), '0');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('H');
  assert.equal(await page.locator('#categorical-board [data-hole="1"]').first().getAttribute('data-filled'), 'true');
  assert.equal(await page.locator('#signal-target').innerHTML(), target, 'Selections, attempted gates and undo never replace the target');
  await backdropCheck(page, tap, mobile);
  await reviewShortcutCheck(page, tap, 'signals');
  await page.locator('#categorical-scroll').focus(); await page.keyboard.press('R');
  assert.equal(await page.locator('#undo').isDisabled(), true);
  assert.equal(await page.locator('#categorical-board [data-hole][data-filled="true"]').count(), 0);
  assert.equal(await page.locator('#signal-target').innerHTML(), target);
  await tap(page.locator('#autofocus'));
  await placeSwap();
  assert.equal(await activeHole(page), '1', 'Opting into Autofocus selects the next unfilled hole');
  await tap(page.locator('#autofocus'));
  assert.equal(await page.locator('#autofocus').getAttribute('aria-pressed'), 'false');
  await page.locator('#categorical-scroll').focus(); await page.keyboard.press('r');
}

async function signalAnimationParity(page, tap) {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  try {
    await page.locator('#level').selectOption('2');
    await tap(page.locator('#categorical-board [data-hole="1"]').first());
    const target = await page.locator('#signal-target').innerHTML();
    await page.locator('#categorical-board [data-hole="1"]').first().focus();
    await page.keyboard.press('H');
    await page.waitForFunction(() => document.getElementById('signal-flow').dataset.flowAnimating === 'true');
    // Replace the gate and select another hole in one task, exercising rapid
    // edits without making correctness depend on browser automation latency.
    const during = await page.evaluate(() => {
      const flow = document.getElementById('signal-flow');
      document.querySelector('#gate-palette [data-choice="Z"]').click();
      const path = flow.querySelector('.signal-flow-path');
      const animating = flow.dataset.flowAnimating, busy = flow.getAttribute('aria-busy');
      const ghosts = flow.querySelectorAll('.signal-flow-ghost').length;
      document.querySelector('#categorical-board [data-hole="0"]').click();
      return { animating, busy, ghosts, preserved: path.isConnected && flow.contains(path) };
    });
    assert.equal(during.animating, 'true'); assert.equal(during.busy, 'true');
    assert.ok(during.ghosts > 0, 'The shared animation displays old paths while their replacements appear');
    assert.equal(during.preserved, true, 'Selecting a hole during animation preserves the live path nodes');
    assert.equal(await activeHole(page), '0');
    assert.equal(await page.locator('#erase-gate').isVisible(), false, 'Replacing a later gate leaves earlier holes unfilled');
    assert.equal(await page.locator('#signal-target').innerHTML(), target);
    await page.waitForFunction(() => !document.getElementById('signal-flow').hasAttribute('data-flow-animating'));
    assert.equal(await page.locator('.signal-flow-ghost').count(), 0);
    assert.equal(await page.locator('#signal-flow').getAttribute('aria-busy'), null);
    await tap(page.locator('#categorical-board [data-hole="1"]').first());
    await page.locator('#categorical-board [data-hole="1"]').first().focus();
    await page.keyboard.press('H');
    await page.waitForFunction(() => document.getElementById('signal-flow').dataset.flowAnimating === 'true');
    await page.keyboard.press('R');
    assert.equal(await page.locator('.signal-flow-ghost').count(), 0, 'Reset cancels and removes the active transition');
    assert.equal(await page.locator('#signal-flow').getAttribute('aria-busy'), null);
    assert.equal(await page.locator('#signal-flow').getAttribute('data-flow-animating'), null);
    assert.equal(await page.locator('#undo').isDisabled(), true);
    assert.equal(await page.locator('#signal-target').innerHTML(), target);
  } finally { await page.emulateMedia({ reducedMotion: 'reduce' }); }
}

async function simplificationShortcutParity(page, tap, mobile) {
  await page.locator('#level').selectOption('1');
  await tap(page.locator('#tidy')); await tap(page.locator('#tidy'));
  assert.equal(await page.locator('#undo').isDisabled(), true, 'Repeated Tidy on a compact circuit does not create undo entries');
  assert.equal(await page.locator('#replay').isVisible(), false, 'No-op Tidy does not create a replay');
  assert.equal(await page.locator('#move-count').innerText(), '0 moves');
  await tap(page.locator('#add-space')); await tap(page.locator('#tidy'));
  await tap(page.locator('#tidy')); await tap(page.locator('#tidy'));
  assert.equal(await page.locator('#undo').isDisabled(), false);
  if (!await page.locator('#advanced-features').evaluate(details => details.open)) await tap(page.locator('#advanced-features > summary'));
  await tap(page.locator('#replay'));
  assert.match(await page.locator('#review-note').innerText(), /\/ 2$/, 'Only the added and removed column belong in the replay');
  await page.waitForFunction(() => document.getElementById('review-note').textContent === 'Step 2 / 2');
  assert.equal(await page.locator('#move-count').innerText(), '0 moves');
  await tap(page.locator('#resume-round'));
  await tap(page.locator('#add-space'));
  const expanded = await page.locator('#categorical-board [data-cell]').count();
  await backdropCheck(page, tap, mobile);
  await page.locator('#categorical-scroll').focus(); await page.keyboard.press('r');
  assert.ok(await page.locator('#categorical-board [data-cell]').count() < expanded, 'R resets the actual circuit layout');
  if (mobile) return;
  const select = async () => {
    await tap(await boardCells(page, 0, 0));
    await page.keyboard.down('Shift');
    try { await tap(await boardCells(page, 1, 1)); } finally { await page.keyboard.up('Shift'); }
  };
  await select();
  assert.equal(await page.locator('#categorical-board [aria-pressed="true"]').count(), 4, 'Shift-click shares rectangular selection with the basic game');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#categorical-board [aria-pressed="true"]').count(), 0);
  await select(); await page.keyboard.press('Enter');
  await closeWin(page, tap);
  await reviewShortcutCheck(page, tap, 'simplification');
  assert.equal(await page.locator('#categorical-board [data-role="target"]').count(), 4);
  assert.equal(await page.locator('#move-count').innerText(), '0 moves');
}

async function mobileSignalViewport(page, tap, profile) {
  const levels = getLevels(profile, 'signals');
  await page.locator('#level').selectOption(String(levels.length));
  const target = await page.locator('#signal-target').boundingBox();
  const synchronized = () => page.waitForFunction(() => Math.abs(document.getElementById('categorical-scroll').scrollLeft - document.getElementById('flow-scroll').scrollLeft) <= 1);
  await page.locator('#flow-scroll').evaluate(node => { node.scrollLeft = node.scrollWidth; });
  await synchronized();
  assert.ok(await page.locator('#flow-scroll').evaluate(node => node.scrollLeft) > 0, 'Long mobile circuits can scroll');
  assert.equal((await page.locator('#signal-target').boundingBox()).x, target.x);
  await page.locator('#categorical-scroll').evaluate(node => { node.scrollLeft = 0; });
  await synchronized();
  await tap(page.locator('#categorical-board [data-hole="0"]').first());
  const path = await page.locator('.signal-flow-path').first().elementHandle();
  const last = levels.at(-1).holes.length - 1;
  await tap(page.locator(`#categorical-board [data-hole="${last}"]`).first());
  await synchronized();
  assert.equal(await activeHole(page), String(last));
  assert.equal(await path.evaluate(node => node.isConnected), true, 'Mobile navigation preserves the path diagram');
  await path.dispose();
  const marker = await page.locator('.signal-flow-selection').boundingBox(), viewport = await page.locator('#flow-scroll').boundingBox();
  assert.ok(marker.x < viewport.x + viewport.width && marker.x + marker.width > viewport.x, 'The selected column is visible in the expanded paths');
  assert.equal((await page.locator('#signal-target').boundingBox()).x, target.x);
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

async function multiHoleReplay(page, tap, source) {
  const padded = { ...source, columns: [...source.columns, ...Array.from({ length: 8 }, () => [])] };
  const last = padded.holes.length - 1;
  await importJson(page, tap, padded);
  await tap(page.locator('#categorical-board [data-hole="0"]').first());
  await tap(page.locator('#gate-palette [data-choice="I"]'));
  await tap(page.locator(`#categorical-board [data-hole="${last}"]`).first());
  await tap(page.locator('#gate-palette [data-choice="I"]'));
  await tap(page.locator('#categorical-board [data-hole="0"]').first());
  await tap(page.locator('#erase-gate'));
  await tap(page.locator(`#categorical-board [data-hole="${last}"]`).first());
  if (!await page.locator('#advanced-features').evaluate(details => details.open)) await tap(page.locator('#advanced-features > summary'));
  await page.evaluate(() => {
    const entries = [], note = document.getElementById('review-note');
    const observer = new MutationObserver(() => {
      const match = note.textContent.match(/^Step (\d+) \/ /);
      if (!match) return;
      const marker = document.querySelector('.signal-flow-selection'), bounds = marker?.getBoundingClientRect();
      const viewport = document.getElementById('flow-scroll').getBoundingClientRect();
      entries.push({ step: Number(match[1]), hole: document.querySelector('#categorical-board [data-hole][aria-pressed="true"]')?.dataset.hole,
        column: Number(marker?.dataset.column), visible: Boolean(bounds && bounds.left < viewport.right && bounds.right > viewport.left) });
    });
    observer.observe(note, { childList: true, characterData: true, subtree: true });
    window.__replayAudit = { entries, stop: () => observer.disconnect() };
  });
  await tap(page.locator('#replay'));
  await page.waitForFunction(() => document.getElementById('review-note').textContent === 'Step 3 / 3');
  const observations = await page.evaluate(() => {
    const { entries, stop } = window.__replayAudit; stop(); delete window.__replayAudit; return entries;
  });
  const byStep = new Map(observations.map(entry => [entry.step, entry]));
  for (const [step, hole] of [[0, 0], [1, 0], [2, last], [3, 0]]) {
    const observation = byStep.get(step);
    assert.ok(observation, `Replay step ${step} was observed`);
    assert.equal(observation.hole, String(hole), 'Replay highlights the hole changed in that snapshot');
    assert.equal(observation.column, padded.columns.length + hole);
    assert.equal(observation.visible, true, 'Replay follows the changed column even on narrow screens');
  }
  await tap(page.locator('#resume-round'));
  assert.equal(await activeHole(page), String(last), 'Replay does not overwrite the live hole selection');
  const marker = await page.locator('.signal-flow-selection').boundingBox(), viewport = await page.locator('#flow-scroll').boundingBox();
  assert.ok(marker.x < viewport.x + viewport.width && marker.x + marker.width > viewport.x,
    'Returning to live play follows its restored selection');
  await importJson(page, tap, source);
}

async function invalidImports(page, tap, kind) {
  const board = await page.locator('#categorical-board').innerHTML();
  const invalid = ['{', '[]', '{"wires":999999999,"columns":[]}',
    '{"wires":2,"columns":[[{"gate":"<img src=x onerror=alert(1)>","wires":[0]}]]}'];
  const nonAdjacentSwap = { wires: 3, columns: [[{ gate: 'SWAP', wires: [0, 2] }]] };
  invalid.push(JSON.stringify(kind === 'signals' ? { ...nonAdjacentSwap,
    holes: [{ wires: [0], choices: ['I', 'X'] }], targetCircuit: { wires: 3, columns: [[]] } } : nonAdjacentSwap));
  if (kind === 'signals') invalid.push(JSON.stringify({ wires: 4, columns: Array.from({ length: 24 }, () =>
    Array.from({ length: 4 }, (_, wire) => ({ gate: 'X', wires: [wire] }))),
    holes: [{ wires: [0], choices: ['I', 'H'] }], targetCircuit: { wires: 4, columns: [[]] } }));
  for (const source of invalid) {
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

async function propWholeGateHoles(page, tap, source) {
  const prefix = [[{ gate: 'H', wires: [0] }], [{ gate: 'X', wires: [2] }]];
  const choices = ['I', 'CX', 'XC', 'CZ', 'SWAP'];
  const custom = { wires: 3, columns: prefix,
    holes: [{ wires: [0, 1], choices }, { wires: [1, 2], choices }],
    targetCircuit: { wires: 3, columns: [...prefix,
      [{ gate: 'X', wires: [1], controls: [0] }], [{ gate: 'Z', wires: [2], controls: [1] }]] } };
  await importJson(page, tap, custom);
  assert.equal(await page.locator('#categorical-board [data-placeholder]').count(), 0,
    'PROP holes contain whole gates without a fixed control placeholder');
  assert.equal(await page.locator('#categorical-board [data-role="control"]').count(), 0);
  assert.equal(await page.locator('#categorical-board [data-hole]').count(), 4, 'Each paired hole has two selectable endpoints');
  assert.equal(await page.locator('#categorical-board [data-hole-context]').count(), 0);
  for (const gate of ['CX', 'XC', 'CZ']) {
    const button = page.locator(`#gate-palette [data-choice="${gate}"]`);
    assert.equal(await button.locator(':scope > svg > line').count(), 1, `${gate} shows its complete control link`);
    assert.equal(await button.locator(':scope > svg > circle').count(), 1, `${gate} shows its control dot`);
    assert.equal(await button.locator(':scope > svg > svg').count(), 1, `${gate} shows its target`);
  }
  const target = await page.locator('#signal-target').innerHTML();
  await page.locator('#gate-palette [data-choice="SWAP"]').focus();
  await page.keyboard.press('Digit5');
  assert.equal(await page.locator('#gate-palette [data-choice="SWAP"]').getAttribute('aria-pressed'), 'true',
    'The fifth whole-gate choice has a working keyboard shortcut');
  assert.equal(await page.locator('#categorical-board .categorical-swap-path').count(), 2);
  await page.keyboard.press('Digit1');
  await tap(page.locator('#gate-palette [data-choice="XC"]'));
  assert.equal(await page.locator('#categorical-board [data-cell="1:2"]').getAttribute('data-role'), 'control');
  assert.equal(await page.locator('#categorical-board [data-cell="0:2"]').getAttribute('data-role'), 'target');
  await tap(page.locator('#gate-palette [data-choice="CX"]'));
  assert.equal(await page.locator('#categorical-board [data-cell="0:2"]').getAttribute('data-role'), 'control');
  assert.equal(await page.locator('#categorical-board [data-cell="1:2"]').getAttribute('data-role'), 'target');
  await tap(page.locator('#categorical-board [data-hole="1"]').last());
  await tap(page.locator('#gate-palette [data-choice="CZ"]'));
  await closeWin(page, tap);
  assert.equal(await page.locator('#signal-target').getAttribute('data-match'), 'true');
  assert.equal(await page.locator('#signal-target').innerHTML(), target, 'Whole-gate choices keep the target fixed');
  assert.deepEqual(await exported(page, tap), custom, 'Whole-gate JSON stays compact and preserves choices');
  await importJson(page, tap, source);
}

async function editorCheck(page, tap, kind, profile, checkDimensions = false, keyboard = false) {
  await tap(page.locator('#new-circuit'));
  assert.equal(await page.locator('#editor-controls').isVisible(), true);
  if (kind === 'signals') {
    const choose = async (tool, wire, column) => {
      await tap(page.locator(`[data-editor-tool="${tool}"]`));
      await tap(await boardCells(page, wire, column));
    };
    await choose('SWAP', 0, 0);
    await tap(await boardCells(page, 2, 0));
    assert.match(await page.locator('#status').innerText(), /consecutive wires/);
    assert.equal(await page.locator('#categorical-board .categorical-swap-path').count(), 0,
      'The editor rejects a crossing over an unrelated wire');
    await tap(await boardCells(page, 1, 0));
    assert.equal(await page.locator('#categorical-board .categorical-swap-path').count(), 2,
      'The pending crossing can still connect to its neighbouring wire');
    await choose('erase', 0, 0);
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
    assert.deepEqual(custom.holes[0].wires, profile === 'controlled' ? [1] : [0, 1]);
    assert.deepEqual(custom.holes[0].controls, profile === 'controlled' ? [0] : undefined);
    assert.deepEqual(custom.holes[0].choices, profile === 'controlled' ? ['I', 'H', 'X', 'Z'] : ['I', 'CX', 'XC', 'CZ']);
    await tap(page.locator('#play-custom'));
    assert.equal(await page.locator('#editor-controls').isVisible(), false);
    const targetBefore = await page.locator('#signal-target').innerHTML();
    await tap(page.locator('#categorical-board [data-hole="0"]').first());
    await tap(page.locator(`#gate-palette [data-choice="${profile === 'controlled' ? 'Z' : 'CZ'}"]`));
    assert.equal(await page.locator('#signal-target').innerHTML(), targetBefore, 'Trying another gate keeps target markers fixed');
    await tap(page.locator(`#gate-palette [data-choice="${profile === 'controlled' ? 'H' : 'CX'}"]`));
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
    if (keyboard) {
      await page.keyboard.press('Control+z');
      assert.equal(await page.locator('#editor-controls').isVisible(), true);
      assert.equal(await page.locator('#categorical-board [data-role="target"]').count(), 0, 'Ctrl+Z also undoes reverse equations during construction');
      assert.equal(await page.locator('#move-count').innerText(), '0 moves');
      for (const key of selectionCells(move, { profile })) await tap(page.locator(`#categorical-board [data-cell="${key}"]`));
      await tap(page.locator('#rule-list [data-rule="cancel-z"]'));
    }
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
      await categoryNavigation(page, kind, profile);
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
        const fixedSwaps = (level.circuit?.columns ?? level.columns).flat().filter(operation => operation.gate === 'SWAP').length;
        assert.equal(await page.locator('#categorical-board .categorical-swap-path').count(), fixedSwaps * 2,
          'Every fixed SWAP draws two crossed wire paths');
        if (kind === 'simplification' && index === (profile === 'controlled' ? 7 : 2)) {
          await page.screenshot({ path: resolve(output, label + '-crossings.png'), fullPage: true });
        }
        await solve(page, tap, level, kind, profile);
        if (kind === 'signals' && index === (profile === 'controlled' ? 6 : 0)) {
          await tap(page.locator('#categorical-board [data-hole="0"]').first());
          assert.ok(await page.locator('#categorical-board .categorical-swap-path').count() > 0);
          assert.equal(await page.locator('#gate-palette .categorical-swap-path').count(), 2,
            'The SWAP palette uses the same crossed wires as the board');
          await page.screenshot({ path: resolve(output, label + '-crossings.png'), fullPage: true });
        }
        if (index === 0) await replayCheck(page, tap, kind);
      }
      if (name === 'desktop') await desktopInputCheck(page, tap, kind, profile);
      if (kind === 'signals') {
        await signalShortcutParity(page, tap, name === 'mobile');
        if (name === 'mobile') await mobileSignalViewport(page, tap, profile);
        else await signalAnimationParity(page, tap);
      } else await simplificationShortcutParity(page, tap, name === 'mobile');
      await tap(page.locator('#mode-random'));
      const random = kind === 'signals' ? generateSignals(profile, { seed, difficulty: 2 }) : randomIdentity(profile, { seed, difficulty: 2 });
      const shared = await exported(page, tap);
      await importJson(page, tap, shared);
      assert.deepEqual(await exported(page, tap), shared, 'JSON round trips without extra metadata');
      if (kind === 'signals') await multiHoleReplay(page, tap, shared);
      if (kind === 'signals' && profile === 'prop') await propWholeGateHoles(page, tap, shared);
      await solve(page, tap, random, kind, profile);
      await tap(page.locator('#restart'));
      await invalidImports(page, tap, kind);
      if (name === 'desktop' && kind === 'signals' && profile === 'prop') await rejectedEditorKeepsPuzzle(page, tap, shared);
      if (kind === 'simplification' && profile === 'controlled') await differentControlContexts(page, tap);
      await editorCheck(page, tap, kind, profile, name === 'desktop' && profile === 'prop' && kind === 'simplification', name === 'desktop');
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
      const basicPath = kind === 'signals' ? '/games/quantum-signals/' : '/games/circuit-reduction/';
      await Promise.all([page.waitForURL(base + basicPath),
        page.locator('#circuit-category').selectOption({ label: 'PRO' })]);
      await page.locator(kind === 'signals' ? '#signal-board button' : '#circuit-board button').first().waitFor();
      assert.equal(await page.locator('#circuit-category').evaluate(select => select.selectedOptions[0].dataset.category), 'pro');
      assert.equal(await page.locator('#mode-daily').count(), 1, 'Returning to PRO restores the basic daily menu');
      assert.equal(await page.locator('#mode-tutorial').getAttribute('aria-pressed'), 'true');
      reports.push({ label, tutorial: tutorial.steps.length, levels: levels.length, status: 'passed' });
      console.log(`${label}: category navigation, tutorial, ${levels.length} named levels, random, JSON, invalid inputs, editor, fixed target and layout passed.`);
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
