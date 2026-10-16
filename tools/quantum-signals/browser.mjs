// Real mouse/touch playthroughs against an Astro preview. Daily and completion
// requests use a local fixture, so this check never writes production records.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getHoles, solvePuzzle, puzzleData, validateCustomPuzzle, simulate, stateEqual } from '../../src/lib/quantum-signals/engine.js';
import { LEVELS, dailyPuzzle } from '../../src/lib/quantum-signals/puzzles.js';
import { flowTrace } from '../../src/lib/quantum-signals/flow.js';
import { gateLabel } from '../../src/lib/quantum-signals/rendering.js';
import { phaseColor, phasePathColor, PHASE_COLORS, CANCELLATION_WALL } from '../../src/lib/quantum-signals/state-visuals.js';
import { TUTORIAL_PUZZLE, TUTORIAL_STEPS } from '../../src/lib/quantum-signals/tutorial.js';
import { createBrowserApi } from '../circuit-reduction/browser-api.mjs';

const require = createRequire(resolve(process.env.PLAYWRIGHT_MODULE_DIR ?? 'tmp/quality-tools/node_modules', 'package.json'));
const { chromium } = require('playwright');
const qualityRequire = createRequire(resolve(process.env.QUALITY_MODULE_DIR ?? 'tmp/quality-tools/node_modules', 'package.json'));
const axeSource = await readFile(qualityRequire.resolve('axe-core/axe.min.js'), 'utf8');
const base = process.env.GAME_BASE_URL ?? 'http://127.0.0.1:4323';
const output = resolve('tmp/quantum-signals-browser');
const fixture = createBrowserApi({ now: Date.parse(process.env.GAME_TEST_TIME ?? '2026-10-15T10:00:00Z') });
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {}) });
const errors = [], boardResponses = [], touchPages = new WeakSet();
let completionRequests = 0;
const activate = (page, locator) => touchPages.has(page) ? locator.tap() : locator.click();
await mkdir(output, { recursive: true });

async function drainBoardResponses() {
  while (boardResponses.length) await Promise.all(boardResponses.splice(0));
}

async function pageFor(options, { blockedStorage = false, api = fixture, now = process.env.GAME_TEST_TIME ?? '2026-10-15T10:00:00Z' } = {}) {
  const context = await browser.newContext({ ...options, reducedMotion: 'reduce' });
  if (blockedStorage) await context.addInitScript(() => {
    for (const method of ['getItem', 'setItem', 'removeItem']) Storage.prototype[method] = () => { throw new DOMException('Storage is blocked.', 'SecurityError'); };
  });
  const page = await context.newPage();
  let pageCompletions = 0;
  page.on('request', request => {
    if (new URL(request.url()).pathname !== '/api/leaderboard') return;
    const body = request.method() === 'POST' ? request.postDataJSON() : null;
    completionRequests++;
    pageCompletions++;
    if (body) {
      noBenchmark(body, 'A completion submission');
      assert.equal(Object.hasOwn(body, 'moves') || Object.hasOwn(body, 'rank'), false, 'Completion submissions carry no numeric score');
    }
  });
  page.on('response', response => {
    if (new URL(response.url()).pathname !== '/api/leaderboard' || response.status() >= 400) return;
    const pending = (async () => {
      const request = response.request(), aborted = Symbol('aborted');
      if (request.failure()?.errorText === 'net::ERR_ABORTED') return;
      let data, onFailed, timeout;
      const interrupted = new Promise((resolve, reject) => {
        onFailed = failed => {
          if (failed !== request) return;
          const reason = failed.failure()?.errorText;
          if (reason === 'net::ERR_ABORTED') resolve(aborted);
          else reject(new Error('Completion response failed: ' + reason));
        };
        page.on('requestfailed', onFailed);
        timeout = setTimeout(() => reject(new Error('Timed out reading completion response: ' + response.url())), 10_000);
      });
      try {
        data = await Promise.race([response.json(), interrupted]);
      } catch (error) {
        if (request.failure()?.errorText === 'net::ERR_ABORTED') return;
        throw error;
      } finally {
        clearTimeout(timeout); page.off('requestfailed', onFailed);
      }
      if (data === aborted) return;
      return checkCompletionPayload(data);
    })();
    boardResponses.push(pending); pending.catch(() => {});
  });
  if (options.hasTouch) touchPages.add(page);
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(new Date(now));
  await api.install(page);
  await drainBoardResponses();
  await page.goto(`${base}/games/quantum-signals/`);
  await page.locator('[data-hole]').first().waitFor();
  assert.equal(await page.locator('#mode-tutorial').getAttribute('aria-pressed'), 'true', 'Tutorial is the default mode');
  assert.equal(await page.locator('#tutorial-panel').isVisible(), true);
  assert.equal(await page.locator('#circuit-editor-controls').evaluate(node => node.hidden), true, 'The tutorial hides custom editing controls');
  assert.equal(await page.locator('#leaderboard-section').isVisible(), false, 'The tutorial has no completion list');
  assert.equal(pageCompletions, 0, 'Opening the tutorial never requests a completion list');
  await activate(page, page.locator('#mode-campaign'));
  await page.waitForFunction(() => document.getElementById('mode-campaign').getAttribute('aria-pressed') === 'true' && document.querySelectorAll('[data-hole]').length === 1);
  assert.equal(await page.locator('#tutorial-panel').isVisible(), false, 'Levels leave the tutorial');
  assert.equal(await page.locator('#move-count').count(), 0, 'The game displays no gate counter');
  await completionBoard(page);
  assert.equal(await page.locator('#custom-puzzle, #custom-form').count(), 0, 'Custom JSON uses the shared dialog');
  assert.equal(await page.locator('#editor-title').count(), 0, 'Custom puzzles have no title field');
  return page;
}

function noBenchmark(value, description) {
  assert.equal(Object.hasOwn(value, 'optimalMoves'), false, `${description} carries no benchmark metadata`);
}

function noPuzzleMetadata(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    assert.ok(key !== 'id' && key !== 'title', 'Custom exports contain gameplay data without IDs or titles');
    noPuzzleMetadata(nested);
  }
}

function checkCompletionPayload(data) {
  noBenchmark(data, 'A completion-list response');
  assert.deepEqual(Object.keys(data).sort(), ['currentPlayer', 'entries', 'total'], 'Completion responses contain only the list and current player');
  assert.ok(Number.isInteger(data.total) && data.total >= 0 && Array.isArray(data.entries), 'Completion lists include a valid total and entries');
  for (const entry of [...data.entries, ...(data.currentPlayer ? [data.currentPlayer] : [])]) {
    assert.deepEqual(Object.keys(entry).sort(), ['completed', 'id', 'name'], 'Completion records expose no rank or numeric score');
    assert.equal(entry.completed, true);
    assert.ok(Number.isInteger(entry.id) && entry.id > 0 && typeof entry.name === 'string' && entry.name.length > 0);
  }
  return data;
}

async function completionBoard(page) {
  assert.equal(await page.locator('#player-rank, .benchmark').count(), 0, 'Completion lists render no ranking or benchmark');
  for (const selector of ['#leaderboard-section', '#win-results']) {
    assert.deepEqual(await page.locator(`${selector} th`).allTextContents(), ['Player', 'Completed'], 'Completion tables show only players and completion status');
    const boxes = await page.locator(`${selector} input[type="checkbox"]`).evaluateAll(nodes => nodes.map(node => ({ checked: node.checked, disabled: node.disabled })));
    assert.ok(boxes.every(box => box.checked && box.disabled), 'Every recorded completion has a checked, read-only checkbox');
  }
  assert.equal(await page.locator('#submit-score').innerText(), 'Save completion');
  if (await page.locator('#mode-random').getAttribute('aria-pressed') === 'true') {
    assert.equal(await page.locator('#leaderboard-section').isVisible(), false, 'Random/custom rounds have no completion list');
    assert.equal(await page.locator('#score-form').isVisible(), false, 'Random/custom rounds do not register completions');
  }
  await drainBoardResponses();
}

async function noOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'The page fits the viewport');
}

async function accessibility(page) {
  await page.evaluate(axeSource);
  const report = await page.evaluate(() => window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] },
  }));
  assert.deepEqual(report.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })), [], 'The game has no automated accessibility violations');
}

async function visibleChoices(page, hole) {
  assert.deepEqual(await page.locator('[data-choice]:visible').evaluateAll(nodes => nodes.map(node => node.dataset.choice).sort()), [...hole.choices].sort(), 'Only gates for the selected hole are shown');
  if (hole.wires.length !== 2) return;
  const report = await page.locator('.signal-palette').evaluate((palette, hole) => {
    const errors = [], rows = [...hole.wires].sort((first, second) => first - second);
    for (const gate of hole.choices.filter(gate => gate !== 'I')) {
      const button = palette.querySelector(`[data-choice="${gate}"]`), glyphs = [...button.querySelectorAll('.signal-twin > .gate-glyph')];
      const control = gate === 'XC' ? hole.wires[1] : hole.wires[0];
      const expected = rows.map(row => gate === 'CZ' || row === control ? 'Z' : 'X');
      const actual = glyphs.map(glyph => glyph.querySelector('path') ? 'X' : 'Z');
      if (JSON.stringify(actual) !== JSON.stringify(expected)) errors.push(`${gate} palette follows physical upper/lower wire order`);
      if (glyphs.length === 2 && glyphs[0].getBoundingClientRect().y >= glyphs[1].getBoundingClientRect().y) errors.push(`${gate} palette has distinct upper/lower glyphs`);
      if (gate !== 'CZ' && !button.getAttribute('aria-label').includes('CNOT: ' + (control === rows[0] ? 'upper' : 'lower') + ' control')) errors.push(`${gate} announces its physical control direction`);
    }
    return errors;
  }, hole);
  assert.deepEqual(report, [], 'Two-wire palette icons and labels match the selected circuit wires');
}

async function numberedGate(page, gate) {
  const available = await page.locator('[data-choice]:visible').evaluateAll(nodes => nodes.map(node => node.dataset.choice));
  const number = available.indexOf(gate) + 1;
  assert.ok(number >= 1 && number <= 4, `${gate} has an available numbered shortcut`);
  await page.keyboard.press('Digit' + number);
}

async function emptySlots(page) {
  assert.equal(await page.locator('.signal-question').count(), 0, 'Empty slots have no question-mark glyph');
  const slots = await page.locator('[data-hole][data-filled="false"]').evaluateAll(nodes => {
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
    return nodes.map(node => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = getComputedStyle(node).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      const bounds = node.getBoundingClientRect();
      return { text: node.textContent.trim(), alpha: context.getImageData(0, 0, 1, 1).data[3],
        label: node.getAttribute('aria-label'), width: bounds.width, height: bounds.height };
    });
  });
  assert.ok(slots.length > 0 && slots.every(slot => slot.text === ''), 'An empty slot is a blank box');
  assert.ok(slots.every(slot => slot.alpha < 255), 'Incoming signals remain visible through the translucent slot fill');
  assert.ok(slots.every(slot => /unfilled/.test(slot.label)), 'Blank slots remain understandable to screen readers');
  assert.ok(slots.every(slot => slot.width >= 44 && slot.height >= 44), 'Blank slots remain large enough for touch');
}

async function gateGeometry(page, puzzle, placements = {}) {
  const report = await page.locator('#signal-board').evaluate((board, { puzzle, placements }) => {
    const errors = [], svg = board.querySelector('.signal-wires');
    const transform = svg.getScreenCTM();
    const screen = (x, y) => new DOMPoint(x, y).matrixTransform(transform);
    const near = (first, second) => Math.abs(first - second) <= 0.15;
    const check = (condition, message) => { if (!condition) errors.push(message); };
    const wires = [...svg.querySelectorAll('line, polyline')].map(line => ({
      points: line.tagName === 'line' ? [[line.x1.baseVal.value, line.y1.baseVal.value], [line.x2.baseVal.value, line.y2.baseVal.value]] :
        Array.from({ length: line.points.numberOfItems }, (_, index) => { const point = line.points.getItem(index); return [point.x, point.y]; }),
      color: getComputedStyle(line).stroke, dash: getComputedStyle(line).strokeDasharray,
    }));
    check(wires.length === puzzle.wires, 'The regular circuit has exactly one plain wire per qubit');
    check(new Set(wires.map(wire => wire.color)).size === 1, 'All regular circuit wires share the same color');
    wires.forEach((wire, row) => {
      check(wire.points.every(point => near(point[1], 46 + 88 * row)), 'A regular circuit wire is straight through every gate');
      check(wire.dash === 'none', 'Regular circuit wires have no state-dependent patterns');
    });
    const nodes = [...board.querySelectorAll(':scope > .signal-hole, :scope > .signal-fixed')];
    const entries = puzzle.columns.flatMap((column, index) => column.map(entry => ({ ...entry, column: index })));
    check(nodes.length === entries.length, 'Every circuit entry has a rendered node');
    entries.forEach((entry, index) => {
      const node = nodes[index], x = 92 + 88 * entry.column;
      const gate = entry.gate ?? (Object.hasOwn(placements, entry.id) ? placements[entry.id] : 'I');
      const endpoints = [...node.querySelectorAll('.signal-endpoint > .gate-glyph')];
      const active = gate !== 'I';
      check(endpoints.length === (active ? entry.wires.length : 0), `Column ${entry.column} has the expected gate endpoints`);
      for (const [endpoint, row] of entry.wires.entries()) {
        const y = 46 + 88 * row, center = screen(x, y);
        if (active) {
          const bounds = endpoints[endpoint].getBoundingClientRect();
          check(near(bounds.x + bounds.width / 2, center.x) && near(bounds.y + bounds.height / 2, center.y),
            `${gate} column ${entry.column}, wire ${row} is centered on the circuit junction`);
          const control = gate === 'XC' ? entry.wires[1] : entry.wires[0];
          const expected = gate === 'CX' || gate === 'XC' ? row === control ? 'Z' : 'X' : gate === 'CZ' ? 'Z' : gate;
          const glyph = endpoints[endpoint], actual = glyph.querySelector('rect') ? 'H' : glyph.querySelector('path') ? 'X' : 'Z';
          check(actual === expected, `${gate} column ${entry.column}, wire ${row} shows the correct control/target glyph`);
        }
        const wire = wires[row];
        check(wire && wire.points[0][0] <= x && wire.points.at(-1)[0] >= x && wire.points.every(point => near(point[1], y)),
          `${gate} column ${entry.column}, wire ${row}: the continuous wire passes through the exact gate center`);
      }
      const link = node.querySelector('.signal-link');
      check(Boolean(link) === (active && entry.wires.length === 2), 'Only an active two-wire gate has a vertical connector');
      if (link) {
        const bounds = link.getBoundingClientRect();
        const first = screen(x, 46 + 88 * Math.min(...entry.wires)), last = screen(x, 46 + 88 * Math.max(...entry.wires));
        check(near(bounds.x + bounds.width / 2, first.x) && near(bounds.top, first.y) && near(bounds.bottom, last.y),
          `${gate} vertical connector joins the exact centers of both endpoints`);
      }
    });
    return errors;
  }, { puzzle, placements });
  assert.deepEqual(report, [], 'Gate glyphs, vertical links and signal paths share exact junctions');
}

async function placedGates(page, puzzle) {
  const holes = new Map(getHoles(puzzle).map(hole => [hole.id, hole]));
  const visible = await page.locator('#signal-board [data-hole][data-filled="true"]').evaluateAll(nodes =>
    nodes.map(node => ({ id: node.dataset.hole, label: node.title.split(' · ')[0] })));
  return Object.fromEntries(visible.map(({ id, label }) => {
    const hole = holes.get(id), gate = hole?.choices.find(gate => gateLabel(gate, hole.wires) === label);
    assert.ok(gate, 'Each displayed placement identifies a gate offered by its hole');
    return [id, gate];
  }));
}

async function basisFlow(page, puzzle, placements = undefined) {
  placements ??= await placedGates(page, puzzle);
  const expected = flowTrace(puzzle, placements);
  const flow = page.locator('#signal-flow');
  assert.equal(await flow.getAttribute('role'), 'img', 'The mirrored basis-state diagram has graphical semantics');
  assert.ok(await flow.getAttribute('aria-label'), 'The mirrored diagram has an accessible description');
  const actual = await flow.evaluate(svg => {
    const context = document.createElement('canvas').getContext('2d');
    const style = node => {
      const computed = getComputedStyle(node);
      const color = property => { context.fillStyle = '#000000'; context.fillStyle = computed[property]; return context.fillStyle; };
      return { fill: color('fill'), stroke: color('stroke'), strokeWidth: parseFloat(computed.strokeWidth),
        dash: computed.strokeDasharray, title: node.querySelector('title')?.textContent };
    };
    return {
    nodes: [...svg.querySelectorAll('[data-boundary][data-basis][data-amplitude]')].map(node => ({
      boundary: Number(node.dataset.boundary), basis: Number(node.dataset.basis), amplitude: Number(node.dataset.amplitude),
      x: node.cx.baseVal.value, ...style(node),
    })),
    edges: [...svg.querySelectorAll('[data-column][data-from][data-to][data-amplitude]')].map(node => ({
      column: Number(node.dataset.column), from: Number(node.dataset.from), to: Number(node.dataset.to), amplitude: Number(node.dataset.amplitude),
      ...style(node),
    })),
    lanes: [...svg.querySelectorAll('.signal-flow-lane')].map(node => ({ basis: Number(node.dataset.basis), end: node.x2.baseVal.value })),
    targets: [...svg.querySelectorAll('.signal-flow-target')].map(node => ({ basis: Number(node.dataset.basis), amplitude: Number(node.dataset.amplitude),
      x: node.cx.baseVal.value, ...style(node) })),
    cancellations: [...svg.querySelectorAll('.signal-flow-cancellation')].map(node => ({ boundary: Number(node.dataset.boundary),
      basis: Number(node.dataset.basis), path: node.getAttribute('d'), label: node.getAttribute('aria-label'), ...style(node), fill: node.getAttribute('fill') })),
    divider: svg.querySelector('.signal-flow-divider')?.getBBox().x,
  }; });
  assert.deepEqual(actual.lanes.map(lane => lane.basis), Array.from({ length: 2 ** puzzle.wires }, (_, basis) => basis), 'Every complete basis state has its own fixed lane');
  assert.deepEqual(actual.cancellations.map(({ boundary, basis }) => ({ boundary, basis })),
    expected.cancellations.flatMap((bases, column) => bases.map(basis => ({ boundary: column + 1, basis }))),
    'Walls mark exactly the outcomes whose opposite contributions cancel');
  for (const wall of actual.cancellations) {
    assert.equal(wall.stroke, PHASE_COLORS.negative);
    assert.equal(wall.fill, 'none');
    assert.equal(wall.strokeWidth, 2);
    assert.equal(wall.path, CANCELLATION_WALL.map(([dx, dy], index) =>
      (index ? 'L' : 'M') + (92 + (wall.boundary - .5) * 88 + dx) + ',' + (44 + wall.basis * 34 + dy)).join(' '));
    assert.ok(wall.label.includes('opposite phases cancel'));
    assert.ok(!actual.nodes.some(node => node.boundary === wall.boundary && node.basis === wall.basis),
      'Canceled outcomes have a wall instead of a photon dot');
    assert.ok(!actual.edges.some(edge => edge.column === wall.boundary && edge.from === wall.basis),
      'No amplitude leaves a wall in the next column');
  }
  for (const item of [...actual.nodes, ...actual.targets]) {
    assert.equal(item.fill, phaseColor(item.amplitude), 'Positive phases have black dots; negative phases have white dots');
    assert.ok(item.strokeWidth > 0, 'The phase outline remains visible, including matched targets');
  }
  for (const node of actual.nodes) assert.equal(node.stroke, PHASE_COLORS.negative, 'Both intermediate phases have white outlines');
  for (const target of actual.targets) assert.equal(target.stroke, PHASE_COLORS.negative, 'Both target phases have white outlines');
  for (const edge of actual.edges) {
    assert.equal(edge.stroke, phasePathColor(edge.amplitude), 'Negative paths are white; positive paths are darker');
  }
  for (const item of [...actual.nodes, ...actual.edges, ...actual.targets]) assert.equal(item.dash, 'none', 'Paths and markers use solid strokes');
  for (const item of [...actual.nodes, ...actual.targets]) assert.ok(item.title.includes(item.amplitude < 0 ? '− phase' : '+ phase'),
    'Hover descriptions state the signed phase');
  const outputX = actual.nodes.find(node => node.boundary === puzzle.columns.length).x;
  assert.ok(Number.isFinite(actual.divider) && outputX < actual.divider && actual.targets.every(node => node.x > actual.divider),
    'A divider separates the input-to-output diagram from every target marker');
  assert.ok(actual.lanes.every(lane => Math.abs(lane.end - outputX) < 1e-8), 'Basis lane lines end at Output before the target divider');
  assert.equal(await page.locator('#signal-board svg text, #signal-board .signal-output, .signal-vessel').count(), 0, 'The regular circuit has no repeated state labels or separate vessels');
  const epsilon = 1e-8;
  const nodes = new Map(actual.nodes.map(node => [`${node.boundary}:${node.basis}`, node.amplitude]));
  for (const [boundary, state] of expected.snapshots.entries()) {
    state.forEach((amplitude, basis) => {
      if (Math.abs(amplitude) <= epsilon && !nodes.has(`${boundary}:${basis}`)) return;
      assert.ok(Math.abs(nodes.get(`${boundary}:${basis}`) - amplitude) < epsilon,
        `Boundary ${boundary}, basis ${basis} shows the actual joint amplitude`);
    });
  }
  for (const node of actual.nodes) {
    assert.ok(Number.isFinite(node.amplitude) && Math.abs(node.amplitude - expected.snapshots[node.boundary]?.[node.basis]) < epsilon,
      'The mirror contains no invented state or invalid amplitude');
  }
  const edgeKey = edge => `${edge.column}:${edge.from}:${edge.to}`;
  const edges = new Map(actual.edges.map(edge => [edgeKey(edge), edge]));
  const expectedEdges = expected.columns.flatMap((column, index) => column.map(edge => ({ ...edge, column: index })));
  assert.equal(actual.edges.length, expectedEdges.length, 'Only actual nonzero amplitude contributions are highlighted');
  for (const edge of expectedEdges) {
    assert.ok(Math.abs(edges.get(edgeKey(edge))?.amplitude - edge.amplitude) < epsilon,
      `Column ${edge.column} highlights the correct ${edge.from} → ${edge.to} contribution`);
  }
  const target = Array(2 ** puzzle.wires).fill(0);
  actual.targets.forEach(node => { target[node.basis] = node.amplitude; });
  assert.ok(stateEqual(target, puzzle.target), 'The target markers preserve the complete target, including relative phase');
  assert.equal(actual.targets.length, puzzle.target.filter(amplitude => Math.abs(amplitude) > epsilon).length, 'Only occupied target outcomes have markers');
  const diagram = await flow.boundingBox(), circuit = await page.locator('#signal-board').boundingBox();
  assert.ok(Math.abs(diagram.width - circuit.width) < 0.1, 'The mirror uses exactly the same horizontal scale as the circuit');
  assert.ok(Math.abs(diagram.x - circuit.x) < 0.2, 'Circuit columns and mirrored transitions align on screen');
  const marker = await page.locator('.signal-flow-selection').boundingBox();
  const selected = await page.locator('[data-hole][aria-pressed="true"]').boundingBox();
  if (marker && selected) assert.ok(Math.abs(marker.x + marker.width / 2 - selected.x - selected.width / 2) < 0.2,
    'The selected-hole highlight is centered below its circuit gate');
  return expected.snapshots.at(-1).flatMap((amplitude, basis) => Math.abs(amplitude) <= epsilon ? [] : [basis.toString(2).padStart(puzzle.wires, '0')]);
}

async function finalAmplitudes(page, puzzle) {
  const values = selector => page.locator(selector).evaluateAll((nodes, length) => {
    const result = Array(length).fill(0);
    nodes.forEach(node => { result[Number(node.dataset.basis)] = Number(node.dataset.amplitude); });
    return result;
  }, 2 ** puzzle.wires);
  return Promise.all([
    values(`#signal-flow .signal-flow-node[data-boundary="${puzzle.columns.length}"]`),
    values('#signal-flow .signal-flow-target'),
  ]);
}

async function selectedInView(page) {
  const hole = await page.locator('[data-hole][aria-pressed="true"]').boundingBox();
  const scroll = await page.locator('#signal-scroll').boundingBox();
  const visible = hole.x >= scroll.x - 1 && hole.x + hole.width <= scroll.x + scroll.width + 1;
  if (!visible) await page.screenshot({ path: resolve(output, 'selected-hole-overflow.png'), fullPage: true });
  assert.ok(visible, `The selected hole is revealed within the horizontal scroller: ${JSON.stringify({ hole, scroll })}`);
}

async function pinnedBasisLabels(page) {
  const diagram = await page.locator('#signal-flow').boundingBox();
  const left = diagram.x + await page.locator('#flow-scroll').evaluate(node => node.scrollLeft);
  const labels = await page.locator('#signal-flow .signal-flow-label').evaluateAll(nodes => nodes.map(node => {
    const bounds = node.getBoundingClientRect(); return { left: bounds.left, right: bounds.right };
  }));
  assert.ok(labels.length > 0 && labels.every(label => label.left >= left + 7 && label.right <= left + 42),
    'The fixed basis labels remain readable at the left of the mirror after horizontal scrolling');
}

async function keyboardAndMouse(page) {
  await page.locator('#level').selectOption('6');
  await emptySlots(page);
  await page.locator('[data-hole="a"]').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('[data-hole="a"]').getAttribute('aria-pressed'), 'true', 'A horizontal arrow does not jump to a hole directly below');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.hole), 'b', 'Down moves to the hole below');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.hole), 'b', 'Spatial navigation does not wrap across the board');
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.hole), 'a');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.hole), 'b', 'Tab reaches the next hole');
  assert.equal(await page.locator('[data-hole="b"]').getAttribute('aria-pressed'), 'true', 'Tab selects the focused hole');
  await visibleChoices(page, getHoles(LEVELS[5])[1]);
  await page.keyboard.press('h');
  assert.equal(await page.locator('[data-hole="b"]').getAttribute('data-filled'), 'false', 'Unavailable gate shortcuts are ignored');
  assert.equal(await page.locator('#status').innerText(), '');
  await numberedGate(page, 'X');
  assert.match(await page.locator('[data-hole="b"]').getAttribute('aria-label'), /: X$/);
  assert.equal(await page.locator('[data-hole="a"]').getAttribute('data-filled'), 'false', 'The numbered shortcut affects the focused hole');
  await page.locator('[data-hole="b"]').click({ button: 'right' });
  assert.equal(await page.locator('[data-hole="b"]').getAttribute('data-filled'), 'false', 'Right-click erases the gate under the pointer');
  await page.keyboard.press('Control+z');
  assert.match(await page.locator('[data-hole="b"]').getAttribute('aria-label'), /: X$/, 'Undo restores a right-clicked gate');
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('#undo').isDisabled(), true);
  await page.locator('[data-hole="b"]').click({ button: 'right' });
  assert.equal(await page.locator('#undo').isDisabled(), true, 'Right-clicking an empty slot does not create an undo step');

  await page.locator('#level').selectOption('11');
  await page.locator('[data-choice="I"]').focus();
  const keypadPuzzle = LEVELS[10], solution = solutionFor(keypadPuzzle);
  for (const hole of getHoles(keypadPuzzle)) {
    if (await page.locator('#win-dialog').evaluate(dialog => dialog.open)) break;
    if (solution[hole.id] === 'I') continue;
    assert.equal(await page.locator(`[data-hole="${hole.id}"]`).getAttribute('aria-pressed'), 'true', 'Numbered placement advances to the next hole');
    await visibleChoices(page, hole);
    await numberedGate(page, solution[hole.id]);
  }
  await page.locator('#win-dialog[open]').waitFor();
  await completionBoard(page);
  await closeWin(page);
  console.log('QoL: focus selection, spatial arrows, single/two-wire numbered shortcuts, unsupported keys, right-click erase and undo verified.');
}

async function horizontalNavigation(page) {
  await page.locator('#level').selectOption('12');
  await page.locator('[data-hole="a"]').focus();
  await page.locator('#signal-scroll').evaluate(element => { element.scrollLeft = 0; });
  const scrollY = await page.evaluate(() => window.scrollY);
  for (const hole of ['b', 'd', 'e']) {
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.hole), hole, 'Right follows the nearest aligned slot');
    await selectedInView(page);
    assert.equal(await page.evaluate(() => window.scrollY), scrollY, 'Revealing a slot does not move the page vertically');
  }
  await numberedGate(page, 'Z');
  assert.equal(await page.locator('[data-hole="a"]').getAttribute('aria-pressed'), 'true', 'Placement advances to the next empty slot');
  await selectedInView(page);
  assert.equal(await page.evaluate(() => window.scrollY), scrollY, 'Auto-advance only scrolls the circuit horizontally');
  await page.waitForFunction(() => Math.abs(document.querySelector('#flow-scroll').scrollLeft - document.querySelector('#signal-scroll').scrollLeft) < 1);
  await page.locator('#flow-scroll').evaluate(element => { element.scrollLeft = element.scrollWidth; element.dispatchEvent(new Event('scroll')); });
  await page.waitForFunction(() => Math.abs(document.querySelector('#flow-scroll').scrollLeft - document.querySelector('#signal-scroll').scrollLeft) < 1);
  await pinnedBasisLabels(page);
  assert.equal(await page.evaluate(() => window.scrollY), scrollY, 'Scrolling the mirror does not move the whole page');
  await page.locator('[data-hole="d"]').focus();
  const column = LEVELS.at(-1).columns.findIndex(entries => entries.some(entry => entry.id === 'd'));
  assert.equal(await page.locator('.signal-flow-selection').getAttribute('data-column'), String(column), 'The selected circuit slot highlights the corresponding mirror column');
  await selectedInView(page);
  await page.waitForFunction(() => Math.abs(document.querySelector('#flow-scroll').scrollLeft - document.querySelector('#signal-scroll').scrollLeft) < 1);
  await pinnedBasisLabels(page);
}

async function centeredProgress(page, hole, column) {
  await page.waitForFunction(() => Math.abs(document.querySelector('#flow-scroll').scrollLeft - document.querySelector('#signal-scroll').scrollLeft) < 1);
  const report = await page.evaluate(hole => {
    const circuit = document.getElementById('signal-scroll'), flow = document.getElementById('flow-scroll');
    // A reserved scrollbar gutter can make scrollWidth - clientWidth exceed
    // Chrome's native limit. Probe that limit and restore before the next frame.
    const maximum = Math.min(...[circuit, flow].map(scroll => {
      const left = scroll.scrollLeft; scroll.scrollLeft = scroll.scrollWidth;
      const end = scroll.scrollLeft; scroll.scrollLeft = left; return end;
    }));
    return [[circuit, document.querySelector(`[data-hole="${hole}"]`)], [flow, document.querySelector('.signal-flow-selection')]].map(([scroll, node]) => {
      const bounds = scroll.getBoundingClientRect(), target = node.getBoundingClientRect();
      const center = target.left + target.width / 2;
      const difference = center - (bounds.left + scroll.clientLeft + (40 + scroll.clientWidth) / 2);
      return { left: scroll.scrollLeft, maximum, difference, visible: center >= bounds.left + 40 && center <= bounds.left + scroll.clientWidth };
    });
  }, hole);
  const followed = report.every(({ left, maximum, difference, visible }) => visible &&
    (Math.abs(difference) <= 1 || difference < 0 && left <= 1 || difference > 0 && Math.abs(left - maximum) <= 1));
  if (!followed) await page.screenshot({ path: resolve(output, 'navigation-centering-failure.png'), fullPage: true });
  assert.ok(followed,
  `The active gate and mirrored column stay centered after the pinned labels, or reach the circuit edge: ${JSON.stringify(report)}`);
  assert.equal(await page.locator('.signal-flow-selection').getAttribute('data-column'), String(column), 'The mirror follows the active or reviewed hole');
  await pinnedBasisLabels(page);
}

async function actionKeepsPage(page, locator) {
  // Playwright may first reveal the tapped control. Measure from pointerdown so
  // this assertion covers the game's follow action rather than that setup.
  await page.evaluate(() => document.addEventListener('pointerdown', () => { document.documentElement.dataset.navigationStartY = String(scrollY); }, { capture: true, once: true }));
  await activate(page, locator);
  assert.equal(await page.evaluate(() => scrollY), await page.evaluate(() => Number(document.documentElement.dataset.navigationStartY)), 'Following progress never moves the page vertically');
}

async function completionInView(page, columns) {
  const report = await page.locator('#flow-scroll').evaluate((scroll, columns) => {
    const bounds = scroll.getBoundingClientRect();
    return [...scroll.querySelectorAll(`.signal-flow-target, .signal-flow-node[data-boundary="${columns}"]`)].every(node => {
      const target = node.getBoundingClientRect();
      return target.left >= bounds.left + 40 && target.right <= bounds.left + scroll.clientWidth;
    });
  }, columns);
  assert.ok(report, 'Completion reveals the output and target beyond the pinned labels');
  await pinnedBasisLabels(page);
}

async function progressNavigation(page) {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const holdBoard = async route => {
    if (new URL(route.request().url()).searchParams.get('level') === '12') release(route);
    else await route.fallback();
  };
  await page.route('**/api/leaderboard?**', holdBoard);
  await page.locator('#level').selectOption('12');
  const board = await held;
  await page.locator('#flow-scroll').evaluate(node => { node.scrollLeft = (node.scrollWidth - node.clientWidth) * .4; node.dispatchEvent(new Event('scroll')); });
  await page.waitForFunction(() => Math.abs(document.querySelector('#flow-scroll').scrollLeft - document.querySelector('#signal-scroll').scrollLeft) < 1);
  const manual = await page.locator('#flow-scroll').evaluate(node => node.scrollLeft);
  const response = page.waitForResponse(response => response.request().url() === board.request().url());
  await board.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [], currentPlayer: null, total: 0 }) });
  await (await response).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  assert.equal(await page.locator('#flow-scroll').evaluate(node => node.scrollLeft), manual, 'Completion metadata preserves manual exploration');
  await page.unroute('**/api/leaderboard?**', holdBoard);
  await activate(page, page.locator('#mode-campaign'));
  assert.equal(await page.locator('#flow-scroll').evaluate(node => node.scrollLeft), manual, 'A board re-render preserves manual exploration');
  const size = page.viewportSize();
  await page.setViewportSize({ ...size, height: size.height - 70 });
  assert.equal(await page.locator('#flow-scroll').evaluate(node => node.scrollLeft), manual, 'A mobile browser height change preserves manual exploration');
  await page.setViewportSize(size);
  await pinnedBasisLabels(page);

  await activate(page, page.locator('#mode-random'));
  await openDetails(page, '#advanced-features');
  const columns = Array.from({ length: 16 }, () => []);
  columns[0] = [0, 1, 2, 3].map(wire => ({ gate: 'H', wires: [wire] }));
  for (const [index, column] of [3, 6, 9, 12].entries()) columns[column] = [{ id: 'h' + (index + 1), wires: [0], choices: ['I', 'X'] }];
  columns[12][0].choices = ['I', 'Z'];
  const puzzle = { wires: 4, columns, target: Array.from({ length: 16 }, (_, basis) => basis < 8 ? .25 : -.25) };
  const load = () => importPuzzle(page, puzzleData(puzzle));
  await load();
  await centeredProgress(page, 'h1', 3);
  await page.locator('#flow-scroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
  assert.ok(await page.locator('#flow-scroll').evaluate(node => node.scrollTop > 0), 'The dense mirror is vertically scrollable');
  await activate(page, page.locator('#restart'));
  assert.equal(await page.locator('#flow-scroll').evaluate(node => node.scrollTop), 0, 'Reset returns the mirror to the first basis lane');
  await centeredProgress(page, 'h1', 3);
  for (const [index, column] of [6, 9, 12].entries()) {
    await actionKeepsPage(page, page.locator('[data-choice="I"]'));
    await centeredProgress(page, 'h' + (index + 2), column);
  }
  await actionKeepsPage(page, page.locator('#undo'));
  await centeredProgress(page, 'h3', 9);
  await actionKeepsPage(page, page.locator('[data-choice="I"]'));
  await centeredProgress(page, 'h4', 12);
  await activate(page, page.locator('[data-choice="Z"]'));
  await page.locator('#win-dialog[open]').waitFor();
  await closeWin(page);
  await completionInView(page, columns.length);
  await page.locator('[data-hole="h2"]').evaluate(node => node.focus({ preventScroll: true }));
  await centeredProgress(page, 'h2', 6);

  await page.clock.pauseAt(new Date(process.env.GAME_TEST_TIME ?? '2026-10-15T10:00:00Z'));
  await activate(page, page.locator('#replay'));
  assert.equal(await page.locator('#review-note').innerText(), 'Placement 0 / 4');
  assert.equal(await page.locator('.signal-flow-selection').count(), 0, 'Replay starts with no selected gate');
  assert.equal(await page.locator('#flow-scroll').evaluate(node => node.scrollLeft), 0, 'Replay starts at the input');
  const replayY = await page.evaluate(() => scrollY);
  for (const [index, column] of [3, 6, 9].entries()) {
    await page.clock.runFor(650);
    assert.equal(await page.locator('#review-note').innerText(), `Placement ${index + 1} / 4`);
    await centeredProgress(page, 'h' + (index + 1), column);
    assert.equal(await page.evaluate(() => scrollY), replayY, 'Timed replay follows columns without moving the page vertically');
  }
  await page.clock.runFor(650);
  await completionInView(page, columns.length);
  await activate(page, page.locator('#sequence [data-step="2"]'));
  await centeredProgress(page, 'h2', 6);
  await activate(page, page.locator('#resume-round'));
  await completionInView(page, columns.length);
  await page.clock.resume();
  await page.locator('#flow-scroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
  await load();
  assert.equal(await page.locator('#flow-scroll').evaluate(node => node.scrollTop), 0, 'Loading another puzzle returns the mirror to the first basis lane');
  await noOverflow(page); await accessibility(page);
  await page.screenshot({ path: resolve(output, `navigation-${size.width}.png`), fullPage: true });
  await page.locator('#flow-scroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
  await activate(page, page.locator('#new-puzzle'));
  assert.equal(await page.locator('#flow-scroll').evaluate(node => node.scrollTop), 0, 'New puzzle returns the mirror to the first basis lane');
}

async function openDetails(page, selector) {
  if (!await page.locator(selector).evaluate(element => element.open)) {
    await activate(page, page.locator(`${selector} > summary`));
  }
}

async function openJsonDialog(page, action = 'input-json') {
  if (await page.locator('#puzzle-json-dialog').evaluate(dialog => dialog.open)) return;
  await activate(page, page.locator('#' + action));
  await page.locator('#puzzle-json-dialog[open]').waitFor();
}

async function importPuzzle(page, puzzle) {
  await openJsonDialog(page);
  await page.locator('#puzzle-json-text').fill(JSON.stringify(puzzle));
  await activate(page, page.locator('#puzzle-json-apply'));
  await page.locator('#puzzle-json-dialog').waitFor({ state: 'hidden' });
  return validateCustomPuzzle(puzzle);
}

async function exportedPuzzle(page, download = false) {
  await openJsonDialog(page, 'share-json');
  const data = JSON.parse(await page.locator('#puzzle-json-text').inputValue());
  assert.deepEqual(Object.keys(data).sort(), ['columns', 'target', 'wires'], 'Custom files contain only the circuit and its target');
  noBenchmark(data, 'An exported custom circuit');
  noPuzzleMetadata(data);
  if (download) {
    await page.screenshot({ path: resolve(output, `custom-json-quantum-signals-${await page.evaluate(() => innerWidth)}.png`), fullPage: true });
    const pending = page.waitForEvent('download');
    await activate(page, page.locator('#puzzle-json-download'));
    const file = await pending;
    assert.match(file.suggestedFilename(), /\.json$/);
    assert.deepEqual(JSON.parse(await readFile(await file.path(), 'utf8')), data, 'Downloaded JSON preserves the complete custom puzzle');
    await accessibility(page);
  }
  await page.keyboard.press('Escape');
  return data;
}

function solutionFor(puzzle) {
  const solution = solvePuzzle(puzzle, { limit: 1 })[0];
  assert.ok(solution, 'The circuit has a playable solution');
  return solution;
}

async function place(page, hole, gate) {
  await activate(page, page.locator(`[data-hole="${hole}"]`));
  await activate(page, page.locator(`[data-choice="${gate}"]`));
}

async function finish(page, puzzle) {
  noBenchmark(puzzle, 'The playable circuit');
  const solution = solutionFor(puzzle);
  let chosen = await placedGates(page, puzzle);
  for (const hole of getHoles(puzzle)) {
    if (simulate(puzzle, chosen).solved) break;
    const gate = solution[hole.id];
    if (chosen[hole.id] === gate || (gate === 'I' && !Object.hasOwn(chosen, hole.id))) continue;
    await activate(page, page.locator(`[data-hole="${hole.id}"]`));
    await visibleChoices(page, hole);
    await activate(page, page.locator(gate === 'I' ? '#erase-gate' : `[data-choice="${gate}"]`));
    chosen = await placedGates(page, puzzle);
  }
  assert.equal(simulate(puzzle, chosen).solved, true, 'The chosen gates reach the target with optional identities omitted');
  if (!await page.locator('#win-dialog').evaluate(dialog => dialog.open)) await activate(page, page.locator('#show-results'));
  await page.locator('#win-dialog[open]').waitFor();
  await page.waitForFunction(() => document.getElementById('score-status').textContent !== 'Saving…');
  await completionBoard(page);
  assert.equal(await page.locator('[data-hole][data-filled="true"]').count(), Object.keys(chosen).length,
    'The solved circuit shows only gates actually placed, leaving optional identities empty');
  assert.equal(await page.locator('#win-summary').innerText(), 'Target reached.');
  const [current, target] = await finalAmplitudes(page, puzzle);
  assert.ok(stateEqual(current, target), 'The solved mirror endpoints match the complete target state');
  await gateGeometry(page, puzzle, chosen);
  await basisFlow(page, puzzle, chosen);
  return chosen;
}

async function closeWin(page) { await activate(page, page.locator('#close-win')); }

async function registerCompletion(page, name, { retry = false } = {}) {
  if (await page.locator('#score-form').isVisible()) {
    await page.locator('#player-name').fill(name);
    if (retry) {
      const fail = route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Temporarily unavailable."}' });
      await page.route('**/api/leaderboard', fail);
      await activate(page, page.locator('#submit-score'));
      await page.locator('#score-status').filter({ hasText: /unavailable|try again/i }).waitFor();
      assert.equal(await page.locator('#score-form').isVisible(), true, 'A failed completion request can be retried');
      assert.equal(await page.locator('#result-actions').isVisible(), true, 'Registration failures do not block game actions');
      await page.unroute('**/api/leaderboard', fail);
    }
    const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/leaderboard' &&
      response.request().method() === 'POST' && response.status() < 400);
    await activate(page, page.locator('#submit-score'));
    const response = checkCompletionPayload(await (await pending).json());
    assert.equal(response.currentPlayer?.name, name);
  } else {
    assert.equal(retry, false, 'The initial registration retry is exercised manually');
    assert.equal(await page.locator('#nickname-value').inputValue(), name, 'Automatic registration uses the remembered nickname');
  }
  await page.getByText('Completion saved.', { exact: true }).waitFor();
  await completionBoard(page);
  assert.equal(await page.locator('#score-form').isVisible(), false, 'A saved completion replaces the optional form');
  for (const selector of ['#leaderboard-body', '#result-leaderboard-body']) {
    const row = page.locator(`${selector} tr`).filter({ hasText: name }).first();
    assert.equal(await row.locator('input[type="checkbox"]').isChecked(), true, 'The saved player appears as completed');
  }
  assert.equal(await page.locator('#result-actions').isVisible(), true, 'Game actions stay available after optional registration');
  await page.screenshot({ path: resolve(output, `${await page.evaluate(() => innerWidth)}-completion-${name.toLowerCase().replace(/\W+/g, '-')}.png`), fullPage: true });
}

async function retainedCompletion(page, puzzle) {
  await activate(page, page.locator('#try-again'));
  assert.equal(await page.locator('#leaderboard-body .current-player input[type="checkbox"]').isChecked(), true,
    'Resetting a completed puzzle retains the player completion');
  await finish(page, puzzle);
  assert.equal(await page.locator('#score-form').isVisible(), false, 'Finishing the same puzzle again does not request another registration');
}

async function completionActions(page) {
  await activate(page, page.locator('#mode-campaign'));
  await page.locator('#level').selectOption('1');
  await finish(page, LEVELS[0]);
  assert.equal(await page.locator('#result-actions').isVisible(), true, 'Completion actions remain available after registration settles');
  await activate(page, page.locator('#result-next'));
  assert.equal(await page.locator('#level').inputValue(), '2', 'Next level advances directly from completion');
  assert.equal(await page.locator('#win-dialog').evaluate(dialog => dialog.open), false);
  await finish(page, LEVELS[1]);
  await openDetails(page, '#result-advanced-features');
  await activate(page, page.locator('#replay-result'));
  await page.locator('#review-controls:not([hidden])').waitFor();
  assert.equal(await page.locator('[data-hole]').first().isDisabled(), true, 'The completion replay opens a locked review');
  await activate(page, page.locator('#resume-round'));
  assert.equal(await page.locator('#review-controls').isVisible(), false);
  await activate(page, page.locator('#show-results'));
  await page.locator('#win-dialog[open]').waitFor();
  await completionBoard(page);
  await openDetails(page, '#result-advanced-features');
  await activate(page, page.locator('#share-result'));
  await page.locator('#share-dialog[open]').waitFor();
  assert.equal(await page.locator('#share-title').innerText(), 'Share your replay');
  await activate(page, page.locator('#close-share'));
  await activate(page, page.locator('#try-again'));
  assert.equal(await page.locator('[data-hole][data-filled="true"]').count(), 0, 'Try again resets the completed circuit');
  assert.equal(await page.locator('#show-results').isVisible(), false);
  await completionBoard(page);
}

async function downloadReplay(page) {
  await openDetails(page, '#advanced-features');
  const workers = [], track = worker => workers.push(worker);
  page.on('worker', track);
  try {
    await activate(page, page.locator('#share-replay'));
    await page.locator('#share-dialog[open]').waitFor();
    assert.equal(await page.locator('#share-title').innerText(), 'Share your replay');
    await completionBoard(page);
    await page.locator('#share-preview').waitFor({ state: 'visible' });
    await page.locator('#share-preview').evaluate(image => image.decode());
    const preview = await page.locator('#share-preview').getAttribute('src');
    assert.equal(workers.length, 1, 'Sharing renders one still image without encoding the replay');
    assert.equal(await page.locator('#copy-gif').isEnabled(), true, 'The still image can be copied before downloading');
    const pending = page.waitForEvent('download');
    await activate(page, page.getByRole('button', { name: 'Download the replay', exact: true }));
    const download = await pending, bytes = await readFile(await download.path());
    assert.match(download.suggestedFilename(), /\.gif$/);
    assert.match(bytes.toString('ascii', 0, 6), /^GIF8[79]a$/);
    assert.ok(bytes.length > 1000, 'The replay contains actual animation data');
    assert.equal(workers.length, 2, 'Download starts one GIF worker after the still renderer');
    assert.equal(await page.locator('#share-preview').getAttribute('src'), preview, 'Downloading keeps the still preview');
    const cached = page.waitForEvent('download');
    await activate(page, page.locator('#download-gif'));
    assert.deepEqual(await readFile(await (await cached).path()), bytes);
    assert.equal(workers.length, 2, 'Repeated downloads reuse the completed encoding');
    await activate(page, page.locator('#close-share'));
    await activate(page, page.locator('#advanced-features > summary'));
  } finally { page.off('worker', track); }
}

async function currentPuzzle(page) {
  // Files omit internal hole IDs. Import the export before playing its witness
  // so the generated replay IDs agree with the displayed board.
  const puzzle = await importPuzzle(page, await exportedPuzzle(page));
  noBenchmark(puzzle, 'The parsed custom circuit');
  return puzzle;
}

async function customAndRandom(page) {
  const requests = completionRequests;
  await activate(page, page.locator('#mode-random'));
  for (const difficulty of ['1', '2', '3']) {
    await page.locator('#difficulty').selectOption(difficulty);
    await activate(page, page.locator('#new-puzzle'));
    const puzzle = await currentPuzzle(page);
    await noOverflow(page);
    await finish(page, puzzle);
    await completionBoard(page);
    await closeWin(page);
  }
  await openJsonDialog(page);
  for (const invalid of ['{', '{}', JSON.stringify({ ...puzzleData(LEVELS[0]), wires: 500 }),
    JSON.stringify({ wires: 1, columns: [[{ wires: [0], choices: ['I', 'X'] }]], target: { 0: 1, 1: 1 } })]) {
    await page.locator('#puzzle-json-text').fill(invalid);
    await activate(page, page.locator('#puzzle-json-apply'));
    assert.ok(await page.locator('#puzzle-json-status').innerText(), 'Malformed custom puzzles receive a readable error');
    assert.equal(await page.locator('#win-dialog').evaluate(dialog => dialog.open), false);
  }
  await page.locator('#puzzle-json-text').fill(JSON.stringify(puzzleData(LEVELS.at(-1))));
  const filled = await page.locator('[data-hole][data-filled="true"]').count();
  await page.locator('#puzzle-json-text').focus();
  await page.keyboard.press('Digit2');
  assert.equal(await page.locator('[data-hole][data-filled="true"]').count(), filled, 'Number keys in the editor do not place gates');
  const custom = await importPuzzle(page, puzzleData(LEVELS.at(-1)));
  await finish(page, custom);
  await completionBoard(page);
  await closeWin(page);
  assert.equal(completionRequests, requests, 'Random/custom rounds make no completion-list requests');
}

async function visualEditor(page) {
  await activate(page, page.locator('#mode-campaign'));
  await page.locator('#level').selectOption('1');
  await openDetails(page, '#advanced-features');
  for (const selector of ['#circuit-editor-controls', '#edit-circuit', '#new-circuit']) {
    assert.equal(await page.locator(selector).isVisible(), false, 'Levels hide custom editing controls');
  }
  await activate(page, page.locator('#mode-random'));
  await importPuzzle(page, puzzleData(LEVELS[0]));
  const originalBoard = await page.locator('#signal-board').innerHTML();
  assert.equal(await page.locator('#copy-puzzle, details#custom-details').count(), 0, 'The editor opens with explicit actions');
  await activate(page, page.locator('#new-circuit'));
  assert.equal(await page.locator('#custom-details').evaluate(editor => editor.tagName), 'DIV');
  assert.equal(await page.locator('#custom-details').isVisible(), true);
  assert.equal(await page.locator('#editor-wires').inputValue(), '2');
  assert.equal(await page.locator('#editor-columns').inputValue(), '4');
  assert.equal(await page.locator('[data-editor-cell]').count(), 8);
  assert.ok(await page.locator('[data-editor-cell]').evaluateAll(buttons => buttons.every(button => button.getAttribute('aria-label').endsWith('Empty wire'))), 'Scratch starts with empty wires');
  assert.deepEqual(await page.locator('[data-editor-target]').evaluateAll(buttons => buttons.map(button => button.dataset.sign)), ['1', '0', '0', '0'], 'Scratch starts at the all-zero basis state');
  await activate(page, page.locator('[data-editor-cell="0:0"]'));
  await activate(page, page.locator('[data-editor-tool="X"]'));
  await activate(page, page.locator('#new-circuit'));
  assert.ok((await page.locator('[data-editor-cell]').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))).every(label => label.endsWith('Empty wire')), 'Start from scratch clears a previous draft');
  assert.equal(await page.locator('#signal-board').innerHTML(), originalBoard, 'Editing a scratch draft does not change the active game');
  await activate(page, page.locator('#edit-circuit'));
  assert.equal(await page.locator('#editor-wires').inputValue(), String(LEVELS[0].wires), 'Edit this circuit reloads the active original puzzle');
  assert.equal(await page.locator('#editor-columns').inputValue(), String(LEVELS[0].columns.length));
  assert.match(await page.locator('[data-editor-cell="0:0"]').getAttribute('aria-label'), /Hole$/);
  assert.deepEqual(await page.locator('[data-editor-target]').evaluateAll(buttons => buttons.map(button => button.dataset.sign)), ['0', '1']);
  assert.equal(await page.locator('#editor-kind, #editor-partner, #editor-targets select').count(), 0, 'Editing gates and target phases uses icons');
  const requests = completionRequests;
  const submit = () => activate(page, page.locator('#puzzle-editor-form > button[type="submit"]'));
  const cell = async (column, row, tool) => {
    await activate(page, page.locator(`[data-editor-cell="${column}:${row}"]`));
    if (tool) {
      const bounds = await page.locator('#editor-menu').boundingBox(), viewport = page.viewportSize();
      if (!bounds) {
        console.log('Editor menu hidden after cell click:', JSON.stringify(await page.evaluate(() => ({ scrollY, focused: document.activeElement?.id, menuHidden: document.querySelector('#editor-menu').hidden }))));
        await page.screenshot({ path: resolve(output, 'editor-menu-failure.png'), fullPage: true });
      }
      assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1, 'The contextual palette stays inside the viewport');
      await activate(page, page.locator(`[data-editor-tool="${tool}"]`));
    }
  };
  const offered = async (column, row, gates) => {
    await cell(column, row);
    for (const button of await page.locator('[data-editor-choice]').all()) {
      const gate = await button.getAttribute('data-editor-choice');
      if ((await button.getAttribute('aria-pressed') === 'true') !== gates.includes(gate)) {
        await activate(page, button);
      }
    }
  };
  const target = async (basis, sign) => {
    const button = page.locator('#editor-target-' + basis);
    for (let clicks = 0; await button.getAttribute('data-sign') !== String(sign) && clicks < 3; clicks++) await activate(page, button);
    assert.equal(await button.getAttribute('data-sign'), String(sign), 'Target dots cycle off, positive, negative');
    if (sign) {
      const appearance = await button.locator('.editor-target-dot').evaluate(dot => {
        const context = document.createElement('canvas').getContext('2d');
        const style = getComputedStyle(dot);
        context.fillStyle = style.backgroundColor; const fill = context.fillStyle;
        context.fillStyle = style.borderTopColor;
        return { fill, outline: context.fillStyle, width: parseFloat(style.borderTopWidth) };
      });
      assert.equal(appearance.fill, phaseColor(sign), 'Editor phase dots use the shared black and white fills');
      assert.equal(appearance.outline, PHASE_COLORS.negative, 'Both editor target phases have white outlines');
      assert.ok(appearance.width > 0, 'Editor phase outlines remain visible');
    }
  };
  const connect = async (column, from, to, tool) => {
    await cell(column, from, tool);
    assert.equal(await page.locator(`[data-editor-cell="${column}:${from}"][data-endpoint]`).count(), 1, 'A first endpoint remains visible before linking');
    assert.equal(await page.locator(`[data-editor-cell="${column}:${to}"][data-connectable]`).count(), 1);
    await cell(column, to);
    assert.equal(await page.locator(`[data-editor-cell^="${column}:"][data-endpoint]`).count(), 0, 'A second wire completes the link');
  };

  await cell(0, 0);
  assert.equal(await page.locator('#editor-menu').isVisible(), true, 'Selecting a cell opens its gate icons');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#editor-menu').isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.editorCell), '0:0', 'Escape returns focus to the edited cell');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#editor-menu').isVisible(), true, 'Keyboard activation opens the same gate palette');
  await activate(page, page.locator('#editor-targets').locator('..').locator('legend'));
  assert.equal(await page.locator('#editor-menu').isVisible(), false, 'Clicking outside closes the palette');

  await target(1, 0); await submit();
  assert.match(await page.locator('#custom-status').innerText(), /at least one target/i, 'An empty target remains an editable draft');
  await target(0, 1); await target(1, 1); await submit();
  assert.match(await page.locator('#custom-status').innerText(), /cannot be reached/i, 'The GUI rejects unreachable target choices');
  await offered(0, 0, ['H']); await submit();
  assert.match(await page.locator('#custom-status').innerText(), /gate choices/i, 'A temporarily incomplete hole cannot be played');
  await offered(0, 0, ['I', 'H']);
  await submit();
  const superposition = await currentPuzzle(page);
  assert.ok(stateEqual(superposition.target, [Math.SQRT1_2, Math.SQRT1_2]), 'Signed target selections normalize automatically');
  await finish(page, superposition); await closeWin(page);
  assert.equal(await page.locator('#mode-random').getAttribute('aria-pressed'), 'true', 'Playing a visual draft starts an unranked custom round');
  assert.equal(completionRequests, requests, 'Editing and playing a custom puzzle does not request completion records');

  await page.locator('#editor-wires').selectOption('2');
  await page.locator('#editor-columns').selectOption('2');
  await cell(0, 0, 'empty'); await cell(0, 1, 'X');
  await page.locator('[data-editor-cell="0:0"]').focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.editorCell), '0:1', 'Arrow keys navigate editor cells');
  await page.keyboard.press('r');
  assert.equal(await page.locator('[data-hole][data-filled="true"]').count(), 1, 'Editor keyboard input does not reset the active game');
  await page.keyboard.press('Delete');
  assert.match(await page.locator('[data-editor-cell="0:1"]').getAttribute('aria-label'), /Empty wire/, 'Delete clears the editor cell without changing gameplay');
  await cell(0, 1, 'X'); await cell(1, 0, 'control');
  await submit();
  assert.match(await page.locator('#custom-status').innerText(), /unconnected endpoint/i, 'Play reports unfinished links');
  assert.equal(await page.locator('[data-editor-cell="1:0"]').getAttribute('data-endpoint'), 'control', 'A failed Play preserves the unfinished endpoint');
  assert.match(await page.locator('[data-editor-cell="0:1"]').getAttribute('aria-label'), /: X$/, 'A failed Play preserves unrelated gates');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-connectable]').count(), 0, 'Escape pauses linking without erasing its endpoint');
  await cell(1, 0); await cell(1, 1);
  assert.match(await page.locator('[data-editor-cell="1:0"]').getAttribute('aria-label'), /upper control/, 'An upper control links to a lower target');
  await connect(1, 1, 0, 'control');
  assert.match(await page.locator('[data-editor-cell="1:0"]').getAttribute('aria-label'), /lower control/, 'Starting from the lower control preserves CNOT direction');
  await connect(1, 1, 0, 'target');
  assert.match(await page.locator('[data-editor-cell="1:0"]').getAttribute('aria-label'), /upper control/, 'Starting at the target connects the complementary control');
  await connect(1, 0, 1, 'phase');
  assert.match(await page.locator('[data-editor-cell="1:0"]').getAttribute('aria-label'), /CZ/, 'Two phase endpoints form a CZ');
  await page.keyboard.press('Delete');
  assert.equal(await page.locator('.editor-link').count(), 0, 'Delete removes an entire paired gate');
  await connect(1, 0, 1, 'hole-pair');
  await offered(1, 0, ['I', 'CX', 'XC']);
  await target(0, 0); await target(3, 1);
  await submit();
  const reverseData = await exportedPuzzle(page), reverse = await importPuzzle(page, reverseData);
  assert.deepEqual(reverseData.target, { '11': 1 }, 'GUI export uses readable signed basis labels');
  const reverseHole = getHoles(reverse)[0];
  await place(page, reverseHole.id, 'CX');
  assert.equal(await page.locator('#win-dialog').evaluate(dialog => dialog.open), false, 'Upper control does not reach the lower-control target');
  await gateGeometry(page, reverse, { [reverseHole.id]: 'CX' });
  await place(page, reverseHole.id, 'XC');
  await page.locator('#win-dialog[open]').waitFor(); await closeWin(page);
  await gateGeometry(page, reverse, { [reverseHole.id]: 'XC' });

  await page.locator('#editor-wires').selectOption('4');
  await cell(1, 0, 'empty'); await connect(1, 0, 3, 'hole-pair');
  assert.match(await page.locator('[data-editor-cell="1:3"]').getAttribute('aria-label'), /Hole/, 'Paired holes can connect nonadjacent wires');
  await page.locator('#editor-columns').selectOption('16');
  await connect(15, 3, 0, 'phase');
  assert.equal(await page.locator('[data-editor-cell]').count(), 64);
  assert.equal(await page.locator('[data-editor-target]').count(), 16);
  const targetBounds = await page.locator('[data-editor-target]').evaluateAll(nodes => nodes.map(node => {
    const bounds = node.getBoundingClientRect(); return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  }));
  assert.ok(targetBounds.every((bounds, index) => Math.abs(bounds.x - targetBounds[0].x) < 1 && bounds.width >= 44 && bounds.height >= 44 && (index === 0 || bounds.y > targetBounds[index - 1].y)), 'Target states form a vertical column with touchable rows');
  await target(15, 1); await target(15, -1); await target(15, 0);
  await noOverflow(page);
  await page.locator('#editor-wires').selectOption('2');
  await page.locator('#editor-columns').selectOption('4');
  assert.equal(await page.locator('[data-editor-cell]').count(), 8);
  assert.match(await page.locator('[data-editor-cell="1:0"]').getAttribute('aria-label'), /Empty wire/,
    'Removing wires and columns removes affected paired gates without leaving endpoints');
  assert.match(await page.locator('[data-editor-cell="0:1"]').getAttribute('aria-label'), /: X$/, 'Resizing preserves unaffected gates');
  assert.equal(await page.locator('[data-editor-target]').count(), 4);

  await cell(0, 1, 'empty'); await cell(0, 0, 'H'); await connect(1, 0, 1, 'control');
  await cell(2, 0, 'Z'); await cell(2, 0, 'empty');
  await cell(3, 1, 'hole'); await offered(3, 1, ['I', 'Z']);
  await target(3, -1);
  await submit();
  const bellData = await exportedPuzzle(page, true), bell = validateCustomPuzzle(bellData);
  assert.deepEqual(bellData.target, { '00': 1, '11': -1 });
  assert.ok(stateEqual(bell.target, [Math.SQRT1_2, 0, 0, -Math.SQRT1_2]));
  await target(0, 1); await target(3, -1);
  await cell(3, 1);
  await noOverflow(page); await accessibility(page);
  const viewport = page.viewportSize();
  await page.screenshot({ path: resolve(output, `editor-bell-${viewport.width}.png`), fullPage: true });
  if (touchPages.has(page)) {
    await page.setViewportSize({ width: 320, height: 900 });
    await noOverflow(page); await accessibility(page);
    const hit = await page.locator('[data-editor-cell]').first().boundingBox();
    assert.ok(hit.width >= 44 && hit.height >= 44, 'Editor cells remain touchable on narrow screens');
    await page.screenshot({ path: resolve(output, 'editor-bell-320.png'), fullPage: true });
    await page.setViewportSize(viewport);
  }
  await importPuzzle(page, bellData);
  await finish(page, bell); await closeWin(page);
  await openJsonDialog(page);
  const currentBoard = await page.locator('#signal-board').innerHTML();
  for (const invalid of ['{', JSON.stringify({ wires: 2, columns: [[{ wires: [0, 0], choices: ['I', 'CX'] }]], target: { '00': 1 } })]) {
    await page.locator('#puzzle-json-text').fill(invalid);
    await activate(page, page.locator('#puzzle-json-apply'));
    assert.ok(await page.locator('#puzzle-json-status').innerText());
    assert.equal(await page.locator('#signal-board').innerHTML(), currentBoard, 'Rejected JSON imports preserve the active Signals circuit');
  }
  await page.locator('#puzzle-json-text').fill('{');
  await accessibility(page);
  await page.keyboard.press('Escape');
  await cell(3, 1); await page.keyboard.press('Escape'); await page.keyboard.press('ArrowLeft');
  await cell(2, 1, 'X'); await cell(2, 1, 'empty');
  await openJsonDialog(page);
  assert.equal(await page.locator('#puzzle-json-text').inputValue(), '{', 'Closing the dialog and editing the visual draft preserves unimported JSON text');
  await page.keyboard.press('Escape');
  assert.ok(stateEqual(validateCustomPuzzle(await exportedPuzzle(page)).target, bell.target), 'Explicit Share JSON exports the active puzzle');
  await importPuzzle(page, bellData);
  assert.equal(await page.locator('#editor-target-3').getAttribute('data-sign'), '-1', 'Signed basis labels populate the visual target');
  assert.deepEqual((await exportedPuzzle(page)).target, { '00': 1, '11': -1 }, 'Signed targets round trip unchanged');
  await finish(page, bell); await closeWin(page);
  await openDetails(page, '#advanced-features');
  await activate(page, page.locator('#replay')); await page.locator('#review-controls:not([hidden])').waitFor();
  await activate(page, page.locator('#resume-round'));
  await openJsonDialog(page);
  await page.locator('#mode-daily').evaluate(button => button.click());
  await page.locator('#daily-heading:not([hidden])').waitFor();
  assert.equal(await page.locator('#puzzle-json-dialog').isVisible(), false, 'Entering daily mode closes a stale JSON dialog');
  await dailyEditorHidden(page);
  await activate(page, page.locator('#mode-campaign'));
  for (const selector of ['#circuit-editor-controls', '#edit-circuit', '#new-circuit', '#custom-details', '#puzzle-editor-form']) {
    assert.equal(await page.locator(selector).isVisible(), false, 'Levels hide an existing custom draft');
  }
  await activate(page, page.locator('#mode-random'));
  assert.equal(await page.locator('#edit-circuit').isVisible(), true);
  assert.equal(await page.locator('#new-circuit').isVisible(), true);
  assert.equal(await page.locator('#puzzle-editor-form').isVisible(), true);
  assert.equal(await page.locator('#editor-wires').inputValue(), '2', 'Changing game modes preserves the editable draft');
  assert.equal(await page.locator('#editor-columns').inputValue(), '4');
  assert.equal(await page.locator('#editor-target-3').getAttribute('data-sign'), '-1');
  console.log('Visual editor: contextual icons, two-step links, unfinished endpoints, target-dot cycles, hole choices, validation, resizing, keyboard/touch, JSON/replay and daily visibility verified.');
}

async function dailyEditorHidden(page) {
  for (const selector of ['#circuit-editor-controls', '#edit-circuit', '#new-circuit', '#custom-details', '#puzzle-editor-form', '#share-json', '#input-json']) {
    assert.equal(await page.locator(selector).isVisible(), false, 'Daily mode hides visual editing and JSON import');
  }
}

async function denseMirror(page) {
  await activate(page, page.locator('#mode-random'));
  await openDetails(page, '#advanced-features');
  const puzzle = { wires: 4,
    columns: [[0, 1, 2, 3].map(wire => ({ gate: 'H', wires: [wire] })),
      [{ id: 'h1', wires: [0], choices: ['I', 'Z'] }]], target: Array(16).fill(0.25) };
  const load = async value => {
    await importPuzzle(page, puzzleData(value));
    await page.locator('[data-hole="h1"]').waitFor();
  };
  await load(puzzle);
  await basisFlow(page, puzzle);
  await noOverflow(page);
  await pinnedBasisLabels(page);
  assert.equal(await page.locator('#signal-flow .signal-flow-target').count(), 16, 'Four qubits show all sixteen populated outcomes in separate lanes');
  const initial = (await finalAmplitudes(page, puzzle))[1];
  assert.ok(initial.every(amplitude => Math.abs(amplitude - 0.25) < 1e-8));
  const bounds = await page.locator('#signal-flow .signal-flow-target').evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect();
    return { width: box.width, height: box.height };
  }));
  assert.ok(bounds.every(box => box.width >= 3 && box.height >= 3), 'All sixteen target markers remain visible at a narrow viewport');
  assert.ok(await page.locator('#flow-scroll').evaluate(node => node.scrollHeight > node.clientHeight), 'The sixteen-lane mirror scrolls vertically inside its own bounded region');
  await page.locator('#flow-scroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
  const region = await page.locator('#flow-scroll').boundingBox();
  const lastLabel = await page.locator('.signal-flow-label[data-basis="15"]').boundingBox();
  assert.ok(lastLabel.y >= region.y && lastLabel.y + lastLabel.height <= region.y + region.height,
    'The last basis lane and its fixed label can be reached through vertical scrolling');
  await pinnedBasisLabels(page);
  await accessibility(page);
  await page.screenshot({ path: resolve(output, 'mobile-mirror-dense-320.png'), fullPage: true });
  await load({ ...puzzle, target: puzzle.target.map(value => -value) });
  const inverted = (await finalAmplitudes(page, puzzle))[1];
  assert.deepEqual(inverted, initial, 'An irrelevant global sign leaves the target marker comparison unchanged');
  await finish(page, puzzle); await closeWin(page);
}

async function jointStateExamples(page) {
  await activate(page, page.locator('#mode-random'));
  await openDetails(page, '#advanced-features');
  const hole = [{ id: 'h1', wires: [1], choices: ['I', 'Z'] }];
  const root = { wires: 2 };
  const half = Math.SQRT1_2;
  const cases = [
    { ...root, columns: [[{ gate: 'H', wires: [0] }], [{ gate: 'CX', wires: [0, 1] }], hole],
      target: [half, 0, 0, half], active: ['00', '11'], screenshot: 'bell-paths' },
    { ...root, columns: [[{ gate: 'X', wires: [1] }], [{ gate: 'H', wires: [0] }], [{ gate: 'CX', wires: [0, 1] }], hole],
      target: [0, half, half, 0], active: ['01', '10'], screenshot: 'opposite-bell-paths' },
    { ...root, columns: [[{ gate: 'H', wires: [0] }], [{ gate: 'CX', wires: [0, 1] }], [{ gate: 'Z', wires: [0] }], hole],
      target: [half, 0, 0, -half], active: ['00', '11'], screenshot: 'phase-paths' },
    { ...root, columns: [[{ gate: 'H', wires: [0] }], [{ gate: 'H', wires: [0] }], hole],
      target: [1, 0, 0, 0], active: ['00'], screenshot: 'interference-paths' },
  ];
  for (const { active, screenshot, ...puzzle } of cases) {
    await importPuzzle(page, puzzleData(puzzle));
    assert.deepEqual(await basisFlow(page, puzzle), active, 'The mirror distinguishes correlated, anticorrelated and interfering joint outcomes');
    const targetDots = await page.locator('.signal-flow-target').evaluateAll(nodes => nodes.map(node => [node.getAttribute('fill'), node.getAttribute('stroke')]));
    const targetDot = sign => [phaseColor(sign), PHASE_COLORS.negative];
    if (screenshot === 'bell-paths') assert.deepEqual(targetDots, [targetDot(1), targetDot(1)], 'The 00 + 11 outcomes share black dots with white outlines');
    if (screenshot === 'phase-paths') assert.deepEqual(targetDots, [targetDot(1), targetDot(-1)], 'The 00 − 11 target distinguishes phase by black and white fills with white outlines');
    await gateGeometry(page, puzzle);
    await noOverflow(page);
    await page.locator('#flow-scroll').evaluate(node => { node.scrollLeft = node.scrollWidth; });
    await page.waitForFunction(() => Math.abs(document.querySelector('#flow-scroll').scrollLeft - document.querySelector('#signal-scroll').scrollLeft) < 1);
    await pinnedBasisLabels(page);
    const region = await page.locator('#flow-scroll').boundingBox();
    const targets = await page.locator('.signal-flow-target').evaluateAll(nodes => nodes.map(node => {
      const bounds = node.getBoundingClientRect(); return { left: bounds.left, right: bounds.right };
    }));
    assert.ok(targets.every(node => node.left >= region.x && node.right <= region.x + region.width), 'The phase comparison screenshot keeps target markers visible');
    const width = await page.evaluate(() => innerWidth);
    await page.screenshot({ path: resolve(output, `${width}-${screenshot}.png`), fullPage: true });
    await finish(page, puzzle); await closeWin(page);
  }
  // Keep a real placement to review/export even when this custom target was
  // already matched by its fixed gates and empty identity hole.
  if (!await page.locator('#sequence button').count()) {
    await place(page, 'h1', 'I'); await closeWin(page);
  }
  console.log('Joint-state mirror: Bell and opposite Bell states occupy different lanes; relative phase and destructive interference are preserved.');
}

async function reverseCnot(page) {
  await activate(page, page.locator('#mode-random'));
  await openDetails(page, '#advanced-features');
  const hole = { id: 'h1', wires: [0, 1], choices: ['I', 'CX', 'XC', 'CZ'] };
  const puzzle = { wires: 2,
    columns: [[{ gate: 'X', wires: [1] }], [hole]], target: [0, 0, 0, 1] };
  await importPuzzle(page, puzzleData(puzzle));
  await visibleChoices(page, hole);
  await place(page, hole.id, 'CX');
  assert.equal(await page.locator('#win-dialog').evaluate(dialog => dialog.open), false, 'An upper control leaves 01 unchanged');
  assert.deepEqual((await finalAmplitudes(page, puzzle))[0], [0, 1, 0, 0]);
  await gateGeometry(page, puzzle, { [hole.id]: 'CX' });
  if (touchPages.has(page)) await place(page, hole.id, 'XC');
  else await numberedGate(page, 'XC');
  await page.locator('#win-dialog[open]').waitFor();
  assert.equal(await page.locator('#win-summary').innerText(), 'Target reached.');
  assert.deepEqual((await finalAmplitudes(page, puzzle))[0], [0, 0, 0, 1], 'The lower control maps 01 to 11');
  await gateGeometry(page, puzzle, { [hole.id]: 'XC' });
  await basisFlow(page, puzzle, { [hole.id]: 'XC' });
  await completionBoard(page);
  await closeWin(page);
  await visibleChoices(page, hole);
  await page.locator('#flow-scroll').evaluate(node => { node.scrollLeft = node.scrollWidth; });
  await page.waitForFunction(() => Math.abs(document.querySelector('#flow-scroll').scrollLeft - document.querySelector('#signal-scroll').scrollLeft) < 1);
  await pinnedBasisLabels(page);
  await noOverflow(page); await accessibility(page);
  await page.screenshot({ path: resolve(output, `${await page.evaluate(() => innerWidth)}-xc-required.png`), fullPage: true });
  await downloadReplay(page);
  console.log('Reverse CNOT: both choices are visible; CX leaves 01, XC reaches 11 through keyboard/touch and replay export.');
}

async function controlledGeometry(page, screenshot) {
  await activate(page, page.locator('#mode-random'));
  await openDetails(page, '#advanced-features');
  const puzzle = { wires: 3,
    columns: [[{ gate: 'H', wires: [0] }, { gate: 'X', wires: [2] }],
      [{ gate: 'CX', wires: [2, 0] }],
      [{ id: 'h1', wires: [2, 0], choices: ['I', 'CX', 'XC', 'CZ'] }],
      [{ id: 'h2', wires: [0, 2], choices: ['I', 'CX', 'XC', 'CZ'] }],
      [{ gate: 'XC', wires: [2, 0] }],
      [{ gate: 'CZ', wires: [2, 0] }],
      [{ id: 'h3', wires: [1], choices: ['I', 'X'] }]], target: [1, ...Array(7).fill(0)] };
  const solution = { h1: 'XC', h2: 'XC', h3: 'X' };
  puzzle.target = simulate(puzzle, solution).state;
  await importPuzzle(page, puzzleData(puzzle));
  await gateGeometry(page, puzzle);
  await visibleChoices(page, getHoles(puzzle)[0]);
  await place(page, 'h1', 'I');
  await gateGeometry(page, puzzle, { h1: 'I' });
  await place(page, 'h1', 'CX');
  await gateGeometry(page, puzzle, { h1: 'CX' });
  await place(page, 'h1', 'XC');
  await gateGeometry(page, puzzle, { h1: 'XC' });
  await visibleChoices(page, getHoles(puzzle)[1]);
  await place(page, 'h2', 'CX');
  await gateGeometry(page, puzzle, { h1: 'XC', h2: 'CX' });
  await place(page, 'h2', 'XC');
  await gateGeometry(page, puzzle, { h1: 'XC', h2: 'XC' });
  await place(page, 'h3', 'X');
  await page.locator('#win-dialog[open]').waitFor();
  await closeWin(page);
  await gateGeometry(page, puzzle, solution);
  await activate(page, page.locator('[data-hole="h1"]'));
  await visibleChoices(page, getHoles(puzzle)[0]);
  await page.screenshot({ path: resolve(output, screenshot), fullPage: true });
  await activate(page, page.locator('#sequence [data-step="2"]'));
  assert.equal(await page.locator('[data-hole="h1"]').isDisabled(), true, 'Review locks the filled circuit');
  await gateGeometry(page, puzzle, { h1: 'CX' });
  await activate(page, page.locator('#resume-round'));
  await gateGeometry(page, puzzle, solution);
  console.log('Gate geometry: fixed/filled and reversed/nonadjacent controls, free identity slots and review all align at exact signal junctions.');
}

async function daily(page, name) {
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/daily' && response.status() === 200);
  await activate(page, page.locator('#mode-daily'));
  const payload = await (await pending).json();
  noBenchmark(payload, 'The daily response');
  noBenchmark(payload.puzzle, 'The daily circuit');
  await page.locator('#daily-heading:not([hidden])').waitFor();
  await dailyEditorHidden(page);
  const info = fixture.getDaily('quantum-signals');
  const puzzle = dailyPuzzle(info.date);
  await noOverflow(page);
  assert.doesNotMatch((await page.locator('#daily-heading, #daily-status').allTextContents()).join(' '), /ranking|score|optimal/i,
    'Daily puzzle status contains no ranking or benchmark language');
  await finish(page, puzzle);
  await completionBoard(page);
  if (name) await registerCompletion(page, name);
  await closeWin(page);
  if (name) await page.screenshot({ path: resolve(output, `${await page.evaluate(() => innerWidth)}-completion-list.png`), fullPage: true });
}

async function archivedCompletion() {
  const now = '2026-10-17T10:00:00Z', api = createBrowserApi({ now: Date.parse(now) });
  const page = await pageFor({ viewport: { width: 1000, height: 850 } }, { api, now });
  await activate(page, page.locator('#mode-daily'));
  await page.locator('#daily-heading:not([hidden])').waitFor();
  await activate(page, page.locator('#daily-toggle'));
  const date = '2026-10-15';
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/daily' &&
    new URL(response.url()).searchParams.get('date') === date && response.status() === 200);
  await page.locator('#daily-date').selectOption(date);
  const payload = await (await pending).json();
  await dailyEditorHidden(page);
  noBenchmark(payload.puzzle, 'An archived daily circuit');
  assert.equal(payload.acceptingScores, false, 'An archived daily has no numeric score window');
  await finish(page, payload.puzzle);
  await registerCompletion(page, 'Archived puzzle');
  await closeWin(page);
  await accessibility(page);
  console.log('Archived daily: players can register completion after its original date, without a score or rank.');
}

async function recovery(page) {
  await activate(page, page.locator('#mode-campaign'));
  await page.locator('#level').selectOption('1');
  const first = getHoles(LEVELS[0])[0];
  await place(page, first.id, first.choices.find(gate => gate !== solutionFor(LEVELS[0])[first.id]));
  assert.equal(await page.locator('#win-dialog').evaluate(dialog => dialog.open), false, 'A wrong placement is safe to explore');
  await activate(page, page.locator('#undo'));
  assert.equal(await page.locator('[data-hole][data-filled="true"]').count(), 0, 'Undo restores the unfilled circuit');
  await finish(page, LEVELS[0]); await closeWin(page);
  await activate(page, page.locator('#restart'));
  assert.equal(await page.locator('[data-hole][data-filled="true"]').count(), 0, 'Reset clears every hole');
  assert.equal(await page.locator('#undo').isDisabled(), true);
  await activate(page, page.locator('#show-rules'));
  await page.locator('#rules-dialog[open]').waitFor();
  await activate(page, page.locator('#close-rules'));
  await page.route('**/api/daily?**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Temporarily unavailable."}' }));
  await activate(page, page.locator('#mode-daily'));
  await page.locator('#daily-status').filter({ hasText: /^Offline puzzle\.$/ }).waitFor();
  await completionBoard(page);
  await finish(page, dailyPuzzle(fixture.getDaily('quantum-signals').date));
  await closeWin(page);
  await activate(page, page.locator('#restart'));
  await page.unroute('**/api/daily?**');
  await fixture.install(page);
  await daily(page, 'Signals desktop');
  assert.equal(await page.locator('#daily-status').innerText(), '', 'A successful daily retry clears the offline status');
}

async function tutorialGateAppearance(page) {
  const report = await page.evaluate(() => {
    const board = [...document.querySelectorAll('#signal-board .signal-hole')];
    const palette = [...document.querySelectorAll('.signal-palette [data-choice]')].filter(button => !button.hidden);
    const glyphs = [...document.querySelectorAll('#signal-board .gate-glyph, .signal-palette [data-choice]:not([hidden]) .gate-glyph, #tutorial-text .gate-glyph')];
    return {
      opaque: [...board, ...palette, ...glyphs].every(node => getComputedStyle(node).opacity === '1'),
      locked: board.every(button => button.disabled) && palette.every(button => button.disabled === !button.hasAttribute('data-tutorial-focus')),
    };
  });
  assert.equal(report.opaque, true, 'Tutorial gates retain their normal circuit, palette and inline opacity');
  assert.equal(report.locked, true, 'Only the highlighted tutorial gate is enabled; the other gates remain locked');
}

async function cancellationTutorial(page, profile) {
  await activate(page, page.locator('#mode-tutorial'));
  await tutorialGateAppearance(page);
  await activate(page, page.locator('#tutorial-start'));
  await activate(page, page.locator('[data-choice="H"]'));
  assert.equal(await page.locator('[data-hole][data-filled="true"]').count(), 1);
  await activate(page, page.locator('#tutorial-start'));
  assert.equal(await page.locator('[data-hole][data-filled="true"]').count(), 0, 'Restart clears the worked example');
  const placements = {};
  for (const [index, { hole, gate }] of TUTORIAL_STEPS.entries()) {
    assert.equal(await page.locator('#tutorial-heading').innerText(), `Step ${index + 1} of ${TUTORIAL_STEPS.length}`);
    const history = await page.locator('#sequence').innerHTML();
    if (hole) {
      await activate(page, page.locator(`[data-choice="${gate}"]`));
      placements[hole] = gate;
    } else {
      assert.match(await page.locator('#tutorial-text').innerText(), /walls.*white.*dark.*cancel/i);
      assert.equal(await page.locator('#signal-flow').getAttribute('data-match'), 'false', 'The wall explanation precedes matching the target');
      assert.equal(await page.locator('[data-hole="e"]').getAttribute('data-filled'), 'false');
      assert.equal(await page.locator('#signal-board').evaluate(board =>
        parseFloat(board.querySelector('[data-hole="e"]').style.left) > parseFloat(board.querySelector('[data-hole="f"]').style.left)), true,
      'The remaining gate is physically after the recombination');
      const focused = page.locator('.signal-flow-cancellation[data-tutorial-focus]');
      assert.equal(await focused.count(), 1, 'The observation highlights a real cancellation wall');
      assert.deepEqual(await page.locator('.signal-flow-cancellation').evaluateAll(nodes => nodes.map(node => Number(node.dataset.basis))), [1, 3, 4, 6]);
      await page.waitForFunction(() => {
        const wall = document.querySelector('.signal-flow-cancellation[data-tutorial-focus]').getBoundingClientRect();
        const region = document.getElementById('flow-scroll').getBoundingClientRect();
        return wall.left >= region.left && wall.right <= region.right && wall.top >= region.top && wall.bottom <= region.bottom;
      });
      await page.screenshot({ path: resolve(output, `${profile}-tutorial-cancellation.png`), fullPage: true });
      await activate(page, page.locator('#tutorial-next'));
      assert.equal(await page.locator('#sequence').innerHTML(), history, 'Observing the wall places no extra gate');
    }
    const heading = index === TUTORIAL_STEPS.length - 1 ? 'Tutorial complete' : `Step ${index + 2} of ${TUTORIAL_STEPS.length}`;
    await page.waitForFunction(text => document.getElementById('tutorial-heading').textContent === text,
      heading);
    assert.equal(await page.locator('#win-dialog').evaluate(dialog => dialog.open), false, 'The tutorial never interrupts its explanation with a win popup');
    await tutorialGateAppearance(page);
    await basisFlow(page, TUTORIAL_PUZZLE, placements);
    if (placements.f) assert.equal(await page.locator('#signal-flow').evaluate(svg => [1, 3, 4, 6].every(basis =>
      !svg.querySelector(`.signal-flow-path[data-column="7"][data-from="${basis}"]`) &&
      !svg.querySelector(`.signal-flow-node[data-boundary="8"][data-basis="${basis}"]`))), true,
    'Stopped paths remain absent through the later gate and at the output');
  }
  assert.equal(await page.locator('#tutorial-heading').innerText(), 'Tutorial complete');
  assert.equal(await page.locator('[data-hole][data-filled="true"]').count(), 6,
    'The seven-step guide still demonstrates all six explicit gate placements');
  assert.equal(await page.locator('#sequence button').count(), 6, 'Observing interference adds no placement');
  assert.equal(await page.locator('.signal-flow-cancellation').count(), 4, 'The completed tutorial retains its cancellation walls');
  await page.locator('#flow-scroll').screenshot({ path: resolve(output, `${profile}-tutorial-downstream.png`) });
  await activate(page, page.locator('#tutorial-levels'));
  assert.equal(await page.locator('#mode-campaign').getAttribute('aria-pressed'), 'true');
}

async function focusedCancellations() {
  for (const [profile, options] of [['desktop', { viewport: { width: 1440, height: 1100 } }],
    ['mobile', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }]]) {
    const page = await pageFor(options);
    await cancellationTutorial(page, profile);
    await page.locator('#level').selectOption('4');
    await basisFlow(page, LEVELS[3]);
    assert.equal(await page.locator('.signal-flow-cancellation').count(), 0, 'An unfilled identity hole produces no false wall');
    await finish(page, LEVELS[3]); await closeWin(page);
    assert.equal(await page.locator('.signal-flow-cancellation').count(), 1);
    assert.equal(await page.locator('.signal-flow-cancellation').getAttribute('data-basis'), '1');
    await page.locator('#flow-scroll').screenshot({ path: resolve(output, `${profile}-hh-cancellation.png`) });
    await openDetails(page, '#advanced-features');
    await activate(page, page.locator('#share-replay'));
    await page.locator('#share-preview').waitFor({ state: 'visible' });
    const column = LEVELS[3].columns.findIndex(entries => entries.some(entry => entry.id === 'a'));
    const step = Math.min(88, 740 / LEVELS[3].columns.length), left = (960 - step * LEVELS[3].columns.length) / 2;
    const pixel = await page.locator('#share-preview').evaluate(async (image, x) => {
      await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      return [...context.getImageData(x, 274, 1, 1).data];
    }, left + (column + 1) * step);
    assert.deepEqual(pixel, [255, 255, 255, 255], 'The actual static PNG contains the cancellation wall at the canceled output');
    const pending = page.waitForEvent('download');
    await activate(page, page.locator('#download-gif'));
    assert.equal((await readFile(await (await pending).path())).subarray(0, 6).toString('ascii'), 'GIF89a');
    await activate(page, page.locator('#close-share'));
    await page.locator('#level').selectOption('3');
    await finish(page, LEVELS[2]); await closeWin(page);
    assert.equal(await page.locator('.signal-flow-cancellation').count(), 0, 'Nonzero positive and negative outputs do not create cancellation walls');
    await noOverflow(page);
    await page.context().close();
  }
  assert.deepEqual(errors, []);
  console.log('Desktop/mobile: seven-step tutorial, restart/Levels, visible cancellation focus, HH walls, mixed-phase controls and PNG/GIF exports verified.');
}

async function focusedBaits() {
  for (const [profile, options] of [['desktop', { viewport: { width: 1440, height: 1100 } }],
    ['mobile', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }]]) {
    const page = await pageFor(options), submissions = [];
    try {
      await cancellationTutorial(page, profile);
      page.on('request', request => {
        if (new URL(request.url()).pathname === '/api/leaderboard' && request.method() === 'POST') {
          submissions.push(request.postDataJSON());
        }
      });
      for (const [level, count] of [[4, 1], [7, 1], [11, 3]]) {
        await page.locator('#level').selectOption(String(level));
        assert.equal(await page.locator('#signal-board [data-hole]').count(), count,
          `Official level ${level} retains its original holes`);
        if (level !== 11) { await finish(page, LEVELS[level - 1]); await closeWin(page); }
      }
      await completionBoard(page);
      await activate(page, page.locator('#mode-random'));
      await openDetails(page, '#advanced-features');
      const customRequests = completionRequests;
      const puzzle = await importPuzzle(page, { wires: 1,
        columns: [[{ gate: 'H', wires: [0] }], [{ wires: [0], choices: ['I', 'H', 'X', 'Z'] }],
          [{ wires: [0], choices: ['I', 'X'] }]], target: { '0': 1 } });
      const [active, bait] = getHoles(puzzle);
      await finish(page, puzzle);
      await page.locator('#win-dialog[open]').waitFor();
      assert.equal(await page.locator(`[data-hole="${bait.id}"]`).getAttribute('data-filled'), 'false',
        'The identity bait can stay untouched when the target is reached');
      assert.deepEqual(await placedGates(page, puzzle), { [active.id]: 'H' });
      await basisFlow(page, puzzle);
      assert.equal(await page.locator('#score-form').isVisible(), false, 'Custom bait puzzles have no completion registration');
      await closeWin(page);
      await downloadReplay(page);

      await activate(page, page.locator('#restart'));
      await place(page, bait.id, 'X');
      await place(page, active.id, 'H');
      assert.equal(await page.locator('#win-dialog').evaluate(dialog => dialog.open), false,
        'An unnecessary X prevents completion');
      await activate(page, page.locator(`[data-hole="${bait.id}"]`));
      await activate(page, page.locator('#erase-gate'));
      await page.locator('#win-dialog[open]').waitFor();
      assert.deepEqual(await placedGates(page, puzzle), { [active.id]: 'H' }, 'Erasing the wrong bait restores the winning circuit');
      await closeWin(page);
      await activate(page, page.locator('#undo'));
      assert.equal(await page.locator('#win-dialog').evaluate(dialog => dialog.open), false);
      assert.equal(await page.locator('#show-results').isVisible(), false, 'Undoing erasure restores the unsolved circuit');
      assert.deepEqual(await placedGates(page, puzzle), { [active.id]: 'H', [bait.id]: 'X' });
      await basisFlow(page, puzzle);

      await page.locator('#difficulty').selectOption('1');
      await activate(page, page.locator('#new-puzzle'));
      const random = await currentPuzzle(page);
      const witness = solvePuzzle(random, { limit: 4096 }).find(solution => Object.values(solution).includes('I'));
      assert.ok(witness, 'A generated one-wire puzzle permits an identity to stay empty');
      for (const [hole, gate] of Object.entries(witness)) {
        if (await page.locator('#win-dialog').evaluate(dialog => dialog.open)) break;
        if (gate !== 'I') await place(page, hole, gate);
      }
      await page.locator('#win-dialog[open]').waitFor();
      assert.ok(await page.locator('[data-hole][data-filled="false"]').count() > 0,
        'A randomly generated puzzle completes with an identity slot untouched');
      await basisFlow(page, random);
      await closeWin(page);

      const savedCompletions = submissions.length;
      await openDetails(page, '#advanced-features');
      const custom = await importPuzzle(page, { wires: 1,
        columns: [[{ wires: [0], choices: ['I', 'X'] }]], target: { '0': 1 } });
      assert.equal(simulate(custom).solved, true, 'A custom circuit may already match with no placements');
      assert.equal(await page.locator('#sequence button').count(), 0);
      assert.equal(await page.locator('#share-replay').isVisible(), false, 'A zero-action circuit has no replay to share');
      await activate(page, page.locator('#show-results'));
      await page.locator('#win-dialog[open]').waitFor();
      await openDetails(page, '#result-advanced-features');
      assert.equal(await page.locator('#share-result').isVisible(), false, 'Zero-action results also hide replay sharing');
      assert.equal(await page.locator('#replay-result').isDisabled(), true);
      assert.equal(await page.locator('#share-dialog').evaluate(dialog => dialog.open), false);
      assert.equal(await page.locator('#score-form').isVisible(), false, 'Custom results never request completion registration');
      assert.equal(submissions.length, savedCompletions, 'An already matched custom circuit never submits a completion');
      assert.equal(await page.locator('#status').innerText(), '', 'Opening zero-action results causes no replay error');
      await closeWin(page);
      assert.equal(submissions.length, 0, 'Custom/random bait puzzles never submit completion records');
      assert.equal(completionRequests, customRequests, 'Custom/random puzzles never request a completion list');
      await noOverflow(page);
    } finally {
      await page.context().close();
    }
    console.log(`${profile}: original campaign holes, custom/random identity baits, PNG/GIF exports, erase/undo, zero-action custom results and seven-step tutorial passed.`);
  }
  assert.deepEqual(errors, [], 'Optional identity gameplay has no uncaught browser errors');
}

async function focusedFlow() {
  const desktop = await pageFor({ viewport: { width: 1440, height: 1050 } });
  await noOverflow(desktop); await accessibility(desktop);
  await jointStateExamples(desktop);
  const mobile = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  for (const width of [320, 390, 768]) {
    await mobile.setViewportSize({ width, height: 900 });
    await horizontalNavigation(mobile);
    await noOverflow(mobile); await accessibility(mobile);
    await mobile.screenshot({ path: resolve(output, `mobile-pinned-${width}.png`), fullPage: true });
  }
  await mobile.setViewportSize({ width: 320, height: 900 });
  await denseMirror(mobile);
  await jointStateExamples(mobile);
  await downloadReplay(mobile);
  await completionBoard(mobile);
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  console.log('Phase dots and target divider: desktop and 320/390/768 px touch layouts, synchronized scrolling, fixed labels, sixteen lanes, accessibility and lazy replay download verified.');
}

async function focusedNavigation() {
  const desktop = await pageFor({ viewport: { width: 1440, height: 1050 } });
  await progressNavigation(desktop);
  await desktop.context().close();
  for (const width of [320, 390, 768]) {
    const mobile = await pageFor({ viewport: { width, height: 900 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await progressNavigation(mobile);
    await mobile.context().close();
  }
  assert.deepEqual(errors, [], 'No uncaught navigation errors');
  console.log('Progress navigation: desktop and 320/390/768 px touch layouts center auto-advance, undo and replay; reveal completed targets; preserve manual exploration and page position; reset the dense mirror to its first lane.');
}

async function focusedEditor() {
  const desktop = await pageFor({ viewport: { width: 1440, height: 1050 } });
  await visualEditor(desktop);
  const mobile = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await visualEditor(mobile);
  assert.deepEqual(errors, [], 'No uncaught editor errors');
}

async function focusedRegistration() {
  for (const options of [{ viewport: { width: 1440, height: 1050 } }, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]) {
    const page = await pageFor(options), name = options.hasTouch ? 'Remembered mobile' : 'Remembered desktop';
    await finish(page, LEVELS[0]);
    await registerCompletion(page, name, { retry: true });
    await retainedCompletion(page, LEVELS[0]); await closeWin(page);
    await completionActions(page);
    await daily(page, name);
    await activate(page, page.locator('#show-results'));
    await openDetails(page, '#result-advanced-features');
    await accessibility(page);
    await closeWin(page);
  }
  assert.deepEqual(errors, [], 'No uncaught registration errors');
  console.log('Remembered Signals nickname: first manual retry, retained completion, automatic next level/daily and accessible management controls verified.');
}

try {
  if (process.env.GAME_BROWSER_FOCUS === 'baits') await focusedBaits();
  else if (process.env.GAME_BROWSER_FOCUS === 'cancellations') await focusedCancellations();
  else if (process.env.GAME_BROWSER_FOCUS === 'flow') await focusedFlow();
  else if (process.env.GAME_BROWSER_FOCUS === 'navigation') await focusedNavigation();
  else if (process.env.GAME_BROWSER_FOCUS === 'editor') await focusedEditor();
  else if (process.env.GAME_BROWSER_FOCUS === 'registration') await focusedRegistration();
  else {
  const desktop = await pageFor({ viewport: { width: 1440, height: 1050 } });
  await noOverflow(desktop);
  await emptySlots(desktop);
  await basisFlow(desktop, LEVELS[0]);
  await visibleChoices(desktop, getHoles(LEVELS[0])[0]);
  await desktop.screenshot({ path: resolve(output, 'desktop.png'), fullPage: true });
  await accessibility(desktop);
  await desktop.locator('[data-hole]').first().focus();
  await desktop.keyboard.press('Enter');
  await desktop.locator('[data-choice="X"]').focus();
  await desktop.keyboard.press('Space');
  await desktop.locator('#win-dialog[open]').waitFor();
  await closeWin(desktop); await desktop.locator('#undo').click();
  assert.equal(await desktop.locator('[data-hole][data-filled="true"]').count(), 0, 'Undo clears the keyboard placement');
  await desktop.locator('#restart').click();
  await desktop.locator('#level').selectOption('11');
  await desktop.locator('[data-choice="H"]').focus();
  await desktop.keyboard.press('Enter');
  assert.equal(await desktop.locator('[data-hole="b"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await desktop.evaluate(() => document.activeElement?.dataset.hole), 'b', 'Focus follows the next hole when its palette hides the previous choice');
  await visibleChoices(desktop, getHoles(LEVELS[10])[1]);
  await desktop.locator('[data-hole="a"]').click();
  await desktop.locator('#erase-gate').focus();
  await desktop.keyboard.press('Enter');
  assert.equal(await desktop.locator('#erase-gate').isVisible(), false, 'Erase is only shown for a filled hole');
  assert.equal(await desktop.evaluate(() => document.activeElement?.dataset.hole), 'a', 'Erasing from the keyboard restores focus to the cleared hole');
  await keyboardAndMouse(desktop);
  for (const level of LEVELS) {
    await desktop.locator('#level').selectOption(String(LEVELS.indexOf(level) + 1));
    await gateGeometry(desktop, level);
    if (level === LEVELS[2] || level === LEVELS[7]) {
      const [current, target] = await finalAmplitudes(desktop, level);
      assert.ok(current.every((amplitude, index) => Math.abs(amplitude * amplitude - target[index] * target[index]) < 1e-8), 'Relative-phase lessons have identical probabilities');
      assert.ok(!stateEqual(current, target), 'The target still makes its different relative phase visible');
      await basisFlow(desktop, level);
      await desktop.screenshot({ path: resolve(output, `desktop-phase-${LEVELS.indexOf(level) + 1}.png`), fullPage: true });
    }
    await finish(desktop, level);
    if (level === LEVELS[0]) {
      await registerCompletion(desktop, 'Signals desktop', { retry: true });
      await retainedCompletion(desktop, level);
    }
    await closeWin(desktop);
    if (level === LEVELS[0]) await desktop.screenshot({ path: resolve(output, 'desktop-completion-list.png'), fullPage: true });
    if (level === LEVELS[6]) await desktop.screenshot({ path: resolve(output, 'desktop-bell.png'), fullPage: true });
    if (level === LEVELS[0]) await downloadReplay(desktop);
  }
  console.log(`Desktop: all ${LEVELS.length} levels solved; optional completion registration, checked lists, request retry and lazy replay export verified.`);
  await desktop.screenshot({ path: resolve(output, 'desktop-entanglement.png'), fullPage: true });
  await completionActions(desktop);
  await customAndRandom(desktop);
  await visualEditor(desktop);
  await recovery(desktop);
  await reverseCnot(desktop);
  await controlledGeometry(desktop, 'desktop-gate-geometry.png');
  await jointStateExamples(desktop);
  console.log('Desktop: random difficulties, malformed and valid custom puzzles, undo/reset, HTTP failure and daily retry verified.');

  const mobile = await pageFor({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await accessibility(mobile);
  await mobile.screenshot({ path: resolve(output, 'mobile.png'), fullPage: true });
  await mobile.setViewportSize({ width: 320, height: 780 });
  await noOverflow(mobile); await accessibility(mobile);
  await mobile.screenshot({ path: resolve(output, 'mobile-primary-320.png'), fullPage: true });
  await horizontalNavigation(mobile);
  await mobile.screenshot({ path: resolve(output, 'mobile-navigation-320.png'), fullPage: true });
  await mobile.locator('#level').selectOption('1');
  await mobile.setViewportSize({ width: 390, height: 844 });
  const holeBounds = await mobile.locator('[data-hole]').first().boundingBox();
  assert.ok(holeBounds.width >= 44 && holeBounds.height >= 44, 'Hole targets are touchable');
  for (const level of [LEVELS[0], LEVELS[2], LEVELS[6], LEVELS[7], LEVELS.at(-1)]) {
    await mobile.locator('#level').selectOption(String(LEVELS.indexOf(level) + 1));
    if (level === LEVELS[2] || level === LEVELS[7]) await mobile.screenshot({ path: resolve(output, `mobile-phase-${LEVELS.indexOf(level) + 1}.png`), fullPage: true });
    await finish(mobile, level); await closeWin(mobile);
    await noOverflow(mobile);
    if (level === LEVELS[6]) await mobile.screenshot({ path: resolve(output, 'mobile-bell.png'), fullPage: true });
  }
  await mobile.screenshot({ path: resolve(output, 'mobile-entanglement.png'), fullPage: true });
  await downloadReplay(mobile);
  await customAndRandom(mobile);
  await visualEditor(mobile);
  await daily(mobile, 'Signals mobile');
  await completionActions(mobile);
  for (const width of [320, 768]) {
    await mobile.setViewportSize({ width, height: 900 }); await noOverflow(mobile);
    await accessibility(mobile);
    await mobile.screenshot({ path: resolve(output, `mobile-${width}.png`), fullPage: true });
  }
  await mobile.setViewportSize({ width: 320, height: 900 });
  await denseMirror(mobile);
  await reverseCnot(mobile);
  await controlledGeometry(mobile, 'mobile-gate-geometry-320.png');
  await jointStateExamples(mobile);
  console.log('Mobile: phase/entanglement levels, random/custom/daily, GIF export and 320/390/768 px layouts verified with real touch input.');
  const privatePage = await pageFor({ viewport: { width: 1000, height: 800 } }, { blockedStorage: true });
  await finish(privatePage, LEVELS[0]);
  await registerCompletion(privatePage, 'Private session');
  await closeWin(privatePage);
  await completionActions(privatePage);
  console.log('Blocked browser storage: gameplay, completion registration, next level and replay sharing remain available.');
  await completionBoard(privatePage);
  await archivedCompletion();
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  }
  await drainBoardResponses();
} finally { await browser.close(); }
