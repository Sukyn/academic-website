// Real pointer/touch checks; campaign scores use the real validators with local records.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { selectionCells } from '../../src/lib/categorical-circuits/engine.js';
import { getLevels, getTutorial, randomIdentity, generateSignals, signalsData } from '../../src/lib/categorical-circuits/puzzles.js';
import { createBrowserApi } from '../circuit-reduction/browser-api.mjs';

const require = createRequire(resolve(process.env.PLAYWRIGHT_MODULE_DIR ?? 'tmp/quality-tools/node_modules', 'package.json'));
const qualityRequire = createRequire(resolve(process.env.QUALITY_MODULE_DIR ?? 'tmp/quality-tools/node_modules', 'package.json'));
const { chromium } = require('playwright');
let axeSource;
try { axeSource = await readFile(qualityRequire.resolve('axe-core/axe.min.js'), 'utf8'); }
catch (error) { if (error.code !== 'MODULE_NOT_FOUND' && error.code !== 'ENOENT') throw error; }
const base = process.env.GAME_BASE_URL ?? 'http://127.0.0.1:4323';
const output = resolve('tmp/categorical-circuits-browser');
const seed = 'categorical-browser-quality';
const fixture = createBrowserApi();
const signalInputPuzzle = { wires: 2, columns: [[{ gate: 'H', wires: [0] }]],
  holes: [{ wires: [0, 1], choices: ['I', 'SWAP'] }, { wires: [0], choices: ['I', 'H', 'X', 'Z'] }],
  targetCircuit: { wires: 2, columns: [[{ gate: 'H', wires: [0] }],
    [{ gate: 'SWAP', wires: [0, 1] }], [{ gate: 'X', wires: [0] }]] } };
function swapIdentity(controlled = false) {
  const operation = { gate: 'SWAP', wires: controlled ? [1, 2] : [0, 1], ...(controlled ? { controls: [0] } : {}) };
  return { wires: controlled ? 3 : 2, columns: [[operation], [operation]] };
}
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

async function selectWindow(page, activate, keys) {
  for (const key of keys) {
    const cell = page.locator(`#categorical-board [data-cell="${key}"]`);
    if (await cell.getAttribute('aria-pressed') !== 'true') await activate(cell);
  }
}

async function controllerReadiness(page, tap) {
  const url = base + '/games/circuit-reduction/?category=prop';
  const controller = /\/_astro\/categorical-circuits\.[^/]+\.js$/;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const delay = route => release(route);
  await page.route(controller, delay);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const route = await pending;
    assert.equal(await page.locator('[data-circuit-game]').evaluate(root => root.inert), true,
      'Controls wait until the chosen controller has loaded');
    const heading = await page.locator('#tutorial-heading').innerText();
    const start = await page.locator('#tutorial-start').boundingBox();
    await page.mouse.click(start.x + start.width / 2, start.y + start.height / 2);
    assert.equal(await page.locator('#tutorial-heading').innerText(), heading, 'Pending controls cannot accept a lost tutorial action');
    await route.continue();
    await page.waitForFunction(() => !document.querySelector('[data-circuit-game]').inert);
    await tap(page.locator('#tutorial-start'));
    assert.match(await page.locator('#tutorial-heading').innerText(), /^Step 1 of /, 'The same control works after loading');
  } finally { await page.unroute(controller, delay); }
  const fail = route => route.abort('failed');
  await page.route(controller, fail);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('status').textContent === 'Game unavailable. Reload to try again.');
    assert.equal(await page.locator('[data-circuit-game]').evaluate(root => root.inert), false,
      'A failed import releases the controls and shows a useful error');
  } finally { await page.unroute(controller, fail); }
  await page.reload();
  await page.locator('#categorical-board [data-cell]').first().waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-circuit-game]').inert);
  assert.equal(await page.locator('#status').innerText(), '', 'Reloading recovers from a transient controller failure');
}

async function compactRulePreviews(page) {
  const previews = await page.locator('.categorical-rule-mini').evaluateAll(nodes => nodes.map(node => {
    const cells = [...node.querySelectorAll('[data-cell]')];
    return { rule: node.closest('[data-rule]').dataset.rule,
      columns: Math.max(...cells.map(cell => Number(cell.dataset.column))) + 1,
      width: Number.parseFloat(node.style.width), svgWidth: Number(node.querySelector('svg').getAttribute('width')),
      firstLeft: Number.parseFloat(cells[0].style.left),
      controls: cells.filter(cell => cell.dataset.role === 'control').length,
      targets: cells.filter(cell => cell.dataset.role === 'target').length,
      links: node.querySelectorAll('.categorical-link').length,
      wires: [...node.querySelectorAll('.categorical-wire')].map(path => path.getAttribute('d')),
      swaps: [...node.querySelectorAll('.categorical-swap-path')].map(path => path.getAttribute('d')) };
  }));
  assert.ok(previews.length > 0);
  for (const preview of previews) {
    assert.equal(preview.width, preview.columns * 88, `${preview.rule}: preview has no board gutter or tail`);
    assert.equal(preview.svgWidth, preview.width);
    assert.equal(preview.firstLeft, 0);
    assert.ok([...preview.wires, ...preview.swaps].some(path => /^M0 /.test(path)),
      `${preview.rule}: wires start at the miniature edge`);
  }
  const sides = rule => previews.filter(preview => preview.rule === rule);
  assert.deepEqual(sides('basis-x').map(preview => preview.columns), [3, 1], 'The basis-change result omits empty edge columns');
  assert.deepEqual(sides('cancel-swap').map(preview => preview.columns), [2, 1], 'An identity result uses one wire segment');
  assert.deepEqual(sides('swap-h').map(preview => preview.columns), [2, 2]);
  assert.deepEqual(sides('swap-braid').map(preview => preview.columns), [3, 3]);
  const [cnots, crossing] = sides('swap-cnot');
  assert.deepEqual([cnots.columns, crossing.columns], [3, 1]);
  assert.deepEqual([cnots.controls, cnots.targets, cnots.links, cnots.swaps.length], [3, 3, 3, 0],
    'The SWAP equation shows three complete CNOT gates');
  assert.deepEqual([crossing.controls, crossing.targets, crossing.links, crossing.swaps.length], [0, 2, 0, 2],
    'The other side shows one crossed-wire SWAP');
  for (const path of sides('cancel-swap')[1].wires) assert.match(path, /^M0 [\d.]+H88$/);
  const [left, right] = sides('swap-h');
  assert.ok(left.swaps.every(path => path.startsWith('M0 ')), 'SWAP starts at the left edge without an empty wire lead');
  assert.ok(right.swaps.every(path => Number(path.match(/([\d.]+) [\d.]+$/)[1]) === right.width),
    'SWAP reaches the right edge without an empty wire tail');
  assert.ok(right.wires.every(path => !path.includes(`M${right.width} `)));
  const board = await page.locator('#categorical-board').evaluate(node => ({
    firstLeft: Number.parseFloat(node.querySelector('[data-cell]').style.left),
    columns: Math.max(...[...node.querySelectorAll('[data-cell]')].map(cell => Number(cell.dataset.column))) + 1,
    width: Number.parseFloat(node.style.width),
  }));
  assert.equal(board.firstLeft, 48, 'The playable board retains its input gutter');
  assert.equal(board.width, 48 + board.columns * 88 + 24, 'Compact previews do not change playable board dimensions');
}

async function linkedGateSelection(page, tap, profile, mobile) {
  const selected = () => page.locator('#categorical-board [aria-pressed="true"]').evaluateAll(cells =>
    cells.map(cell => cell.dataset.cell).sort());
  await tap(page.locator('#mode-random'));
  await importJson(page, tap, swapIdentity());
  const swap = ['0:0', '1:0'];
  for (const [first, second] of [['0:0', '1:0'], ['1:0', '0:0']]) {
    await tap(page.locator(`#categorical-board [data-cell="${first}"]`));
    assert.deepEqual(await selected(), swap, 'Either SWAP endpoint selects both ends');
    await tap(page.locator(`#categorical-board [data-cell="${second}"]`));
    assert.deepEqual(await selected(), [], 'Either selected SWAP endpoint clears both ends');
  }
  if (!mobile) {
    await tap(await boardCells(page, 0, 0));
    await page.keyboard.down('Shift');
    try { await tap(await boardCells(page, 0, 1)); } finally { await page.keyboard.up('Shift'); }
    assert.deepEqual(await selected(), ['0:0', '0:1', '1:0', '1:1'],
      'A narrow Shift rectangle includes the linked SWAP endpoints');
    await page.keyboard.press('Escape');
    const first = await boardCells(page, 0, 0), last = await boardCells(page, 0, 1);
    await first.scrollIntoViewIfNeeded();
    const start = await first.boundingBox(), end = await last.boundingBox();
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 6 });
    await page.mouse.up();
    assert.deepEqual(await selected(), ['0:0', '0:1', '1:0', '1:1'],
      'Dragging through one row also includes linked SWAP endpoints');
    await page.keyboard.press('Escape');
  }
  await importJson(page, tap, { wires: 2, columns: ['Z', 'Z', 'X', 'X'].map(gate =>
    [{ gate, wires: [1], controls: [0] }]) });
  for (const column of [0, 2]) {
    const control = await boardCells(page, 0, column), target = await boardCells(page, 1, column);
    await tap(control);
    assert.deepEqual(await selected(), profile === 'prop' ? [`0:${column}`, `1:${column}`] : [`0:${column}`],
      'PROP selects a whole controlled gate; Controlled PROP keeps its context separate');
    await tap(target);
    assert.deepEqual(await selected(), profile === 'prop' ? [] : [`0:${column}`, `1:${column}`]);
    await tap(control);
    assert.deepEqual(await selected(), profile === 'prop' ? [`0:${column}`, `1:${column}`] : [`1:${column}`]);
    await tap(target);
    assert.deepEqual(await selected(), []);
  }
  if (profile === 'controlled') {
    await importJson(page, tap, swapIdentity(true));
    await tap(await boardCells(page, 1, 0));
    assert.deepEqual(await selected(), ['1:0', '2:0'], 'A controlled SWAP selects both targets without its external control');
    await tap(await boardCells(page, 2, 0));
    assert.deepEqual(await selected(), []);
  }
  await tap(page.locator('#mode-campaign'));
}

async function categoryNavigation(page, kind, profile) {
  const path = kind === 'signals' ? '/games/quantum-signals/' : '/games/circuit-reduction/';
  const category = page.locator('#circuit-category');
  await page.goto(base + path + (profile === 'controlled' ? '?category=unknown&unexpected=1#old-state' : '?unexpected=1#old-state'));
  await page.locator(kind === 'signals' ? '#signal-board button' : '#circuit-board button').first().waitFor();
  assert.equal(await category.inputValue(), 'pro', 'Missing and unknown category values use PRO');
  assert.equal(await page.locator('#mode-daily').count(), 1, 'The basic PRO version retains daily puzzles');
  assert.equal(await category.evaluate(select => Boolean(select.closest('.mode-menu')) && Boolean(
    document.getElementById('mode-daily').compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING)), true,
  'Category follows Daily Puzzle in the PRO mode menu');
  await activeGame('pro');
  await restoreCachedMenu('pro');
  await Promise.all([page.waitForURL(base + path + '?category=' + profile), category.selectOption(profile)]);
  await page.locator('#categorical-board [data-cell]').first().waitFor();
  assert.deepEqual(await category.locator('option').allTextContents(), ['PRO', 'PROP', 'Controlled PROP']);
  assert.deepEqual(await category.locator('option').evaluateAll(options => options.map(option => option.value)), ['pro', 'prop', 'controlled']);
  assert.equal(await category.inputValue(), profile);
  assert.deepEqual([...new URL(page.url()).searchParams], [['category', profile]], 'Changing category removes unrelated query state');
  assert.equal(new URL(page.url()).hash, '', 'Changing category removes the previous round hash');
  await activeGame(profile);
  assert.equal(await category.evaluate(select => Boolean(select.closest('.mode-menu')) && Boolean(
    document.getElementById('mode-random').compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING)), true,
  'Category follows Custom/Random when daily puzzles are absent');
  assert.equal(await page.locator('#mode-daily').count(), 0, 'PROP categories have no daily puzzles');
  assert.equal(await page.locator('#level option').count(), getLevels(profile, kind).length);
  if (kind === 'signals') {
    assert.equal(await page.locator('#autofocus').evaluate(button => button.closest('#advanced-features') !== null), true,
      'Autofocus belongs to Advanced');
    assert.equal(await page.locator('#autofocus').isVisible(), false);
    assert.equal(await page.locator('#autofocus').getAttribute('aria-pressed'), 'false');
  }
  await page.reload();
  await page.locator('#categorical-board [data-cell]').first().waitFor();
  assert.equal(await category.inputValue(), profile, 'The category survives a reload');
  assert.equal(await page.locator('#level option').count(), getLevels(profile, kind).length);
  await activeGame(profile);
  await restoreCachedMenu(profile);

  async function restoreCachedMenu(active) {
    const shell = await page.locator('.quantum-game').elementHandle();
    await page.evaluate(value => {
      document.getElementById('circuit-category').value = value === 'pro' ? 'controlled' : 'pro';
      dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    }, active);
    assert.equal(await category.inputValue(), active, 'Restoring a cached page restores its active category');
    assert.equal(await shell.evaluate(node => node.isConnected), true, 'Restoring the menu retains the current game shell');
    await shell.dispose();
    await activeGame(active);
  }

  async function activeGame(selected) {
    await page.waitForFunction(() => document.querySelector('[data-circuit-game]')?.inert === false);
    assert.equal(new URL(page.url()).pathname, path, 'Every category uses the same game page');
    assert.equal(await page.locator('h1').innerText(), kind === 'signals' ? 'Quantum signals' : 'Circuit simplification');
    assert.equal(await page.locator('[data-circuit-game]').count(), 1);
    assert.equal(await page.locator('.quantum-game').count(), 1, 'Only one game shell is active');
    assert.equal(await page.locator('#categorical-board').count(), selected === 'pro' ? 0 : 1);
    assert.equal(await page.locator(kind === 'signals' ? '#signal-board' : '#circuit-board').count(), selected === 'pro' ? 1 : 0);
    assert.equal(await page.locator('[data-categorical-template]').count(), 0, 'The inert template is removed after choosing a category');
    const duplicates = await page.evaluate(() => {
      const seen = new Set();
      return [...document.querySelectorAll('[id]')].map(node => node.id).filter(id => {
        if (seen.has(id)) return true;
        seen.add(id); return false;
      });
    });
    assert.deepEqual(duplicates, [], 'Inactive category markup creates no duplicate live IDs');
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

async function solve(page, tap, puzzle, kind, profile, { close = true } = {}) {
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
        await selectWindow(page, tap, selectionCells(move, { profile }));
        const rule = page.locator(`#rule-list [data-rule="${move.rule}"]`);
        assert.equal(await rule.isEnabled(), true, `${profile}: ${move.rule} applies to ${JSON.stringify(move)}`);
        await tap(rule);
      }
      assert.equal(await page.locator('#status').innerText(), '', `Move ${move.rule} has no error`);
    }
    assert.equal(await page.locator('#categorical-board [data-role="target"]').count(), 0);
  }
  if (close) await closeWin(page, tap);
  else await page.waitForFunction(() => document.getElementById('win-dialog').open);
}

async function campaignScores(page, tap, kind, profile, label, requests) {
  const game = `${kind === 'signals' ? 'quantum-signals' : 'circuit-reduction'}-${profile}`;
  const level = getLevels(profile, kind)[0];
  const board = page.waitForResponse(response => new URL(response.url()).pathname === '/api/leaderboard' &&
    response.request().method() === 'GET' && new URL(response.url()).searchParams.get('game') === game &&
    new URL(response.url()).searchParams.get('level') === String(level.id));
  await page.locator('#level').selectOption(String(level.id));
  assert.equal((await board).status(), 200, 'The campaign board uses the real server validator');
  assert.equal(await page.locator('#leaderboard-section').isVisible(), true);
  await solve(page, tap, level, kind, profile, { close: false });
  assert.equal(await page.locator('#score-form').isVisible(), true);
  const nickname = `Ada ${label.startsWith('desktop') ? 'D' : 'M'}${kind === 'signals' ? 'S' : 'C'}${profile === 'prop' ? 'P' : 'C'}`;
  const save = () => page.waitForResponse(response => new URL(response.url()).pathname === '/api/leaderboard' &&
    response.request().method() === 'POST');
  const saved = save();
  await page.locator('#player-name').fill(nickname);
  await tap(page.locator('#submit-score'));
  await checkSaved(await saved);
  assert.equal(await page.evaluate(() => localStorage.getItem('games.nickname.v1')), nickname);
  await closeWin(page, tap);
  await tap(page.locator('#restart'));
  const automatic = save();
  await solve(page, tap, level, kind, profile, { close: false });
  await checkSaved(await automatic);
  assert.equal(await page.locator('#score-form').isVisible(), false, 'A remembered nickname skips the submission form');
  assert.equal(requests.filter(request => request.method === 'POST').length, 2, 'Each completed round submits once');
  if (!await page.locator('#result-advanced-features').evaluate(details => details.open)) {
    await tap(page.locator('#result-advanced-features > summary'));
  }
  await tap(page.locator('#nickname-forget'));
  assert.equal(await page.evaluate(() => localStorage.getItem('games.nickname.v1')), null);
  await closeWin(page, tap);

  async function checkSaved(response) {
    assert.equal(response.status(), 201, await response.text());
    const payload = response.request().postDataJSON(), data = await response.json();
    assert.equal(payload.game, game);
    assert.equal(Number(payload.level), level.id);
    assert.equal(payload.name, nickname);
    assert.ok(Array.isArray(payload.sequence));
    assert.equal(Object.hasOwn(payload, 'date'), false, 'Advanced boards are level-only');
    await page.locator('#win-results').waitFor({ state: 'visible' });
    const row = page.locator('#result-leaderboard-body .current-player');
    assert.equal(await row.count(), 1);
    assert.ok((await row.innerText()).includes(nickname));
    if (kind === 'signals') {
      assert.equal(data.currentPlayer.completed, true);
      for (const key of ['moves', 'rank', 'score', 'optimalMoves']) assert.equal(Object.hasOwn(data.currentPlayer, key), false);
      assert.equal(await row.locator('td').count(), 2);
      assert.equal(await row.locator('input[type="checkbox"]').isChecked(), true);
      assert.equal(await row.locator('input[type="checkbox"]').isDisabled(), true);
      assert.equal(await page.locator('#score-status').innerText(), 'Completion saved.');
    } else {
      assert.ok(data.currentPlayer.moves > 0);
      assert.equal(data.currentPlayer.moves, Number.parseInt(await page.locator('#move-count').innerText()));
      assert.equal(await row.locator('td').count(), 3);
      assert.equal(await row.locator('input[type="checkbox"]').count(), 0);
      assert.equal(await row.locator('td').last().innerText(), String(data.currentPlayer.moves));
      assert.equal(await page.locator('#score-status').innerText(), 'Score saved.');
    }
  }
}

async function generatedCnotSwap(page, tap, profile) {
  const puzzle = randomIdentity(profile, { seed: 'swap-cnot-browser', difficulty: profile === 'controlled' ? 3 : 2 });
  assert.ok(puzzle.solution.some(move => move.rule === 'swap-cnot'), 'Random identities include the three-CNOT SWAP equation');
  if (profile === 'controlled') assert.ok(puzzle.solution.some(move => move.rule === 'swap-cnot' && move.controls?.length),
    'The same random equation can be lifted under shared controls');
  await importJson(page, tap, puzzle.circuit);
  await solve(page, tap, puzzle, 'simplification', profile);
  await tap(page.locator('#restart'));
}

async function signalTriplePalette(page, puzzle, profile, index) {
  const hole = puzzle.holes[index], endpoints = page.locator(`#categorical-board [data-hole="${index}"]`);
  assert.deepEqual(await page.locator('#gate-palette [data-choice]').evaluateAll(buttons => buttons.map(button => button.dataset.choice)), hole.choices);
  if (profile === 'prop') {
    assert.equal(Object.hasOwn(hole, 'controls'), false);
    assert.deepEqual(hole.choices, ['I', 'CX', 'XC']);
    assert.equal(await endpoints.count(), 2, 'PROP CNOT holes select a complete paired gate');
    assert.equal(await page.locator(`#categorical-board [data-placeholder][data-column="${puzzle.columns.length + index}"]`).count(), 0,
      'PROP leaves no fixed control when a complete gate is empty');
    for (const gate of ['CX', 'XC']) {
      const button = page.locator(`#gate-palette [data-choice="${gate}"]`);
      assert.equal(await button.locator(':scope > svg > line').count(), 1);
      assert.equal(await button.locator(':scope > svg > circle').count(), 1);
      assert.equal(await button.locator(':scope > svg > svg').count(), 1, 'Both CNOT directions show their full target and control');
    }
  } else {
    assert.deepEqual(hole.choices, ['I', 'X']);
    assert.equal(hole.controls.length, 2);
    assert.equal(await endpoints.count(), 1, 'Controlled PROP keeps the constructor outside the hole');
    assert.equal(await page.locator('#gate-palette [data-choice="X"] > svg > circle').count(), 2,
      'The palette shows both constructor controls');
  }
}

async function generatedSignalTriple(page, tap, profile) {
  let puzzle;
  const solution = profile === 'prop' ? ['CX', 'XC', 'CX'] : ['X', 'X', 'X'];
  for (let sample = 0; sample < 32; sample++) {
    const candidate = generateSignals(profile, { seed: `signals-triple-browser-${sample}`, difficulty: profile === 'prop' ? 2 : 3 });
    if (candidate.holes.length === 3 && candidate.solution.join() === solution.join()) { puzzle = candidate; break; }
  }
  assert.ok(puzzle, 'Random Signals puzzles include the three-CNOT family');
  await importJson(page, tap, signalsData(puzzle, undefined, profile));
  for (const index of puzzle.holes.keys()) {
    await tap(page.locator(`#categorical-board [data-hole="${index}"]`).first());
    await signalTriplePalette(page, puzzle, profile, index);
  }
  await solve(page, tap, puzzle, 'signals', profile);
  for (const index of puzzle.holes.keys()) assert.equal(await page.locator(`#categorical-board [data-hole="${index}"]`).first().getAttribute('data-filled'), 'true',
    'The generated triple needs each offered gate');
  await tap(page.locator('#restart'));
}

async function desktopInputCheck(page, tap, kind, profile) {
  if (kind === 'signals') {
    const level = getLevels(profile, 'signals').find(level => level.title ===
      (profile === 'controlled' ? 'Unequal branches' : 'Move the excitation'));
    await page.locator('#level').selectOption(String(level.id));
    const choice = level.solution[0];
    await page.locator('#categorical-board [data-hole="0"]').first().focus();
    await page.keyboard.press('Enter');
    await page.locator(`#gate-palette [data-choice="${choice}"]`).focus();
    await page.keyboard.press('Enter');
    await closeWin(page, tap);
    return;
  }
  await tap(page.locator('#mode-random'));
  await importJson(page, tap, swapIdentity());
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
  await tap(page.locator('#restart'));
  await selectWindow(page, async cell => {
    await cell.focus();
    await page.keyboard.press('Space');
  }, selectionCells({ rule: 'cancel-swap', column: 0, wires: [0, 1] }, { profile }));
  await page.locator('#rule-list [data-rule="cancel-swap"]').focus();
  await page.keyboard.press('Enter');
  await closeWin(page, tap);
  await tap(page.locator('#mode-campaign'));
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
  await tap(page.locator('#mode-random'));
  await importJson(page, tap, signalInputPuzzle);
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
    await tap(page.locator('#mode-random'));
    await importJson(page, tap, signalInputPuzzle);
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
      return Promise.resolve().then(() => ({ animating, busy, ghosts,
        preserved: path.isConnected && flow.contains(path), resultsDisabled: document.getElementById('show-results').disabled }));
    });
    assert.equal(during.animating, 'true'); assert.equal(during.busy, 'true');
    assert.ok(during.ghosts > 0, 'The shared animation displays old paths while their replacements appear');
    assert.equal(during.preserved, true, 'Selecting a hole during animation preserves the live path nodes');
    assert.equal(during.resultsDisabled, true, 'A cancelled older transition cannot unlock Results during its replacement');
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
    assert.equal(await page.locator('#show-results').isDisabled(), false, 'Reset clears the cancelled transition lock');
    await importJson(page, tap, { wires: 2, columns: [],
      holes: [{ wires: [0], choices: ['I', 'H'] }, { wires: [1], choices: ['I', 'X'] }],
      targetCircuit: { wires: 2, columns: [[{ gate: 'H', wires: [0] }]] } });
    const early = await page.evaluate(() => {
      document.querySelector('#gate-palette [data-choice="H"]').click();
      const results = document.getElementById('show-results');
      const initialLock = results.disabled;
      results.click();
      document.querySelector('#categorical-board [data-hole="1"]').click();
      return { initialLock, afterSelection: results.disabled, open: document.getElementById('win-dialog').open };
    });
    assert.equal(early.initialLock, true, 'A winning gate locks Results as its transition starts');
    assert.equal(early.afterSelection, true);
    assert.equal(early.open, false, 'Results cannot hide the winning animation');
    await page.waitForFunction(() => !document.getElementById('signal-flow').hasAttribute('data-flow-animating') &&
      !document.getElementById('show-results').disabled);
    await page.locator('#show-results').evaluate(button => button.click());
    await page.locator('#win-dialog[open]').waitFor();
    await page.evaluate(() => { document.getElementById('close-win').click(); document.getElementById('restart').click(); });
    assert.equal(await page.locator('#undo').isDisabled(), true);
  } finally { await page.emulateMedia({ reducedMotion: 'reduce' }); }
}

async function simplificationShortcutParity(page, tap, mobile) {
  await tap(page.locator('#mode-random'));
  await importJson(page, tap, swapIdentity());
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
  await tap(page.locator('#mode-campaign'));
  await page.locator('#level').selectOption(String(levels.length));
  // Settle scroll events caused by replacing the previous level before scrolling manually.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const positions = () => page.evaluate(() => Object.fromEntries(['categorical-scroll', 'flow-scroll'].map(id => {
    const node = document.getElementById(id);
    return [id, { left: node.scrollLeft, width: node.scrollWidth, viewport: node.clientWidth,
      maximum: node.scrollWidth - node.clientWidth }];
  })));
  const initial = await positions();
  assert.ok(Object.values(initial).every(node => node.maximum > 0),
    `Long mobile circuits have scrollable ranges: ${JSON.stringify(initial)}`);
  const offset = Math.min(120, ...Object.values(initial).map(node => node.maximum));
  const manualScroll = async (id, expected) => {
    await page.locator('#' + id).evaluate((node, left) => { node.scrollLeft = left; }, expected);
    try {
      await page.waitForFunction(left => ['categorical-scroll', 'flow-scroll'].every(id =>
        Math.abs(document.getElementById(id).scrollLeft - left) <= 1), expected);
    } catch (error) {
      throw new Error(`Manual scroll from ${id} did not reach ${expected}: ${JSON.stringify(await positions())}`, { cause: error });
    }
  };
  const target = await page.locator('#signal-target').boundingBox();
  const synchronized = () => page.waitForFunction(() => Math.abs(document.getElementById('categorical-scroll').scrollLeft - document.getElementById('flow-scroll').scrollLeft) <= 1);
  await manualScroll('flow-scroll', offset);
  assert.equal((await page.locator('#signal-target').boundingBox()).x, target.x);
  await manualScroll('categorical-scroll', 0);
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
    await selectWindow(page, tap, selectionCells(move, { profile }));
    await tap(page.locator('#rule-list [data-rule="cancel-z"]'));
    assert.equal(await page.locator('#status').innerText(), '');
    if (keyboard) {
      await page.keyboard.press('Control+z');
      assert.equal(await page.locator('#editor-controls').isVisible(), true);
      assert.equal(await page.locator('#categorical-board [data-role="target"]').count(), 0, 'Ctrl+Z also undoes reverse equations during construction');
      assert.equal(await page.locator('#move-count').innerText(), '0 moves');
      await selectWindow(page, tap, selectionCells(move, { profile }));
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
    const requests = [];
    let mode = 'tutorial';
    page.on('pageerror', error => errors.push(`${name}/${kind}/${profile}: ${error.message}`));
    page.on('request', request => {
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return;
      const payload = request.method() === 'POST' ? request.postDataJSON() : null;
      const entry = { surface: label, mode, method: request.method(), path: url.pathname,
        game: payload?.game ?? url.searchParams.get('game'), level: payload?.level ?? url.searchParams.get('level'),
        date: payload?.date ?? url.searchParams.get('date') };
      requests.push(entry); apiRequests.push(entry);
    });
    await fixture.install(context);
    await page.addInitScript(value => { crypto.randomUUID = () => value; }, seed);
    const tap = async locator => {
      const id = await locator.getAttribute('id');
      if (id === 'tutorial-levels' || id === 'mode-campaign') mode = 'campaign';
      else if (id === 'mode-random') mode = 'random';
      else if (id === 'mode-tutorial') mode = 'tutorial';
      return options.hasTouch ? locator.tap() : locator.click();
    };
    try {
      if (label === 'desktop-simplification-prop') await controllerReadiness(page, tap);
      await categoryNavigation(page, kind, profile);
      if (kind === 'simplification') await compactRulePreviews(page);
      assert.equal(await page.locator('#mode-daily').count(), 0);
      assert.equal(await page.locator('#leaderboard-section').isVisible(), false, 'The tutorial hides the campaign leaderboard');
      assert.equal(await page.locator('#mode-tutorial').getAttribute('aria-pressed'), 'true');
      await fits(page);
      await tap(page.locator('#tutorial-start'));
      const tutorial = getTutorial(profile, kind);
      if (kind === 'simplification' && profile === 'prop') assert.ok(tutorial.steps.some(step => step.move?.rule === 'swap-cnot'),
        'The PROP tutorial teaches the three-CNOT SWAP equation');
      if (kind === 'signals') {
        if (profile === 'prop') {
          assert.deepEqual(tutorial.steps.map(step => step.gate), ['SWAP', 'CX', 'XC', 'CX']);
          assert.deepEqual(tutorial.holes[0].wires, [1, 2]);
        } else {
          assert.equal(tutorial.steps[0].gate, 'SWAP');
          assert.ok(tutorial.holes[0].controls?.length, 'Controlled PROP introduces a controlled crossing');
          assert.equal(await page.locator('#gate-palette [data-choice="SWAP"] > svg > circle').count(), tutorial.holes[0].controls.length);
        }
      }
      for (let index = 0; index < tutorial.steps.length; index++) {
        const current = await page.locator('#tutorial-heading').innerText();
        assert.equal(current, `Step ${index + 1} of ${tutorial.steps.length}`);
        const focus = page.locator('[data-tutorial-focus]');
        assert.equal(await focus.count(), 1);
        if (tutorial.steps[index].move?.rule === 'swap-cnot') {
          assert.equal(await focus.getAttribute('data-rule'), 'swap-cnot', 'The tutorial highlights the actual three-CNOT rule');
          assert.equal(await focus.isEnabled(), true);
        }
        if (kind === 'signals' && profile === 'prop' && index > 0) {
          await signalTriplePalette(page, tutorial, profile, tutorial.steps[index].hole);
        }
        if (kind === 'signals' && name === 'mobile') {
          await page.waitForFunction(() => Math.abs(document.getElementById('categorical-scroll').scrollLeft -
            document.getElementById('flow-scroll').scrollLeft) <= 1);
          const hole = await page.locator(`#categorical-board [data-hole="${tutorial.steps[index].hole}"]`).first().boundingBox();
          const viewport = await page.locator('#categorical-scroll').boundingBox();
          assert.ok(hole.x >= viewport.x - 1 && hole.x + hole.width <= viewport.x + viewport.width + 1,
            'The mobile tutorial keeps its selected hole visible and aligned with the paths');
        }
        if (index % 2) await tap(focus); else await tap(page.locator('#tutorial-next'));
        await page.waitForFunction(({ final, step, count }) => document.getElementById('tutorial-heading').textContent ===
          (final ? 'Tutorial complete' : `Step ${step} of ${count}`),
        { final: index === tutorial.steps.length - 1, step: index + 2, count: tutorial.steps.length });
      }
      assert.equal(await page.locator('#win-dialog').evaluate(dialog => dialog.open), false);
      assert.equal(requests.length, 0, 'Tutorials and category navigation do not request scores or daily data');
      await tap(page.locator('#tutorial-levels'));
      const levels = getLevels(profile, kind);
      assert.equal(await page.locator('#level option').count(), levels.length);
      if (kind === 'simplification') {
        const level = levels.find(level => level.title === 'Three CNOTs make a swap');
        if (profile === 'prop') assert.ok(level?.solution.some(move => move.rule === 'swap-cnot'), 'PROP has a dedicated three-CNOT level');
        else assert.equal(level, undefined, 'Controlled PROP keeps its separate constructor campaign');
      } else {
        assert.ok(levels.some(level => level.title === (profile === 'prop' ? 'Three CNOTs make a swap' : 'Control three CNOTs')),
          'Signals has its own three-CNOT lesson');
      }
      if (kind === 'simplification') await linkedGateSelection(page, tap, profile, name === 'mobile');
      for (const [index, level] of levels.entries()) {
        assert.ok((await page.locator(`#level option[value="${index + 1}"]`).innerText()).includes(level.title));
        await page.locator('#level').selectOption(String(index + 1));
        assert.equal(await page.locator('#edit-circuit').isVisible(), false);
        assert.equal(await page.locator('#new-circuit').isVisible(), false);
        const fixedSwaps = (level.circuit?.columns ?? level.columns).flat().filter(operation => operation.gate === 'SWAP').length;
        assert.equal(await page.locator('#categorical-board .categorical-swap-path').count(), fixedSwaps * 2,
          'Every fixed SWAP draws two crossed wire paths');
        if (kind === 'simplification' && level.title === (profile === 'controlled' ? 'Controlled crossing' : 'Three crossings')) {
          await page.screenshot({ path: resolve(output, label + '-crossings.png'), fullPage: true });
        }
        const tripleLesson = kind === 'signals' && level.title === (profile === 'prop' ? 'Three CNOTs make a swap' : 'Control three CNOTs');
        if (tripleLesson) for (const hole of level.holes.keys()) {
          await tap(page.locator(`#categorical-board [data-hole="${hole}"]`).first());
          await signalTriplePalette(page, level, profile, hole);
        }
        await solve(page, tap, level, kind, profile);
        if (tripleLesson) for (const hole of level.holes.keys()) {
          assert.equal(await page.locator(`#categorical-board [data-hole="${hole}"]`).first().getAttribute('data-filled'), 'true');
        }
        if (kind === 'signals' && level.title === (profile === 'controlled' ? 'Choose which crossing' : 'Move the excitation')) {
          await tap(page.locator('#categorical-board [data-hole="0"]').first());
          assert.ok(await page.locator('#categorical-board .categorical-swap-path').count() > 0);
          assert.equal(await page.locator('#gate-palette .categorical-swap-path').count(), 2,
            'The SWAP palette uses the same crossed wires as the board');
          await page.screenshot({ path: resolve(output, label + '-crossings.png'), fullPage: true });
        }
        if (index === 0) await replayCheck(page, tap, kind);
      }
      await campaignScores(page, tap, kind, profile, label, requests);
      if (name === 'desktop') await desktopInputCheck(page, tap, kind, profile);
      if (kind === 'signals') {
        await signalShortcutParity(page, tap, name === 'mobile');
        if (name === 'mobile') await mobileSignalViewport(page, tap, profile);
        else await signalAnimationParity(page, tap);
      } else await simplificationShortcutParity(page, tap, name === 'mobile');
      await tap(page.locator('#mode-random'));
      assert.equal(await page.locator('#leaderboard-section').isVisible(), false, 'Random/custom modes hide the campaign leaderboard');
      const random = kind === 'signals' ? generateSignals(profile, { seed, difficulty: 2 }) : randomIdentity(profile, { seed, difficulty: 2 });
      const shared = await exported(page, tap);
      await importJson(page, tap, shared);
      assert.deepEqual(await exported(page, tap), shared, 'JSON round trips without extra metadata');
      if (kind === 'signals') await multiHoleReplay(page, tap, shared);
      if (kind === 'signals' && profile === 'prop') await propWholeGateHoles(page, tap, shared);
      await solve(page, tap, random, kind, profile);
      await tap(page.locator('#restart'));
      if (kind === 'simplification') await generatedCnotSwap(page, tap, profile);
      else await generatedSignalTriple(page, tap, profile);
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
      assert.equal(await page.locator('#circuit-category').inputValue(), 'pro');
      assert.equal(new URL(page.url()).pathname, basicPath);
      assert.equal(await page.locator('.quantum-game').count(), 1);
      assert.equal(await page.locator('#categorical-board').count(), 0);
      assert.equal(await page.locator('#mode-daily').count(), 1, 'Returning to PRO restores the basic daily menu');
      assert.equal(await page.locator('#mode-tutorial').getAttribute('aria-pressed'), 'true');
      reports.push({ label, tutorial: tutorial.steps.length, levels: levels.length, status: 'passed' });
      console.log(`${label}: category navigation, tutorial, ${levels.length} named levels, random, JSON, invalid inputs, editor, fixed target and layout passed.`);
    } catch (error) {
      await page.screenshot({ path: resolve(output, label + '-failed.png'), fullPage: true }).catch(() => {});
      throw new Error(label + ': ' + error.message, { cause: error });
    } finally { await context.close(); }
  }
  assert.ok(apiRequests.length > 0, 'Campaign leaderboards are exercised through the real validators');
  for (const request of apiRequests) {
    const [surface, kind, profile] = request.surface.split('-');
    assert.ok(['desktop', 'mobile'].includes(surface));
    assert.equal(request.mode, 'campaign', 'Tutorial, custom and random rounds do not request boards or submit results');
    assert.equal(request.path, '/api/leaderboard', 'Advanced games never request daily data');
    assert.equal(request.game, `${kind === 'signals' ? 'quantum-signals' : 'circuit-reduction'}-${profile}`,
      'Each game and category uses its own campaign board');
    assert.ok(Number(request.level) > 0);
    assert.equal(request.date, null, 'Advanced leaderboard requests have no daily selector');
  }
  assert.deepEqual(errors, [], 'The advanced games have no uncaught browser errors');
  console.log(JSON.stringify({ surfaces: reports.length, levelsPlayed: reports.reduce((sum, report) => sum + report.levels, 0),
    apiRequests: apiRequests.length, submissions: apiRequests.filter(request => request.method === 'POST').length,
    errors: errors.length, reports }, null, 2));
} finally { await browser.close(); }
