// End-to-end editing and real local minimality-auto search; no response fixtures.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { availableGates, exportTheory, parseDraft, serializeDraft } from '../../src/lib/minimality/model.js';
import { AUDITED_ZOO_COMMIT, describeZooEntry } from '../../src/lib/minimality/zoo-catalog.js';

const base = new URL(process.env.MINIMALITY_BASE_URL ?? 'http://127.0.0.1:4325');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Run this real API check against a local website.');
const output = resolve('tmp/minimality');
await mkdir(output, { recursive: true });
const moduleDirectories = [process.env.PLAYWRIGHT_MODULE_DIR, 'tmp/quality-tools/node_modules'].filter(Boolean);
let chromium;
for (const directory of moduleDirectories) {
  try { ({ chromium } = createRequire(resolve(directory, 'package.json'))('playwright')); break; }
  catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
}
assert.ok(chromium, 'Install the optional Playwright tools or set PLAYWRIGHT_MODULE_DIR.');
let axeSource;
try {
  const qualityRequire = createRequire(resolve(process.env.QUALITY_MODULE_DIR ?? 'tmp/quality-tools/node_modules', 'package.json'));
  axeSource = await readFile(qualityRequire.resolve('axe-core/axe.min.js'), 'utf8');
} catch (error) { if (!['MODULE_NOT_FOUND', 'ENOENT'].includes(error.code)) throw error; }
let executablePath = process.env.PLAYWRIGHT_EXECUTABLE;
if (!executablePath && process.platform === 'win32') {
  for (const candidate of [
    join(process.env.PROGRAMFILES ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    join(process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
  ]) {
    try { await access(candidate); executablePath = candidate; break; } catch { /* Try the next installed browser. */ }
  }
}
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const report = { base: base.origin, checks: [], errors: [], accessibility: [] };

function watch(page, profile) {
  page.on('pageerror', error => report.errors.push({ profile, message: error.message }));
  page.on('console', message => {
    if (message.type() === 'error') report.errors.push({ profile, message: message.text() });
  });
}
const savedDraft = async page => {
  const source = await page.evaluate(() => localStorage.getItem('minimality-theory-v1'));
  return source === null ? null : parseDraft(source);
};
const rule = (page, id) => page.locator(`[data-rule-id="${id}"]`);
const side = (page, id, value = 'left') => rule(page, id).locator(`[data-side="${value}"]`);
const cell = (page, id, wire, column, value = 'left') => side(page, id, value).locator(`.circuit-slot:not([data-phase])[data-action="place-gate"][data-wire="${wire}"][data-column="${column}"]`);
const insert = (page, id, wire, boundary, value = 'left') => side(page, id, value).locator(`.insert-slot:not([data-phase])[data-boundary="${boundary}"][data-wire="${wire}"]`);
const generator = (page, id) => page.locator(`[data-generator-id="${id}"]`);
const chooseGenerator = (page, id) => generator(page, id).locator('[data-action="select-generator"]').click();
const picker = page => page.locator('#generator-picker');
const pickerChoice = (page, id) => picker(page).locator(`[data-picker-generator="${id}"]`);

async function loadExample(page) {
  const operation = (id, generator, column) => ({ id, generator, wire: 0, column });
  await openDraft(page, JSON.stringify({ version: 1, name: 'Two involutions', structure: 'PRO', controlValues: 2,
    generators: [{ id: 'g1', name: 'H', arity: 1 }, { id: 'g2', name: 'X', arity: 1 }],
    rules: [
      { id: 'r1', name: 'H²', wires: 1, left: [operation('o1', 'g1', 0), operation('o2', 'g1', 1)], right: [] },
      { id: 'r2', name: 'X²', wires: 1, left: [operation('o3', 'g2', 0), operation('o4', 'g2', 1)], right: [] },
      { id: 'r3', name: 'HX = XH', wires: 1, left: [operation('o5', 'g1', 0), operation('o6', 'g2', 1)], right: [operation('o7', 'g2', 0), operation('o8', 'g1', 1)] },
    ],
  }));
}

async function openPicker(page, target, touch = false) {
  const phase = await target.evaluate(element => element.hasAttribute('data-phase'));
  await target[touch ? 'tap' : 'click']();
  await picker(page).waitFor({ state: 'visible' });
  assert.equal(await picker(page).getAttribute('role'), 'dialog');
  const draft = await savedDraft(page);
  const choices = availableGates(draft).filter(generator => !phase || generator.arity === 0)
    .sort((a, b) => Number(b.arity === 0) - Number(a.arity === 0));
  assert.equal(await picker(page).getAttribute('aria-label'), phase || choices.length && choices.every(generator => generator.arity === 0)
    ? 'Add global phase' : draft.structure === 'PRO' ? 'Add generator' : 'Add operation');
  assert.deepEqual(await picker(page).locator('[data-picker-generator]').evaluateAll(choices => choices.map(choice => choice.dataset.pickerGenerator)),
    choices.map(generator => generator.id), 'Each + keeps global phases visible before the body gates for this position');
}

async function expandShortcuts(page) {
  const disclosure = page.locator('#shortcut-editors');
  if (await disclosure.isVisible() && !await disclosure.evaluate(element => element.open)) await disclosure.locator(':scope > summary').click();
}

async function localError(page, field, pattern) {
  assert.equal(await field.getAttribute('aria-invalid'), 'true', 'The rejected field identifies its validation error');
  const describedBy = await field.getAttribute('aria-describedby');
  assert.ok(describedBy, 'The rejected field is associated with its visible explanation');
  const error = page.locator(`#${describedBy.split(/\s+/).at(-1)}`);
  assert.equal(await error.isVisible(), true, 'The error is visible beside the rejected edit');
  if (pattern) assert.match(await error.textContent(), pattern);
  return error;
}

async function addAt(page, target, generatorId, touch = false) {
  const wire = await target.getAttribute('data-wire');
  await openPicker(page, target, touch);
  assert.equal(await pickerChoice(page, generatorId).isEnabled(), true, 'The requested generator fits this position');
  await pickerChoice(page, generatorId)[touch ? 'tap' : 'click']();
  if (availableGates(await savedDraft(page)).find(generator => generator.id === generatorId).arity > 1) {
    const span = picker(page).locator(`[data-picker-generator="${generatorId}"][data-placement-wire="${wire}"]`);
    assert.equal(await span.isEnabled(), true, 'The requested wire span fits this position');
    await span[touch ? 'tap' : 'click']();
  }
  await picker(page).waitFor({ state: 'hidden' });
}

async function pickerFits(page) {
  const bounds = await picker(page).evaluate(element => {
    const { left, top, right, bottom } = element.getBoundingClientRect();
    return { left, top, right, bottom, width: innerWidth, height: innerHeight };
  });
  assert.ok(bounds.left >= -1 && bounds.top >= -1 && bounds.right <= bounds.width + 1 && bounds.bottom <= bounds.height + 1,
    `The picker stays within the viewport: ${JSON.stringify(bounds)}`);
}

async function pickerBasics(page, ruleId, pairId) {
  const initial = await savedDraft(page);
  const target = insert(page, ruleId, 1, 0);
  await target.focus();
  await page.keyboard.press('Enter');
  await picker(page).waitFor({ state: 'visible' });
  assert.equal(await pickerChoice(page, pairId).isEnabled(), true, 'A two-wire gate can choose a fitting span when opened from the final wire');
  assert.equal(await pickerChoice(page, 'g1').evaluate(element => element === document.activeElement), true, 'Opening by keyboard focuses the first enabled generator');
  await page.keyboard.press('Tab');
  assert.equal(await pickerChoice(page, 'g2').evaluate(element => element === document.activeElement), true, 'Generator choices work with normal keyboard navigation');
  await page.keyboard.press('ArrowDown');
  assert.equal(await pickerChoice(page, pairId).evaluate(element => element === document.activeElement), true, 'Arrow navigation reaches multiwire generators');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('#close-generator-picker').evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Home');
  assert.equal(await pickerChoice(page, 'g1').evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('End');
  assert.equal(await page.locator('#close-generator-picker').evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('ArrowDown');
  assert.equal(await pickerChoice(page, 'g1').evaluate(element => element === document.activeElement), true, 'Arrow navigation wraps to the first enabled generator');
  await pickerFits(page);
  await page.screenshot({ path: join(output, 'desktop-generator-picker.png') });
  await audit(page, 'desktop generator picker');
  await page.keyboard.press('Escape');
  await picker(page).waitFor({ state: 'hidden' });
  assert.equal(await target.evaluate(element => element === document.activeElement), true, 'Escape returns focus to the invoking +');
  assert.deepEqual(await savedDraft(page), initial, 'Dismissing a picker does not edit the circuit');
  await openPicker(page, target);
  await page.getByRole('heading', { name: 'Minimality', exact: true }).click();
  await picker(page).waitFor({ state: 'hidden' });
  assert.deepEqual(await savedDraft(page), initial, 'Clicking outside dismisses without editing');
  await chooseGenerator(page, 'g1');
  await openPicker(page, target);
  await pickerChoice(page, 'g2').focus();
  await page.keyboard.press('Enter');
  await picker(page).waitFor({ state: 'hidden' });
  const operations = (await savedDraft(page)).rules.at(-1).left;
  assert.deepEqual(operations.map(({ generator, wire, column }) => ({ generator, wire, column })), [{ generator: 'g2', wire: 1, column: 0 }],
    'The picker adds the explicitly chosen generator at the invoking wire, regardless of palette selection');
  await page.locator('#undo-theory').click();
  assert.deepEqual(await savedDraft(page), initial, 'Picker placement participates in normal undo');
  report.checks.push('generator picker choice, multiwire availability, keyboard navigation, Escape and outside dismissal');
}

async function longPicker(page) {
  for (const [name, lastArity] of [['last-valid', 1], ['all-invalid', 2]]) {
    const draft = { version: 1, name: `Picker ${name}`, structure: 'PRO', controlValues: 2,
      generators: Array.from({ length: 12 }, (_, index) => ({ id: `g${index}`, name: `G${index}`, arity: index === 11 ? lastArity : 2 })),
      rules: [{ id: 'r1', name: 'One wire', wires: 1, left: [], right: [] }],
    };
    await openDraft(page, serializeDraft(draft));
    const target = insert(page, 'r1', 0, 0);
    await openPicker(page, target, true);
    const focused = lastArity === 1 ? pickerChoice(page, 'g11') : page.locator('#close-generator-picker');
    assert.equal(await focused.evaluate(element => element === document.activeElement), true, `The ${name} picker focuses its usable action`);
    const geometry = await picker(page).evaluate(menu => {
      const active = document.activeElement.getBoundingClientRect(), bounds = menu.getBoundingClientRect();
      return { top: active.top, bottom: active.bottom, menuTop: bounds.top, menuBottom: bounds.bottom, scrollTop: menu.scrollTop };
    });
    assert.ok(geometry.top >= geometry.menuTop && geometry.bottom <= geometry.menuBottom && geometry.scrollTop > 0,
      `Initial focus scrolls into view within a long picker: ${JSON.stringify(geometry)}`);
    await pickerFits(page);
    await page.screenshot({ path: join(output, `picker-${name}-320.png`) });
    await audit(page, `small mobile twelve-choice picker: ${name}`);
    if (lastArity === 1) {
      assert.equal(await picker(page).locator('[data-picker-generator]:enabled').count(), 1);
      await page.keyboard.press('Enter');
      await picker(page).waitFor({ state: 'hidden' });
      assert.equal((await savedDraft(page)).rules[0].left[0].generator, 'g11', 'Enter adds the focused last valid generator');
    } else {
      assert.equal(await picker(page).locator('[data-picker-generator]:enabled').count(), 0);
      assert.equal(await page.locator('#generator-picker-empty').isVisible(), true);
      await focused.tap();
      await picker(page).waitFor({ state: 'hidden' });
      assert.deepEqual(await savedDraft(page), draft, 'Cancel closes an all-invalid picker without changing the draft');
      assert.equal(await target.evaluate(element => element === document.activeElement), true, 'Cancel returns focus to the invoking +');
    }
  }
  report.checks.push('twelve generator choices: last valid and all invalid stay usable and focus scrolls into view');
}

async function crossSideParallelMove(page) {
  const draft = { version: 1, name: 'Cross-side parallel move', structure: 'PRO', controlValues: 2,
    generators: [{ id: 'wide', name: 'Pair', arity: 2 }, { id: 'single', name: 'H', arity: 1 }],
    rules: [{ id: 'r1', name: 'Three wires', wires: 3,
      left: [{ id: 'moving', generator: 'wide', wire: 0, column: 0 }],
      right: [{ id: 'stationary', generator: 'single', wire: 2, column: 0 }],
    }],
  };
  await openDraft(page, serializeDraft(draft));
  await side(page, 'r1').locator('.gate-chip').dragTo(cell(page, 'r1', 0, 0, 'right'));
  const moved = await savedDraft(page);
  assert.deepEqual(moved.rules[0].left, [], 'A cross-side parallel drop removes the source gate');
  assert.deepEqual(moved.rules[0].right.find(operation => operation.id === 'moving'), draft.rules[0].left[0],
    'Dropping into a free cell on the other side preserves the moved gate ID, wire and column');
  assert.deepEqual(moved.rules[0].right.find(operation => operation.id === 'stationary'), draft.rules[0].right[0],
    'A parallel drop leaves the other wire untouched');
  await page.locator('#undo-theory').click();
  assert.deepEqual(await savedDraft(page), draft, 'Undo restores the complete atomic cross-side move');
  await page.locator('#redo-theory').click();
  assert.deepEqual(await savedDraft(page), moved, 'Redo preserves the same gate ID across sides');
  report.checks.push('cross-side free-cell drag preserves gate IDs, parallel gates, and atomic undo/redo');
}

async function buttonInteractions(page, touch = false) {
  const source = serializeDraft({ version: 1, name: 'Button interactions', structure: 'PROP', controlValues: 2,
    generators: [{ id: 'g1', name: 'omega', arity: 1 }, { id: 'g2', name: 'Had', arity: 1 }],
    rules: Array.from({ length: 8 }, (_, index) => ({ id: `r${index}`, name: `E${index}`, wires: 2, left: [], right: [] })),
  });
  const activate = target => target[touch ? 'tap' : 'click']();
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  for (const field of ['[data-field="generator-name"]', '[data-field="rule-name"]', '#theory-name']) {
    await openDraft(page, source);
    await page.locator(field).first().fill('Gamma');
    await addAt(page, insert(page, 'r0', 0, 0, 'right'), 'g2', touch);
    assert.equal((await savedDraft(page)).rules[0].right[0].generator, 'g2', 'A pending name edit does not consume the next insertion gesture');
  }
  for (const [field, expected] of [['generator', 'generator-arity'], ['rule', 'rule-wires']]) {
    await openDraft(page, source);
    await page.locator(`[data-field="${field}-name"]`).first().fill('theta');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.field), expected, 'Tab commits the name and retains the next field');
  }
  await openDraft(page, source);
  await generator(page, 'g1').locator('input').fill('Gamma');
  const nextName = generator(page, 'g2').locator('input'), nextBounds = await nextName.boundingBox();
  await page.mouse.click(nextBounds.x + 5, nextBounds.y + nextBounds.height / 2);
  assert.equal(await nextName.evaluate(input => input === document.activeElement), true, 'A pending edit preserves the next clicked name field');
  const caret = await nextName.evaluate(input => input.selectionStart);
  await page.keyboard.type('Z');
  assert.equal(await nextName.inputValue(), 'Had'.slice(0, caret) + 'Z' + 'Had'.slice(caret), 'The next field retains its clicked caret position');
  await generator(page, 'g1').locator('select').click();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.equal((await savedDraft(page)).generators[0].arity, 2, 'Committing another field preserves the native wire selector');
  await generator(page, 'g1').locator('input').fill('Delta');
  await generator(page, 'g1').locator('select').click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'remove-generator', 'Tab leaves a held native selector normally');
  for (const [field, remove, key, count] of [
    ['[data-generator-id="g2"] [data-field="generator-name"]', '[data-generator-id="g2"] [data-action="remove-generator"]', 'generators', 1],
    ['[data-rule-id="r0"] [data-field="rule-name"]', '[data-rule-id="r0"] [data-action="remove-rule"]', 'rules', 7],
  ]) {
    await openDraft(page, source);
    await page.locator(field).fill('Edit');
    await activate(page.locator(remove));
    assert.equal((await savedDraft(page))[key].length, count, 'A pending name edit does not consume the next deletion gesture');
  }
  await openDraft(page, source);
  await generator(page, 'g1').locator('input').fill('Gamma');
  const handle = generator(page, 'g1').locator('.generator-drag');
  if (touch) {
    await handle.tap();
    assert.equal(await handle.getAttribute('aria-pressed'), 'true', 'Tapping a handle selects its generator');
    await addAt(page, insert(page, 'r0', 0, 0), 'g1', true);
  } else await handle.dragTo(insert(page, 'r0', 0, 0));
  assert.equal((await savedDraft(page)).generators[0].name, 'Gamma');
  assert.equal((await savedDraft(page)).rules[0].left[0].generator, 'g1',
    `${touch ? 'Tapping' : 'Dragging'} a handle commits a pending name and places its generator`);

  await openDraft(page, source);
  const field = generator(page, 'g2').locator('input');
  await field.click();
  await page.keyboard.press('Home');
  const bounds = await field.boundingBox();
  await page.mouse.move(bounds.x + 5, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + Math.min(50, bounds.width - 5), bounds.y + bounds.height / 2, { steps: 8 });
  await page.mouse.up();
  assert.equal(await field.evaluate(input => input.selectionEnd > input.selectionStart), true, 'Names retain normal pointer text selection');
  assert.equal(await generator(page, 'g2').evaluate(row => row.draggable), false, 'Only the dedicated generator handle starts a gate drag');

  const remove = rule(page, 'r0').locator('[data-action="remove-rule"]');
  await rule(page, 'r0').locator('input').fill('Edited');
  await remove.scrollIntoViewIfNeeded();
  const target = await remove.boundingBox();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
  await page.mouse.down();
  await page.mouse.move(1, 1, { steps: 5 });
  await page.mouse.up();
  await settle();
  assert.equal((await savedDraft(page)).rules.length, 8, 'Releasing outside a pressed button cancels its action');
  for (const id of ['r7', 'r0', 'r7']) {
    await openPicker(page, insert(page, id, 0, 0, 'right'), touch);
    await settle();
    assert.equal(await picker(page).isVisible(), true, 'Queued page scrolling does not dismiss a newly opened picker');
    await pickerFits(page);
    await page.keyboard.press('Escape');
  }
  report.checks.push(`${touch ? 'touch' : 'mouse'}: pending edits preserve one-gesture insertion/deletion, field focus and caret, native selectors, Tab, text selection, handle ${touch ? 'tap' : 'drag'}, cancellation and scrolled menus`);
}

async function labelsFit(page, chips, label) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const widths = await chips.evaluateAll(elements => {
    const canvas = document.createElement('canvas').getContext('2d');
    return elements.map(element => {
      const style = getComputedStyle(element), bounds = element.getBoundingClientRect();
      canvas.font = style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const text = element instanceof HTMLInputElement ? element.value : element.textContent;
      return { text, font: canvas.font,
        content: bounds.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
          - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth),
        textWidth: canvas.measureText(text).width,
        clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
    });
  });
  assert.ok(widths.length > 0, `${label}: gate labels are present`);
  for (const width of widths) {
    assert.ok(width.textWidth <= width.content + 0.2 && width.scrollWidth <= width.clientWidth + 1,
      `${label}: the full label fits its gate box: ${JSON.stringify(width)}`);
  }
  (report.labelWidths ??= []).push({ label, widths });
}

async function gateLabels(page, touch = false) {
  const profile = touch ? 'mobile' : 'desktop';
  const names = ['CNOT', 'ΩΩΩΩ', 'CX_inv', 'omega', 'MMMM', 'φT_dagger', 'S_prime', 'M_g', 'minus_one', 'ΜΜΜΜ', 'WWWW'];
  const draft = { version: 1, name: `Gate labels ${profile}`, structure: 'PRO', controlValues: 2,
    generators: names.map((name, index) => ({ id: `g${index}`, name, arity: [3, 8].includes(index) ? 0 : 1 })),
    shortcuts: [{ id: 's1', name: 'X', wires: 1, left: [{ id: 'definition', generator: 'g0', wire: 0, column: 0 }], right: [] }],
    rules: [{ id: 'r1', name: 'Readable labels', wires: 1, left: names.map((_, index) =>
      ({ id: `o${index}`, generator: `g${index}`, wire: 0, column: index })), right: [] }],
  };
  await openDraft(page, serializeDraft(draft));
  for (const selector of ['[data-generator-id="g0"] [data-field="generator-name"]', '[data-shortcut-id="s1"] [data-field="shortcut-name"]']) {
    const field = page.locator(selector), original = await field.inputValue();
    for (const name of ['ABCDE', 'X^2', 'p(x)']) {
      const before = await savedDraft(page);
      await field.fill(name);
      await field.press('Tab');
      await page.waitForFunction(({ selector, original }) => document.querySelector(selector)?.value === original, { selector, original });
      assert.deepEqual(await savedDraft(page), before, 'An invalid label cannot partially edit generators, shortcuts or their circuit instances');
      await localError(page, field, /must render as 1–4 Latin or Greek letters.*Use a short label/);
    }
  }
  const phase = generator(page, 'g3').locator('[data-field="generator-name"]');
  await phase.fill('omega_dagger');
  await phase.press('Tab');
  await labelsFit(page, side(page, 'r1').locator('.gate-chip'), `${profile} default root size`);
  assert.equal((await savedDraft(page)).generators[3].name, 'omega_dagger', 'Valid Greek and suffix aliases retain their raw generator names');
  assert.equal(await chip(page, 'o3').textContent(), 'ω†');
  assert.equal(await generator(page, 'g3').locator('.name-preview').textContent(), 'ω†');
  const labels = await side(page, 'r1').locator('.gate-chip').allTextContents();
  for (const text of ['CNOT', 'ΩΩΩΩ', 'CX⁻¹', 'ω†', 'MMMM', 'φT†', 'S′', 'M_g', '−1']) assert.ok(labels.includes(text), `${text} renders in full`);
  const style = await page.evaluate(() => document.documentElement.getAttribute('style'));
  try {
    for (const size of [12, 20]) {
      await page.evaluate(size => document.documentElement.style.fontSize = `${size}px`, size);
      await labelsFit(page, side(page, 'r1').locator('.gate-chip'), `${profile} ${size}px root size`);
    }
  } finally {
    await page.evaluate(style => style === null ? document.documentElement.removeAttribute('style')
      : document.documentElement.setAttribute('style', style), style);
  }
  if (!touch) {
    const viewport = page.viewportSize();
    try {
      for (const width of [800, 481]) {
        await page.setViewportSize({ width, height: viewport.height });
        await labelsFit(page, page.locator('#generator-list .generator-row > input, #generator-list .name-preview'), `palette labels at ${width}px`);
        await fits(page, `palette labels at ${width}px`);
        await page.screenshot({ path: join(output, `desktop-gate-labels-${width}.png`), fullPage: true, timeout: 10_000 });
      }
    } finally {
      await page.setViewportSize(viewport);
    }
  }
  assert.deepEqual(Object.keys(exportTheory(await savedDraft(page)).generators), names.map(name => name === 'omega' ? 'omega_dagger' : name), 'Pretty labels do not rewrite primitive payload names');
  await fits(page, `${profile} gate labels`);
  await page.screenshot({ path: join(output, `${profile}-gate-labels.png`), fullPage: true, timeout: 10_000 });
  await audit(page, `${profile} gate labels`);
  report.checks.push(`${profile}: atomic short-label validation with readable errors; Greek/dagger/prime/inverse rendering and full four-glyph gate labels at default,12px and20px root sizes`);
}

async function multiwirePicker(page, touch = false) {
  const draft = { version: 1, name: 'Wire selection', structure: 'PRO', controlValues: 2,
    generators: [{ id: 'pair', name: 'Pair', arity: 2 }],
    rules: [{ id: 'r1', name: 'Three wires', wires: 3, left: [], right: [] }],
  };
  const activate = target => target[touch ? 'tap' : 'click']();
  const span = wire => picker(page).locator(`[data-placement-wire="${wire}"]`);
  const highlighted = () => side(page, 'r1').locator('[data-placement]').evaluateAll(slots => slots.map(slot => Number(slot.dataset.placement)).sort());
  const begin = async () => {
    await openPicker(page, insert(page, 'r1', 2, 0), touch);
    assert.equal(await pickerChoice(page, 'pair').isEnabled(), true, 'A multiwire generator remains available from any wire with a fitting span');
    await activate(pickerChoice(page, 'pair'));
    assert.equal(await picker(page).getAttribute('aria-label'), 'Place Pair');
    assert.deepEqual(await picker(page).locator('[data-placement-wire]').allTextContents(), ['Wires 1–2', 'Wires 2–3']);
  };
  await openDraft(page, serializeDraft(draft));
  await begin();
  assert.deepEqual(await highlighted(), [2, 3], 'The preferred span highlights every selected wire');
  await page.screenshot({ path: join(output, `${touch ? 'mobile' : 'desktop'}-multiwire-preview.png`), fullPage: true });
  if (touch) {
    await span(0).focus();
    assert.deepEqual(await highlighted(), [1, 2], 'Native focus keeps the wire picker open');
    await page.keyboard.press('ArrowDown');
    assert.deepEqual(await highlighted(), [2, 3], 'Arrow navigation updates the selected wires');
    await page.keyboard.press('ArrowUp');
  } else await span(0).hover();
  assert.deepEqual(await highlighted(), [1, 2], 'Hover and focus preview the full wire span');
  await activate(picker(page).locator('[data-action="back-generators"]'));
  assert.equal(await picker(page).getAttribute('aria-label'), 'Add generator');
  assert.deepEqual(await highlighted(), [], 'Back clears the wire preview');
  await activate(pickerChoice(page, 'pair'));
  await activate(page.locator('#close-generator-picker'));
  assert.deepEqual(await savedDraft(page), draft, 'Canceling wire selection leaves the equation unchanged');
  assert.deepEqual(await highlighted(), []);

  await begin();
  await activate(span(1));
  await picker(page).waitFor({ state: 'hidden' });
  let placed = await savedDraft(page);
  assert.equal(placed.rules[0].left[0].wire, 1, 'The chosen span determines the gate start wire');
  const id = placed.rules[0].left[0].id;
  await activate(side(page, 'r1').locator('.gate-chip'));
  const remove = side(page, 'r1').locator('[data-action="delete-selection"]');
  const bounds = await remove.boundingBox();
  assert.ok(bounds.width >= 40 && bounds.height >= 40, 'Delete is a stable touch-sized action');
  const leftWire = await side(page, 'r1').locator('.wire-line').first().boundingBox();
  const rightWire = await side(page, 'r1', 'right').locator('.wire-line').first().boundingBox();
  assert.ok(Math.abs(leftWire.y - rightWire.y) <= 1, 'Showing Delete keeps both circuit wire grids aligned');
  await activate(remove);
  assert.equal((await savedDraft(page)).rules[0].left.length, 0);
  await activate(page.locator('#undo-theory'));
  assert.deepEqual((await savedDraft(page)).rules[0].left, placed.rules[0].left, 'Deleting the selected gate is undoable with its ID and span intact');
  await addAt(page, insert(page, 'r1', 0, 1), 'pair', touch);
  placed = await savedDraft(page);
  await chip(page, id).click();
  await page.keyboard.down('Shift');
  await side(page, 'r1').locator('.gate-chip').last().click();
  await page.keyboard.up('Shift');
  assert.equal(await remove.textContent(), 'Delete 2');
  await activate(remove);
  assert.equal((await savedDraft(page)).rules[0].left.length, 0);
  await activate(page.locator('#undo-theory'));
  assert.deepEqual((await savedDraft(page)).rules[0].left, placed.rules[0].left, 'One undo restores a deleted selection');
  await activate(chip(page, id));
  await fits(page, `${touch ? 'touch' : 'mouse'} multiwire controls`);
  await page.screenshot({ path: join(output, `${touch ? 'mobile' : 'desktop'}-multiwire-delete.png`), fullPage: true });
  await audit(page, `${touch ? 'touch' : 'mouse'} multiwire controls`);
  report.checks.push(`${touch ? 'touch' : 'mouse'}: explicit wire-span preview, Back/Cancel, chosen placement and reachable atomic selection deletion`);
  await openDraft(page, serializeDraft({ ...draft, name: 'Compact controlled actions', structure: 'Controlled PROP', generators: [],
    rules: [{ id: 'r1', name: 'Two swaps', wires: 2,
      left: [{ id: 'left-gate', generator: '$swap', wire: 0, column: 0 }],
      right: [{ id: 'right-gate', generator: '$swap', wire: 0, column: 0 }],
    }],
  }));
  for (const value of ['left', 'right']) {
    await activate(chip(page, `${value}-gate`));
    const viewport = side(page, 'r1', value), actions = viewport.locator('.circuit-actions');
    await actions.scrollIntoViewIfNeeded();
    const bounds = await viewport.boundingBox();
    const buttons = await actions.locator('button:not([hidden])').evaluateAll(buttons => buttons.map(button => {
      const bounds = button.getBoundingClientRect(), hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return { width: bounds.width, height: bounds.height, right: bounds.right, reachable: button === hit || button.contains(hit) };
    }));
    assert.equal(buttons.length, 2);
    assert.equal(buttons.every(button => button.width >= 40 && button.height >= 40 && button.right <= bounds.x + bounds.width + 1 && button.reachable), true,
      'Control and Delete fit within compact sides and remain reachable');
    const left = await side(page, 'r1').locator('.wire-line').first().boundingBox();
    const right = await side(page, 'r1', 'right').locator('.wire-line').first().boundingBox();
    assert.ok(Math.abs(left.y - right.y) <= 1, 'Wrapped controls preserve circuit wire alignment');
  }
  await page.screenshot({ path: join(output, `${touch ? 'mobile' : 'desktop'}-controlled-actions.png`), fullPage: true });
  await audit(page, `${touch ? 'touch' : 'mouse'} compact controlled actions`);
  report.checks.push(`${touch ? 'touch' : 'mouse'}: compact Control and Delete actions stay reachable with aligned wires`);
}

async function longPhasePicker(page, touch = false) {
  const draft = { version: 1, name: 'Long phase menu', structure: 'PRO', controlValues: 2,
    generators: [...Array.from({ length: 11 }, (_, index) => ({ id: `g${index}`, name: `G${index}`, arity: 1 })), { id: 'omega', name: 'omega', arity: 0 }],
    shortcuts: Array.from({ length: 12 }, (_, index) => ({ id: `s${index}`, name: `S${index}`, wires: 1, left: [], right: [] })),
    rules: [{ id: 'r1', name: 'One wire', wires: 1, left: [], right: [] }],
  };
  await openDraft(page, serializeDraft(draft));
  await openPicker(page, insert(page, 'r1', 0, 0), touch);
  const geometry = await picker(page).evaluate(menu => {
    const bounds = menu.getBoundingClientRect();
    const phase = menu.querySelector('[data-picker-generator="omega"]').getBoundingClientRect();
    const heading = [...menu.querySelectorAll('.picker-heading')].find(element => element.textContent === 'Global phases').getBoundingClientRect();
    return { scrollTop: menu.scrollTop, overflowing: menu.scrollHeight > menu.clientHeight,
      menuTop: bounds.top, menuBottom: bounds.bottom, headingTop: heading.top, headingBottom: heading.bottom,
      phaseTop: phase.top, phaseBottom: phase.bottom };
  });
  assert.equal(geometry.overflowing, true, 'The mixed fixture requires menu scrolling');
  assert.equal(geometry.scrollTop, 0, 'Opening a long mixed menu starts at the global phases');
  assert.ok(geometry.headingTop >= geometry.menuTop && geometry.headingBottom <= geometry.menuBottom
    && geometry.phaseTop >= geometry.menuTop && geometry.phaseBottom <= geometry.menuBottom,
    `The phase heading and choice appear without scrolling: ${JSON.stringify(geometry)}`);
  assert.equal(await pickerChoice(page, 'omega').evaluate(element => element === document.activeElement), true);
  await pickerFits(page);
  await bounded(page.screenshot({ path: join(output, `${touch ? 'mobile' : 'desktop'}-long-phase-picker.png`), timeout: 10_000 }), 12_000, 'Long phase picker screenshot');
  await page.keyboard.press('Escape');
  assert.deepEqual(await savedDraft(page), draft, 'Canceling a long phase menu leaves all definitions intact');
  report.checks.push(`${touch ? 'touch' : 'mouse'}: global phases immediately visible in a twenty-four-choice menu`);
}

async function globalPhases(page, touch = false) {
  await longPhasePicker(page, touch);
  const draft = { version: 1, name: 'Global phases', structure: 'PRO', controlValues: 2,
    generators: [{ id: 'omega', name: 'omega', arity: 0 }, { id: 'h', name: 'H', arity: 1 }, { id: 'pair', name: 'Pair', arity: 2 }],
    rules: [
      { id: 'r1', name: 'Three wires', wires: 3, left: [{ id: 'body', generator: 'h', wire: 2, column: 0 }], right: [] },
      { id: 'r0', name: 'Zero wires', wires: 0, left: [], right: [] },
      { id: 'full', name: 'Sixteen columns', wires: 1, left: Array.from({ length: 16 }, (_, column) => ({ id: `full${column}`, generator: 'h', wire: 0, column })), right: [] },
    ],
  };
  const activate = target => target[touch ? 'tap' : 'click']();
  const phaseInsert = boundary => side(page, 'r1').locator(`.insert-slot[data-phase][data-boundary="${boundary}"]`);
  const operations = async (value = 'left') => (await savedDraft(page)).rules[0][value];
  await openDraft(page, serializeDraft(draft));
  assert.equal(await page.locator('[data-phase-add]').count(), 0, 'Diagrams have no repeated + Phase buttons');
  assert.equal(await side(page, 'r1').locator('[data-phase]').count(), 0, 'Unused global phases add no diagram row');
  const initialTarget = insert(page, 'r1', 2, 0);
  await openPicker(page, initialTarget, touch);
  assert.deepEqual(await picker(page).locator('.picker-arity').allTextContents(), ['Global phase', '1 wire', '2 wires']);
  assert.equal(await picker(page).getByText('Global phases', { exact: true }).count(), 1, 'A single menu heading makes phases discoverable');
  assert.equal(await picker(page).getByText('Gates', { exact: true }).count(), 1);
  assert.equal(await pickerChoice(page, 'omega').evaluate(element => element === document.activeElement), true, 'The mixed picker starts with immediately visible phases');
  await page.keyboard.press('ArrowDown');
  assert.equal(await pickerChoice(page, 'h').evaluate(element => element === document.activeElement), true, 'Keyboard navigation skips the gate heading');
  await page.keyboard.press('ArrowDown');
  assert.equal(await pickerChoice(page, 'pair').evaluate(element => element === document.activeElement), true);
  await pickerFits(page);
  await bounded(page.screenshot({ path: join(output, `${touch ? 'mobile' : 'desktop'}-phase-picker.png`), timeout: 10_000 }), 12_000, 'Phase picker screenshot');
  await audit(page, `${touch ? 'touch' : 'mouse'} phase picker`);
  await page.keyboard.press('Escape');
  assert.equal(await initialTarget.evaluate(element => element === document.activeElement), true, 'Canceling restores the insertion target');
  assert.deepEqual(await savedDraft(page), draft, 'Canceling the phase picker does not edit the equation');
  await addAt(page, initialTarget, 'omega', touch);
  const first = (await operations()).find(operation => operation.generator === 'omega');
  assert.equal(first.wire, 0);
  assert.equal(first.column, 0, 'A new phase shares the adjacent body column before growing the circuit');
  assert.equal((await operations()).find(operation => operation.id === 'body').column, 0);
  const beforeFull = await savedDraft(page);
  await addAt(page, insert(page, 'full', 0, 8), 'omega', touch);
  const full = (await savedDraft(page)).rules[2].left;
  assert.deepEqual(full.filter(operation => operation.generator === 'h'), draft.rules[2].left, 'Adding a phase at the column limit leaves all body columns unchanged');
  assert.equal(full.find(operation => operation.generator === 'omega').column, 8, 'A full-width circuit accepts its first phase in the neighboring column');
  await activate(page.locator('#undo-theory'));
  assert.deepEqual(await savedDraft(page), beforeFull, 'First-phase insertion remains one undoable action');
  report.checks.push(`${touch ? 'touch' : 'mouse'}: quiet mixed insertion menu, keyboard focus/cancellation, no unused phase lane and no growth at sixteen columns`);
  await addAt(page, insert(page, 'r1', 2, 0, 'right'), 'omega', touch);
  assert.equal((await operations('right'))[0].wire, 0, 'A phase chosen from the last body wire still has no wire input');
  for (const boundary of [1, 2]) await addAt(page, phaseInsert(boundary), 'omega', touch);
  await addAt(page, insert(page, 'r1', 1, 3), 'h', touch);
  await addAt(page, side(page, 'r1').locator('.wire-cell[data-phase][data-column="3"]'), 'omega', touch);
  const parallel = (await operations()).filter(operation => operation.column === 3);
  assert.deepEqual(parallel.map(operation => operation.generator).sort(), ['h', 'omega'], 'The phase row can fill a free scalar cell beside a body gate');
  const beforeInvalidDrop = await savedDraft(page);
  if (touch) {
    await openPicker(page, phaseInsert(4), true);
    assert.equal(await pickerChoice(page, 'h').count(), 0, 'The phase row offers no wired gates');
    await page.keyboard.press('Escape');
    assert.deepEqual(await savedDraft(page), beforeInvalidDrop, 'Canceling a phase-only menu leaves the theory unchanged');
    await addAt(page, insert(page, 'r1', 2, 1, 'right'), 'omega', true);
  } else {
    await generator(page, 'h').locator('.generator-drag').dragTo(phaseInsert(4));
    assert.deepEqual(await savedDraft(page), beforeInvalidDrop, 'The phase row rejects body-gate drops');
    await generator(page, 'omega').locator('.generator-drag').dragTo(insert(page, 'r1', 2, 1, 'right'));
    await chip(page, first.id).dragTo(insert(page, 'r1', 1, 0, 'right'));
    assert.equal((await operations('right')).some(operation => operation.id === first.id), true, 'Dragging a placed phase across sides preserves its identity');
  }
  assert.equal((await operations('right')).every(operation => operation.wire === 0), true, 'Scalar placements normalize to the phase row');
  const beforePreview = await savedDraft(page);
  await openPicker(page, insert(page, 'r1', 0, 0), touch);
  await activate(pickerChoice(page, 'pair'));
  const preview = await side(page, 'r1').locator('[data-placement]').evaluateAll(slots => slots.map(slot => ({ wire: slot.dataset.wire, phase: slot.hasAttribute('data-phase') })));
  assert.deepEqual(preview, [{ wire: '0', phase: false }, { wire: '1', phase: false }], 'Multiwire previews select body wires without including the phase row');
  await activate(page.locator('#close-generator-picker'));
  assert.deepEqual(await savedDraft(page), beforePreview);
  await activate(chip(page, first.id));
  const phaseSide = touch ? 'left' : 'right';
  await activate(side(page, 'r1', phaseSide).locator('[data-action="delete-selection"]'));
  assert.equal((await operations(phaseSide)).some(operation => operation.id === first.id), false);
  await activate(page.locator('#undo-theory'));
  assert.deepEqual(await savedDraft(page), beforePreview, 'Deleting a phase is a normal undoable edit');
  const zeroWire = side(page, 'r0').locator('.insert-slot[data-phase][data-boundary="0"]');
  await openPicker(page, zeroWire, touch);
  assert.deepEqual(await picker(page).locator('.picker-arity').allTextContents(), ['Global phase'], 'Zero-wire equations offer only scalar choices');
  await page.keyboard.press('Escape');
  await addAt(page, zeroWire, 'omega', touch);
  let current = await savedDraft(page);
  assert.equal(current.rules[1].wires, 0);
  assert.equal(current.rules[1].left[0].wire, 0);
  assert.equal(await rule(page, 'r0').locator('.wire-line').count(), 0, 'A zero-wire equation remains wireless');
  const exported = exportTheory(current).equations.flatMap(equation => [...equation.lhs.ops, ...equation.rhs.ops]).filter(operation => operation.gen === 'omega');
  assert.ok(exported.length >= 6);
  assert.equal(exported.every(operation => Array.isArray(operation.on) && operation.on.length === 0), true, 'Global phases export with on: []');
  await openDraft(page, serializeDraft({ ...current, name: 'Scalar shortcut phases',
    shortcuts: [{ id: 'phi', name: 'phi', wires: 0, left: [], right: [] }] }));
  const scalarDefinition = side(page, 'phi').locator('.insert-slot[data-phase][data-boundary="0"]');
  await openPicker(page, scalarDefinition, touch);
  assert.equal(await pickerChoice(page, 'phi').isDisabled(), true, 'Scalar shortcuts cannot contain themselves');
  assert.equal(await picker(page).locator('[data-picker-generator="h"]').count(), 0, 'Scalar definitions offer no wired gates');
  await page.keyboard.press('Escape');
  await addAt(page, scalarDefinition, 'omega', touch);
  await addAt(page, insert(page, 'r1', 1, 4), 'phi', touch);
  current = await savedDraft(page);
  assert.equal(current.shortcuts[0].left[0].generator, 'omega');
  assert.equal(current.rules[0].left.find(operation => operation.generator === 'phi').wire, 0);
  assert.deepEqual(exportTheory(current).equations[0].lhs.ops.at(-1), { gen: 'omega', on: [] }, 'Scalar shortcuts use the same menu and expand to global phases');
  assert.equal(await page.locator('[data-phase-add]').count(), 0, 'Neither equations nor shortcuts add persistent phase controls');
  const source = await saveDraft(page, `global-phases-${touch ? 'mobile' : 'desktop'}`);
  await openDraft(page, source);
  assert.deepEqual(await savedDraft(page), current, 'Phase IDs, positions and zero-wire equations survive Save/Open');
  await page.locator('#theory-structure').selectOption('Controlled PROP');
  const beforeControl = await savedDraft(page);
  await activate(chip(page, current.rules[1].left[0].id));
  await controlAt(page, 'r0', 'above', { touch });
  const controlled = (await savedDraft(page)).rules[1];
  assert.equal(controlled.wires, 1);
  assert.deepEqual(controlled.left[0].controls, [{ wire: 0, value: 1 }], 'The shared picker still controls a scalar circuit on a new wire');
  await activate(page.locator('#undo-theory'));
  assert.deepEqual(await savedDraft(page), beforeControl, 'Undo restores the zero-wire scalar circuit');
  await activate(page.locator('#undo-theory'));
  assert.deepEqual(await savedDraft(page), current);
  await activate(chip(page, first.id));
  const phaseBounds = await chip(page, first.id).boundingBox(), headerBounds = await page.locator('.minimality-heading').boundingBox();
  assert.ok(phaseBounds.y >= headerBounds.y + headerBounds.height - 1 && phaseBounds.y + phaseBounds.height <= page.viewportSize().height + 1,
    `The selected phase remains visible below the sticky toolbar: ${JSON.stringify({ phaseBounds, headerBounds })}`);
  await fits(page, `${touch ? 'touch' : 'mouse'} global phases`);
  await page.screenshot({ path: join(output, `${touch ? 'mobile' : 'desktop'}-global-phases.png`), fullPage: true });
  await rule(page, 'r0').evaluate(card => card.scrollIntoView({ block: 'center' }));
  await audit(page, `${touch ? 'touch' : 'mouse'} global phases`);
  report.checks.push(`${touch ? 'touch' : 'mouse'}: menu phases, bottom-wire choice, phase-row insertion/free cells, scalar ${touch ? 'placement' : 'drags'}, cancellation/deletion/undo, scalar equations/shortcuts, on: [], Save/Open and scalar control menu`);
}

async function referenceLibrary(page, touch = false) {
  const activate = target => target[touch ? 'tap' : 'click']();
  const dialog = page.locator('#theory-references-dialog'), list = dialog.locator('#theory-references-list');
  const trigger = page.locator('#see-references');
  const term = id => list.locator(`dt[data-theory-id="${id}"]`);
  const row = id => list.locator(`dt[data-theory-id="${id}"] + dd`);
  const link = id => row(id).locator('a');
  const reload = async () => {
    const pending = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/minimality' && url.search === '?zoo=1' && response.request().method() === 'GET';
    });
    await activate(page.locator('#reload-zoo'));
    const response = await pending;
    assert.equal(response.status(), 200);
    const catalog = await response.json();
    assert.ok(Array.isArray(catalog.theories));
    await page.waitForFunction(() => !document.getElementById('theory-zoo').disabled && document.getElementById('theory-zoo').getAttribute('aria-busy') === 'false');
    return catalog;
  };
  const catalog = await reload();
  assert.equal(catalog.theories.length, 24, 'The current official zoo has 24 referenced entries');
  assert.equal(await list.locator('dt').count(), catalog.theories.length, 'References include supported and unsupported zoo entries');
  const verifyCatalog = async shown => {
    const names = await list.locator('dt').allTextContents();
    assert.equal(new Set(names).size, shown.theories.length, 'Every official presentation has a distinct selector and reference name');
    const options = await page.locator('#theory-zoo option').evaluateAll(options => options.filter(option => option.value).map(option => option.textContent));
    assert.deepEqual([...options].sort(), [...names].sort(), 'Selector and references use the same distinct names');
    for (const entry of shown.theories) {
      const expected = describeZooEntry(entry, shown.commit);
      assert.equal(await term(entry.id).textContent(), expected.name);
      assert.doesNotMatch(expected.name, /\(Figure\s+\d+\)/i);
      const citation = row(entry.id).locator('a[href^="https://arxiv.org/abs/"]');
      const contact = row(entry.id).locator('a[href^="mailto:"]');
      assert.equal(await contact.count(), Number(expected.adapted || !expected.arxiv));
      assert.equal(await citation.count(), Number(Boolean(expected.arxiv)));
      if (expected.arxiv) {
        assert.equal(await citation.getAttribute('href'), `https://arxiv.org/abs/${expected.arxiv}`);
        assert.equal(await citation.textContent(), `${expected.adapted ? 'Related paper · ' : ''}arXiv:${expected.arxiv}`);
        assert.equal(await citation.getAttribute('target'), '_blank');
        assert.equal(await citation.getAttribute('rel'), 'noopener noreferrer');
      }
      assert.equal(await row(entry.id).locator('.reference-note').textContent(), expected.note);
    }
    if (shown.commit === AUDITED_ZOO_COMMIT) {
      assert.equal(await list.locator('a[href^="mailto:"]').count(), 14, 'Adapted presentations direct their exact provenance to Colin');
      assert.equal(await list.locator('a').filter({ hasText: /^Related paper/ }).count(), 14);
      assert.equal(await list.locator('a').filter({ hasText: /^arXiv:/ }).count(), 10, 'Published encodings have direct paper references');
      assert.equal(await list.locator('a[href^="https://arxiv.org/abs/"]').evaluateAll(links => links.every(link => /v[1-9]\d*$/.test(link.href))), true, 'Audited references pin the paper revision');
      assert.equal(await term('real_clifford_ch').textContent(), 'Real Clifford+CH');
      assert.equal(await term('realclifford-ch-simplified').textContent(), 'Real Clifford+CH (simplified)');
      assert.match(await row('realclifford-ch-simplified').textContent(), /\(4\), \(9\) and \(16\).*removed/);
      assert.match(await row('real_clifford_ch').textContent(), /n = 5,…,10.*n ≥ 5/);
      assert.match(await row('real_clifford').textContent(), /corrects.*right-hand side of CF/);
      assert.match(await row('multi_qudit_clifford_d3').textContent(), /different 16-rule presentation and scalar convention/);
    }
  };
  await verifyCatalog(catalog);
  const disabledIds = await page.locator('#theory-zoo option:disabled').evaluateAll(options => options.map(option => option.value));
  assert.equal(disabledIds.length, 15);
  for (const id of disabledIds) assert.equal(await term(id).count(), 1, `${id}: unavailable presentations still have references`);
  assert.equal(await term('qubit_clifford').textContent(), 'Qubit Clifford');
  assert.equal(await term('affine_d5').textContent(), 'Affine circuits (d=5 instance)', 'Dimension annotations remain part of the theory name');
  assert.doesNotMatch((await page.locator('#theory-zoo').textContent()), /\(Figure\s+\d+\)/i);
  const before = await savedDraft(page);
  const selected = await page.locator('.placed-gate[data-selected]').evaluateAll(gates => gates.map(gate => gate.dataset.operationId));
  const history = await page.locator('#undo-theory, #redo-theory').evaluateAll(buttons => buttons.map(button => button.disabled));
  await trigger.focus();
  await page.keyboard.press('Enter');
  await dialog.waitFor({ state: 'visible' });
  assert.equal(await dialog.getAttribute('aria-labelledby'), 'theory-references-title');
  await page.keyboard.press('Tab');
  assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, 'Reference links participate in native dialog keyboard navigation');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await trigger.evaluate(element => element === document.activeElement), true, 'Escape returns focus to See references');
  assert.deepEqual(await savedDraft(page), before, 'Reading references leaves the theory unchanged');
  assert.deepEqual(await page.locator('.placed-gate[data-selected]').evaluateAll(gates => gates.map(gate => gate.dataset.operationId)), selected, 'Dialog Escape preserves the selected circuit gates');
  assert.deepEqual(await page.locator('#undo-theory, #redo-theory').evaluateAll(buttons => buttons.map(button => button.disabled)), history);
  await activate(trigger);
  await dialog.waitFor({ state: 'visible' });
  const bounds = await dialog.boundingBox(), viewport = page.viewportSize();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1);
  assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'The reference dialog has no horizontal overflow');
  await fits(page, `${touch ? 'touch' : 'mouse'} references`);
  await page.screenshot({ path: join(output, `${touch ? 'mobile' : 'desktop'}-references.png`) });
  await audit(page, `${touch ? 'touch' : 'mouse'} references`);
  await activate(dialog.locator('[data-modal-close]'));
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
  await activate(trigger);
  if (touch) await page.touchscreen.tap(1, 1);
  else await page.mouse.click(1, 1);
  await dialog.waitFor({ state: 'hidden' });

  await page.locator('#theory-zoo').selectOption('qubit_clifford');
  assert.equal((await savedDraft(page)).name, 'Qubit Clifford', 'Official import titles omit figure annotations');
  const custom = { ...(await savedDraft(page)), name: 'My presentation (Figure 9)' };
  await openDraft(page, serializeDraft(custom));
  assert.equal((await savedDraft(page)).name, custom.name, 'Native user files retain their own titles');
  const extra = { id: 'future_reference_test', name: 'Future theory (Figure 99)', theory: { ...catalog.theories.find(entry => entry.id === 'qubit_clifford').theory, name: 'Future theory (Figure 99)' } };
  let mocked = { ...catalog, theories: [...catalog.theories, extra] };
  const route = request => request.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mocked) });
  await page.route('**/api/minimality?zoo=1', route);
  try {
    await reload();
    await activate(trigger);
    await dialog.waitFor({ state: 'visible' });
    assert.equal(await term(extra.id).textContent(), 'Future theory');
    assert.equal(await link(extra.id).textContent(), 'Ask Colin');
    assert.ok((await link(extra.id).getAttribute('href')).startsWith(`mailto:${await list.getAttribute('data-contact')}`));
    assert.match(await row(extra.id).locator('.reference-note').textContent(), /not been verified|not been checked/);
    await activate(dialog.locator('[data-modal-close]'));
    mocked = { ...catalog, commit: '0'.repeat(40) };
    await reload();
    await verifyCatalog(mocked);
    assert.equal(await list.locator('a[href^="mailto:"]').count(), catalog.theories.length, 'A changed GitHub revision cannot reuse audited publication claims');
    assert.equal(await list.locator('.reference-note').evaluateAll(notes => notes.every(note => /revision has not been checked/.test(note.textContent))), true);
    assert.equal(await page.locator('#theory-zoo option[value="qubit_clifford"]').isEnabled(), true, 'Unverified provenance leaves compatible theory imports available');
    await page.locator('#theory-zoo').selectOption('qubit_clifford');
    assert.equal((await savedDraft(page)).name, 'Qubit Clifford');
    await openDraft(page, serializeDraft(custom));
    mocked = catalog;
    await reload();
    await verifyCatalog(catalog);
  } finally {
    await page.unroute('**/api/minimality?zoo=1', route);
  }
  assert.equal(await list.locator('dt').count(), catalog.theories.length);
  assert.deepEqual(await savedDraft(page), custom, 'Reference refresh and fallback rendering never replace the current presentation');
  report.checks.push(`${touch ? 'touch' : 'mouse'}: distinct official zoo names, pinned papers and adapted provenance, native dialog focus/state, future Ask Colin fallback and changed-revision import guard`);
}

async function officialZooShortcuts(page, touch = false) {
  const activate = target => target[touch ? 'tap' : 'click']();
  const profile = touch ? 'mobile' : 'desktop';
  const aliases = { CNOT_zero: 'CX0', CH_zero: 'CH0', CZ_zero: 'CZ0', Z_zero: 'Z0',
    phase_T: 'pT', phase_T_dagger: 'pT_dagger', phase_T_zero: 'pT0' };
  const shortcutNames = fixture => Object.keys(fixture.macros).slice(0, 12).map(name => aliases[name] ?? name);
  const native = JSON.parse(await readFile('tests/fixtures/minimality/zoo/qubit_clifford.json', 'utf8'));
  await page.locator('#theory-file').setInputFiles({ name: 'qubit-clifford.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(native)) });
  await page.waitForFunction(name => document.getElementById('theory-name').value === name, native.name);
  assert.deepEqual((await savedDraft(page)).shortcuts.map(shortcut => shortcut.name), shortcutNames(native), 'Native theory files retain every macro as a shortcut');
  const load = async id => {
    const fixture = JSON.parse(await readFile(`tests/fixtures/minimality/zoo/${id}.json`, 'utf8'));
    const shortcuts = shortcutNames(fixture);
    await page.locator('#theory-zoo').selectOption(id);
    await expandShortcuts(page);
    const draft = await savedDraft(page), exported = exportTheory(draft);
    assert.deepEqual(draft.generators.map(generator => generator.name), Object.keys(fixture.generators), `${id}: primitive generators are unchanged`);
    assert.equal(draft.rules.length, fixture.equations.length, `${id}: shortcuts add no axioms`);
    assert.deepEqual(draft.shortcuts.map(shortcut => shortcut.name), shortcuts, `${id}: macros remain editable within the shortcut limit`);
    assert.equal(await page.locator('.shortcut-card').count(), shortcuts.length);
    assert.deepEqual(Object.keys(exported.generators), Object.keys(fixture.generators));
    assert.equal(exported.equations.length, fixture.equations.length);
    return draft;
  };
  const named = (draft, name) => draft.shortcuts.find(shortcut => shortcut.name === name);
  const contains = (draft, definition, dependency) => named(draft, definition).left.some(operation => operation.generator === named(draft, dependency).id);
  let draft = await load('qubit_clifford');
  assert.equal(contains(draft, 'X', 'Z'), true, 'Imported X retains its nested Z reference');
  const e = draft.rules.find(rule => rule.name === 'E'), dagger = named(draft, 'S_dagger');
  assert.equal(e.right.filter(operation => operation.generator === dagger.id).length, 2);
  assert.equal(await side(page, e.id, 'right').locator('.gate-chip').filter({ hasText: /^S†$/ }).count(), 2, 'Actual equations show S_dagger calls as readable single boxes');
  const omegaDagger = named(draft, 'omega_dagger');
  assert.equal(omegaDagger.wires, 0, 'Unused scalar macros are imported');
  assert.equal(await rule(page, omegaDagger.id).locator('[data-field="shortcut-name"]').inputValue(), 'omega_dagger', 'Pretty printing preserves the editable raw shortcut name');
  assert.equal(await rule(page, omegaDagger.id).locator('.name-preview').textContent(), 'ω†', 'Scalar shortcut headers pretty print Greek letters and dagger suffixes');
  draft = await load('clifford_cs');
  const cnot = named(draft, 'CNOT'), b = draft.rules.find(rule => rule.name === 'B');
  assert.equal(cnot.wires, 2);
  assert.equal(b.left.filter(operation => operation.generator === cnot.id).length, 2);
  assert.equal(await side(page, b.id).locator('.gate-chip').filter({ hasText: /^CNOT$/ }).count(), 2, 'Clifford+CS equations keep CNOT shortcut boxes');
  assert.equal(exportTheory(draft).equations.flatMap(equation => [...equation.lhs.ops, ...equation.rhs.ops]).some(operation => operation.gen === 'CNOT'), false, 'CNOT expands to the underlying H and CS generators');
  draft = await load('qutrit_clifford');
  assert.equal(contains(draft, 'X', 'Z') && contains(draft, 'X', 'H3') && contains(draft, 'Z', 'S_prime') && contains(draft, 'S_prime', 'K'), true, 'Qutrit nested definitions remain nested');
  draft = await load('real_clifford');
  const names = new Map(availableGates(draft).map(gate => [gate.id, gate.name]));
  assert.deepEqual(named(draft, 'X').left.map(operation => names.get(operation.generator)), ['H', 'Z', 'H']);
  draft = await load('quadratic_phase_simplified_d5');
  const cz = named(draft, 'CZ'), q28 = draft.rules.find(rule => rule.name === 'Q28');
  assert.equal(await page.locator('#theory-zoo option[value="quadratic_phase_simplified_d5"]').isEnabled(), true, 'The CZ shortcut makes the quadratic presentation available');
  assert.equal(draft.rules.length, 19);
  assert.equal(q28.left.filter(operation => operation.generator === cz.id).length, 4);
  assert.equal(Math.max(...exportTheory(draft).equations.flatMap(equation => [equation.lhs.ops.length, equation.rhs.ops.length])), 60, 'Expanded quadratic circuits remain within search bounds');
  report.checks.push(`${profile}: native/zoo imports preserve all Clifford macros, nested X/Z and Qutrit definitions, S_dagger/CNOT equation boxes, primitive/axiom counts and the newly available quadratic CZ theory`);

  assert.equal(await page.locator('#theory-zoo option[value="multi_qudit_clifford_d3"]').isEnabled(), true, 'Nested shortcuts also make the d=3 qudit presentation available');
  await cliffordTTheory(page, touch, await load('clifford_t'));

  draft = await load('qubit_clifford');
  const x = named(draft, 'X'), z = named(draft, 'Z'), s = draft.generators.find(generator => generator.name === 'S');
  await activate(page.locator('#add-rule'));
  const equationId = (await savedDraft(page)).rules.at(-1).id;
  await rule(page, equationId).locator('[data-field="rule-wires"]').selectOption('1');
  await addAt(page, insert(page, equationId, 0, 0), x.id, touch);
  await addAt(page, insert(page, equationId, 0, 0, 'right'), z.id, touch);
  assert.equal(await side(page, equationId).locator('.gate-chip').count(), 1);
  assert.equal(await side(page, equationId, 'right').locator('.gate-chip').count(), 1, 'Imported shortcuts can be used as ordinary palette choices');
  const exported = () => savedDraft(page).then(value => exportTheory(value).equations.at(-1));
  assert.deepEqual((await exported()).lhs.ops.map(operation => operation.gen), ['H', 'S', 'S', 'H']);
  assert.deepEqual((await exported()).rhs.ops.map(operation => operation.gen), ['S', 'S']);
  const beforeEdit = await savedDraft(page);
  await addAt(page, insert(page, z.id, 0, 2), s.id, touch);
  assert.deepEqual((await exported()).lhs.ops.map(operation => operation.gen), ['H', 'S', 'S', 'S', 'H'], 'Editing imported Z updates nested imported X instances');
  assert.deepEqual((await exported()).rhs.ops.map(operation => operation.gen), ['S', 'S', 'S']);
  const edited = await savedDraft(page);
  const source = await saveDraft(page, `zoo-shortcuts-${profile}`);
  await activate(page.locator('#undo-theory'));
  assert.deepEqual(await savedDraft(page), beforeEdit, 'Imported definition edits are one undo step');
  await activate(page.locator('#new-theory'));
  await openDraft(page, source);
  assert.deepEqual(await savedDraft(page), edited, 'Save/Open retains imported definitions, nested references, edits and equation instances');
  assert.deepEqual(Object.keys(exportTheory(edited).generators), Object.keys(native.generators));
  assert.equal(exportTheory(edited).equations.length, native.equations.length + 1);
  await fits(page, `${profile} zoo shortcuts`);
  await page.screenshot({ path: join(output, `${profile}-zoo-shortcuts.png`), fullPage: true });
  await audit(page, `${profile} zoo shortcuts`);
  report.checks.push(`${profile}: imported X/Z picker use, nested live updates, undo, editable Save/Open and underlying-generator export`);
}

async function cliffordTTheory(page, touch, draft) {
  const activate = target => target[touch ? 'tap' : 'click']();
  const profile = touch ? 'mobile' : 'desktop';
  const native = JSON.parse(await readFile('tests/fixtures/minimality/zoo/clifford_t.json', 'utf8'));
  const named = name => draft.shortcuts.find(shortcut => shortcut.name === name);
  assert.equal(draft.generators.length, 4);
  assert.equal(draft.rules.length, 11);
  assert.equal(draft.shortcuts.length, 12, 'The existing shortcut count limit is unchanged');
  assert.equal(draft.shortcuts.some(shortcut => shortcut.name === 'pT0'), false, 'The thirteenth unused macro stays outside the shortcut list');
  for (const [name, size] of [['CH', 7], ['CH0', 3], ['CS_dagger', 3]]) {
    assert.equal(named(name).left.length, size, `${name} retains compact nested calls`);
    assert.equal(await side(page, named(name).id).locator('.gate-chip').count(), size);
  }
  assert.equal(await rule(page, named('CH0').id).locator('[data-field="shortcut-name"]').inputValue(), 'CH0', 'Imported CH_zero uses its compact editable label');
  assert.equal(named('CX0').wires, 2);
  assert.equal(named('pT').wires, 2);
  assert.equal(named('pT_dagger').wires, 2);
  const csh = draft.rules.find(rule => rule.name === 'CSH');
  for (const target of ['left', 'right']) {
    assert.deepEqual(await side(page, csh.id, target).locator('.gate-chip').allTextContents(), target === 'left' ? ['CS', 'CH0'] : ['CH0', 'CS']);
  }
  await labelsFit(page, page.locator('.gate-chip').filter({ hasText: /^CH0$/ }), `${profile} imported CH0`);
  await rule(page, named('CH0').id).screenshot({ path: join(output, `${profile}-clifford-t-CH0.png`), timeout: 10_000 });
  await rule(page, csh.id).screenshot({ path: join(output, `${profile}-clifford-t-CSH.png`), timeout: 10_000 });
  const hth = draft.rules.find(rule => rule.name === 'HTH');
  const expanded = exportTheory(draft).equations.find(equation => equation.id === 'HTH');
  for (const target of ['left', 'right']) {
    assert.equal(hth[target].length, 10, 'HTH has six gate calls and four routing swaps');
    assert.equal(hth[target].filter(operation => operation.generator === '$swap').length, 4);
    assert.equal(await side(page, hth.id, target).locator('.gate-chip').count(), 10);
    assert.equal(expanded[target === 'left' ? 'lhs' : 'rhs'].ops.length, 106, 'Search expands the full HTH circuit without dropping operations');
  }
  await page.locator('#theory-file').setInputFiles({ name: 'clifford-t.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(native)) });
  await page.waitForFunction(name => document.getElementById('theory-name').value === name, native.name);
  const imported = await savedDraft(page);
  assert.deepEqual(imported, { ...draft, name: native.name }, 'Native files and the official zoo import the same Clifford+T circuits');
  const source = await saveDraft(page, `clifford-t-${profile}`);
  await activate(page.locator('#new-theory'));
  await openDraft(page, source);
  await page.reload();
  await expandShortcuts(page);
  await rule(page, hth.id).waitFor();
  assert.deepEqual(await savedDraft(page), imported, 'Clifford+T definitions, rules and routed calls survive Save/Open and reload');
  if (!touch) {
    await page.locator('#search-timeout').selectOption('10');
    const request = page.waitForRequest(request => new URL(request.url()).pathname === '/api/minimality' && request.method() === 'POST');
    const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/minimality' && response.request().method() === 'POST');
    await activate(page.locator('#run-search'));
    const payload = (await request).postDataJSON();
    assert.deepEqual(Object.keys(payload.theory.generators), Object.keys(native.generators));
    assert.deepEqual(payload.theory.equations.map(equation => equation.id), native.equations.map(equation => equation.id));
    const sent = payload.theory.equations.find(equation => equation.id === 'HTH');
    assert.equal(sent.lhs.ops.length, 106);
    assert.equal(sent.rhs.ops.length, 106);
    assert.equal((await response).status(), 200, 'The real API accepts expanded Clifford+T equations');
    await page.waitForFunction(() => !document.getElementById('run-search').hasAttribute('data-running'), null, { timeout: 90_000 });
    assert.equal(await page.locator('#search-error').isVisible(), false);
    assert.equal(await page.locator('.result-row').count(), 11);
    assert.equal(await page.locator('.result-row[data-state="pending"]').count(), 0);
    assert.match(await page.locator('#search-progress').textContent(), /^(Finished|Time limit reached) · /);
    report.checks.push('real Clifford+T search accepts both106-operation HTH sides, four primitive generators and all11 equations');
  }
  await activate(page.locator('#add-rule'));
  const equationId = (await savedDraft(page)).rules.at(-1).id;
  await rule(page, equationId).locator('[data-field="rule-wires"]').selectOption('1');
  await addAt(page, insert(page, equationId, 0, 0), named('X').id, touch);
  await addAt(page, insert(page, equationId, 0, 0, 'right'), named('T_dagger').id, touch);
  assert.deepEqual(await side(page, equationId).locator('.gate-chip').allTextContents(), ['X']);
  assert.deepEqual(await side(page, equationId, 'right').locator('.gate-chip').allTextContents(), ['T†']);
  const added = exportTheory(await savedDraft(page)).equations.at(-1);
  assert.deepEqual(added.lhs.ops.map(operation => operation.gen), ['H', 'T', 'T', 'T', 'T', 'H']);
  assert.deepEqual(added.rhs.ops.map(operation => operation.gen), Array(7).fill('T'));
  await fits(page, `${profile} Clifford+T`);
  await rule(page, named('CH').id).screenshot({ path: join(output, `${profile}-clifford-t-CH.png`), timeout: 10_000 });
  await rule(page, hth.id).screenshot({ path: join(output, `${profile}-clifford-t-HTH.png`), timeout: 10_000 });
  await audit(page, `${profile} Clifford+T label cards`, ['#generator-list', `[data-rule-id="${named('CH0').id}"]`, `[data-rule-id="${csh.id}"]`]);
  report.checks.push(`${profile}: Clifford+T dropdown/native imports, compact nested boxes, unchanged editor bounds, Save/Open/reload and reusable X/T† shortcuts`);
}

async function circuitShortcuts(page, touch = false) {
  const activate = target => target[touch ? 'tap' : 'click']();
  const profile = touch ? 'mobile' : 'desktop';
  const definition = async id => (await savedDraft(page)).shortcuts.find(shortcut => shortcut.id === id);
  const operations = async () => (await savedDraft(page)).rules[0].left;
  const create = async (name, wires) => {
    await activate(page.locator('#add-shortcut'));
    const id = (await savedDraft(page)).shortcuts.at(-1).id;
    const field = rule(page, id).locator('[data-field="shortcut-name"]');
    await field.fill(name);
    await field.press('Tab');
    await rule(page, id).locator('[data-field="shortcut-wires"]').selectOption(String(wires));
    return id;
  };
  await openDraft(page, JSON.stringify({ version: 1, name: `Circuit shortcuts ${profile}`, structure: 'PRO', controlValues: 2,
    generators: [{ id: 'h', name: 'H', arity: 1 }, { id: 'z', name: 'Z', arity: 1 }],
    rules: [{ id: 'r1', name: 'Using shortcuts', wires: 1, left: [], right: [] }],
  }));
  const reserved = await create('G1', 1);
  await activate(page.locator('#add-generator'));
  const added = (await savedDraft(page)).generators.at(-1);
  assert.equal(added.name, 'G2', 'New generator names skip shortcut names');
  await activate(generator(page, added.id).locator('[data-action="remove-generator"]'));
  await activate(rule(page, reserved).locator('[data-action="remove-shortcut"]'));
  const x = await create('X', 1);
  for (const [column, gate] of ['h', 'z', 'h'].entries()) await addAt(page, insert(page, x, 0, column), gate, touch);
  assert.deepEqual((await definition(x)).left.map(operation => operation.generator), ['h', 'z', 'h']);
  assert.equal((await savedDraft(page)).rules[0].left.length, 0, 'Defining a shortcut adds no equation operations');
  await addAt(page, insert(page, 'r1', 0, 0), x, touch);
  if (touch) await addAt(page, insert(page, 'r1', 0, 0, 'right'), x, true);
  else await rule(page, x).locator('.generator-drag').dragTo(insert(page, 'r1', 0, 0, 'right'));
  assert.equal(await side(page, 'r1').locator('.gate-chip').count(), 1, 'A shortcut is one equation box');
  assert.equal(await side(page, 'r1', 'right').locator('.gate-chip').count(), 1, 'Palette insertion adds one shortcut instance');
  let exported = exportTheory(await savedDraft(page));
  assert.deepEqual(exported.equations[0].lhs.ops, ['H', 'Z', 'H'].map(gen => ({ gen, on: [0] })));
  assert.deepEqual(exported.equations[0].rhs.ops, exported.equations[0].lhs.ops);
  report.checks.push(`${profile}: graphical H Z H shortcut definition and ${touch ? 'touch picker' : 'picker/drag'} insertion as one box`);

  const nested = await create('Nest', 1);
  await addAt(page, insert(page, nested, 0, 0), x, touch);
  await openPicker(page, insert(page, x, 0, 3), touch);
  assert.equal(await pickerChoice(page, x).isDisabled(), true, 'A shortcut cannot contain itself');
  assert.equal(await pickerChoice(page, nested).isDisabled(), true, 'A nested dependency cannot create a cycle');
  await page.keyboard.press('Escape');
  await addAt(page, insert(page, 'r1', 0, 1), nested, touch);
  const z = (await definition(x)).left.find(operation => operation.generator === 'z');
  await activate(chip(page, z.id));
  await activate(side(page, x).locator('[data-action="delete-selection"]'));
  exported = exportTheory(await savedDraft(page));
  assert.deepEqual(exported.equations[0].lhs.ops.map(operation => operation.gen), ['H', 'H', 'H', 'H'], 'Editing a definition updates direct and nested instances');
  assert.deepEqual(exported.equations[0].rhs.ops.map(operation => operation.gen), ['H', 'H']);
  await activate(page.locator('#undo-theory'));
  assert.deepEqual((await definition(x)).left.map(operation => operation.generator), ['h', 'z', 'h']);
  const name = rule(page, x).locator('[data-field="shortcut-name"]');
  await name.fill('Xn');
  await name.press('Tab');
  assert.equal(await side(page, nested).locator('.gate-chip').textContent(), 'Xn', 'Renaming updates nested boxes');
  assert.equal(await side(page, 'r1', 'right').locator('.gate-chip').textContent(), 'Xn', 'Renaming updates equation boxes');
  const beforeDelete = await savedDraft(page);
  await activate(rule(page, x).locator('[data-action="remove-shortcut"]'));
  assert.deepEqual(await savedDraft(page), beforeDelete, 'Deleting a used shortcut is rejected atomically');
  assert.match(await rule(page, x).locator('.inline-message').textContent(), /Remove this shortcut/);

  const source = await saveDraft(page, `shortcuts-${profile}`);
  await activate(page.locator('#new-theory'));
  assert.equal(await page.locator('.shortcut-card').count(), 0);
  await openDraft(page, source);
  await page.reload();
  await expandShortcuts(page);
  await rule(page, x).waitFor();
  assert.deepEqual(await savedDraft(page), beforeDelete, 'Shortcut definitions and instances survive Save/Open and reload');
  const nestedInstance = (await operations()).find(operation => operation.generator === nested);
  await activate(chip(page, nestedInstance.id));
  await activate(side(page, 'r1').locator('[data-action="delete-selection"]'));
  await activate(rule(page, nested).locator('[data-action="remove-shortcut"]'));
  assert.equal((await savedDraft(page)).shortcuts.length, 1, 'An unused shortcut can be removed');
  await activate(page.locator('#undo-theory'));
  await activate(page.locator('#undo-theory'));
  assert.deepEqual(await savedDraft(page), beforeDelete, 'Undo restores a removed definition and its instance');
  report.checks.push(`${profile}: nested shortcut cycle protection, live editing/renaming, used-delete rejection, unused deletion, undo and file/reload persistence`);

  await page.locator('#search-timeout').selectOption('10');
  const request = page.waitForRequest(request => new URL(request.url()).pathname === '/api/minimality' && request.method() === 'POST');
  await activate(page.locator('#run-search'));
  const payload = (await request).postDataJSON();
  assert.deepEqual(Object.keys(payload.theory.generators).sort(), ['H', 'Z'], 'Search receives only underlying generators');
  assert.equal(payload.theory.equations.length, 1, 'Shortcut definitions add no search axioms');
  assert.deepEqual(payload.theory.equations[0].lhs.ops.map(operation => operation.gen), ['H', 'Z', 'H', 'H', 'Z', 'H']);
  assert.deepEqual(payload.theory.equations[0].rhs.ops.map(operation => operation.gen), ['H', 'Z', 'H']);
  await page.waitForFunction(() => !document.getElementById('run-search').hasAttribute('data-running'), null, { timeout: 90_000 });
  assert.equal(await page.locator('#search-error').isVisible(), false, 'The real API accepts the expanded shortcut theory');

  await rule(page, 'r1').locator('[data-field="rule-wires"]').selectOption('2');
  const pair = await create('Pair', 2);
  await addAt(page, insert(page, pair, 0, 0), 'h', touch);
  await addAt(page, cell(page, pair, 1, 0), 'z', touch);
  await addAt(page, insert(page, 'r1', 0, 2), pair, touch);
  const pairInstance = (await operations()).find(operation => operation.generator === pair);
  assert.equal(await chip(page, pairInstance.id).count(), 1, 'A two-wire shortcut remains one box');
  const parallel = exportTheory(await savedDraft(page)).equations[0].lhs.ops.slice(-2);
  assert.deepEqual(parallel, [{ gen: 'H', on: [0] }, { gen: 'Z', on: [1] }], 'Shortcut expansion retains parallel wire offsets');

  const withPhase = await savedDraft(page);
  withPhase.generators.push({ id: 'omega', name: 'omega', arity: 0 });
  await openDraft(page, serializeDraft({ ...withPhase, name: `${withPhase.name} with phase` }));
  const phase = await create('phi', 0);
  await addAt(page, side(page, phase).locator('.insert-slot[data-phase][data-boundary="0"]'), 'omega', touch);
  await addAt(page, insert(page, 'r1', 1, 3), phase, touch);
  const phaseInstance = (await operations()).find(operation => operation.generator === phase);
  assert.equal(phaseInstance.wire, 0);
  assert.deepEqual(exportTheory(await savedDraft(page)).equations[0].lhs.ops.at(-1), { gen: 'omega', on: [] }, 'A scalar shortcut exports as a global phase');
  await page.locator('#theory-structure').selectOption('Controlled PROP');
  await page.keyboard.press('Escape');
  const instance = (await operations()).find(operation => operation.generator === x);
  const body = await definition(x);
  await activate(chip(page, instance.id));
  await controlAt(page, 'r1', 1, { touch });
  assert.deepEqual((await operations()).find(operation => operation.id === instance.id).controls, [{ wire: 1, value: 1 }], 'A shortcut instance can be controlled as one circuit');
  assert.deepEqual(await definition(x), body, 'Controlling an instance leaves its shared definition unchanged');
  await fits(page, `${profile} shortcuts`);
  await page.screenshot({ path: join(output, `${profile}-shortcuts.png`), fullPage: true });
  await audit(page, `${profile} shortcuts`);
  if (!touch) {
    const viewport = page.viewportSize();
    await page.setViewportSize({ width: 780, height: 1000 });
    await fits(page, 'intermediate shortcuts');
    assert.equal(await page.locator('.shortcut-card .equation-toolbar').evaluateAll(headers =>
      headers.every(header => header.scrollWidth <= header.clientWidth + 1)), true, 'Shortcut headers fit at intermediate widths');
    await page.screenshot({ path: join(output, 'intermediate-shortcuts.png'), fullPage: true });
    await audit(page, 'intermediate shortcuts');
    await page.setViewportSize(viewport);
  }
  report.checks.push(`${profile}: real expanded search payload, multiwire/scalar shortcuts and controlled instances`);
}

const chip = (page, id) => page.locator(`[data-operation-id="${id}"] .gate-chip`);
const controlButton = (page, id, value = 'left') => side(page, id, value).locator('[data-action="control-circuit"]');
const controlChoice = (page, wire) => picker(page).locator(`[data-control-wire="${wire}"]`);

async function controlAt(page, id, wire, { value = 1, side: target = 'left', touch = false } = {}) {
  await controlButton(page, id, target)[touch ? 'tap' : 'click']();
  await picker(page).waitFor({ state: 'visible' });
  assert.match(await picker(page).getAttribute('aria-label'), /^Control /);
  if (await picker(page).locator('#control-value').count()) await page.locator('#control-value').selectOption(String(value));
  assert.equal(await controlChoice(page, wire).isEnabled(), true);
  await controlChoice(page, wire)[touch ? 'tap' : 'click']();
  await picker(page).waitFor({ state: 'hidden' });
}

async function modeChecks(page) {
  const make = (name, structure, wires, left = [], right = [], generators = [{ id: 'g1', name: 'H', arity: 1 }, { id: 'g2', name: 'X', arity: 1 }]) =>
    ({ version: 1, name, structure, controlValues: 2, generators, rules: [{ id: 'r1', name: 'Equation', wires, left, right }] });
  const gate = (id, generator, wire, column, controls) => ({ id, generator, wire, column, ...(controls ? { controls } : {}) });
  const load = draft => openDraft(page, serializeDraft(draft));
  const ops = async (target = 'left') => (await savedDraft(page)).rules[0][target];
  const rejectMode = async target => {
    const before = await savedDraft(page);
    await page.locator('#theory-structure').selectOption(target);
    assert.deepEqual(await savedDraft(page), before, 'An incompatible structure change is atomic');
    assert.equal(await page.locator('#theory-structure').inputValue(), before.structure);
    await localError(page, page.locator('#theory-structure'));
  };

  await load(make('Empty PRO', 'PRO', 2, [], [], []));
  await openPicker(page, insert(page, 'r1', 0, 0));
  assert.equal(await picker(page).locator('[data-picker-generator^="$"]').count(), 0);
  await page.keyboard.press('Escape');
  await page.locator('#theory-structure').selectOption('PROP');
  await addAt(page, insert(page, 'r1', 0, 0), '$swap');
  const swap = (await ops())[0];
  await addAt(page, insert(page, 'r1', 0, 0), '$swap');
  assert.equal((await ops()).find(operation => operation.id === swap.id).column, 1);
  const movedSwap = (await ops())[0];
  await chip(page, movedSwap.id).dragTo(insert(page, 'r1', 0, 0, 'right'));
  assert.equal((await ops('right'))[0].id, movedSwap.id);
  await chip(page, movedSwap.id).click();
  await side(page, 'r1', 'right').locator('[data-action="delete-selection"]').click();
  assert.equal((await ops('right')).length, 0);
  await page.locator('#undo-theory').click();
  assert.equal((await ops('right'))[0].id, movedSwap.id);
  await page.locator('#redo-theory').click();
  assert.equal((await ops('right')).length, 0);
  await rejectMode('PRO');
  const swapSource = await saveDraft(page, 'prop-swaps');
  await page.locator('#new-theory').click();
  await openDraft(page, swapSource);
  assert.equal((await ops())[0].generator, '$swap');
  assert.equal((await savedDraft(page)).generators.length, 0);
  report.checks.push('PROP built-in swaps add/insert/drag/delete with stable IDs, undo/files, and atomic downgrade rejection');

  const parity = make('Structural parity', 'PROP', 2, [gate('o1', '$swap', 0, 0)], [], []);
  parity.rules[0].name = 'Swap versus identity';
  parity.rules.push({ id: 'r2', name: 'Swap squared', wires: 2, left: [gate('o2', '$swap', 0, 0), gate('o3', '$swap', 0, 1)], right: [] });
  await load(parity);
  assert.equal(await page.locator('#run-search').isEnabled(), true, 'A pure structural PROP theory needs no named generator');
  await page.locator('#search-timeout').selectOption('10');
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/minimality' && response.request().method() === 'POST');
  await page.locator('#run-search').click();
  const response = await pending;
  assert.equal(response.status(), 200, response.status() === 200 ? undefined : await response.text());
  assert.deepEqual(response.request().postDataJSON().theory.generators, {});
  assert.deepEqual(response.request().postDataJSON().theory.equations[0].lhs.ops, [{ perm: [1, 0] }]);
  await page.waitForFunction(() => !document.getElementById('run-search').hasAttribute('data-running'), null, { timeout: 90000 });
  assert.equal(await page.locator('#search-summary').innerText(), '1 / 2 certified independent');
  assert.equal(await page.locator('.result-row').nth(0).getAttribute('data-state'), 'found');
  assert.equal(await page.locator('.result-row').nth(1).getAttribute('data-state'), 'unresolved');
  await page.locator('.result-row').nth(0).locator('summary').click();
  assert.match(await page.locator('.result-row').nth(0).innerText(), /Swap parity/);
  assert.equal(await page.locator('#search-error').isVisible(), false);
  await audit(page, 'PROP real structural parity results');
  report.checks.push('real zero-generator PROP search finds Swap parity; swap squared remains unresolved');

  await load(make('Two braid directions', 'Braided', 2, [], [], []));
  await addAt(page, insert(page, 'r1', 0, 0), '$braid');
  await addAt(page, insert(page, 'r1', 0, 1), '$braid-inverse');
  const braids = await savedDraft(page);
  assert.deepEqual(braids.rules[0].left.map(operation => operation.generator), ['$braid', '$braid-inverse']);
  const crossings = await side(page, 'r1').locator('.structural-gate path[stroke-width="8"]').evaluateAll(paths => paths.map(path => path.getAttribute('d')));
  assert.equal(crossings.length, 2);
  assert.notEqual(crossings[0], crossings[1], 'The two braid crossings have different over-strands');
  assert.equal(await page.locator('#run-search').isDisabled(), true);
  await rejectMode('PROP');
  const braidSource = await saveDraft(page, 'braids');
  await page.locator('#new-theory').click();
  await openDraft(page, braidSource);
  await page.screenshot({ path: join(output, 'braids-desktop.png'), fullPage: true });
  await audit(page, 'braid directions');
  report.checks.push('Braided offers distinct braid/inverse crossings, persists them, and disables unsupported search');

  await load(make('Whole controlled circuit', 'Controlled PROP', 3, [gate('o1', 'g1', 1, 0), gate('o2', 'g2', 1, 1)], [gate('o3', 'g1', 1, 0)]));
  assert.equal(await controlButton(page, 'r1', 'right').isEnabled(), true);
  await controlAt(page, 'r1', 0);
  assert.deepEqual((await ops()).map(operation => operation.controls), [[{ wire: 0, value: 1 }], [{ wire: 0, value: 1 }]]);
  assert.equal((await ops('right'))[0].controls, undefined);
  await controlAt(page, 'r1', 0, { side: 'right' });
  assert.deepEqual((await ops('right'))[0].controls, [{ wire: 0, value: 1 }], 'The right-side action controls its own circuit');
  await controlAt(page, 'r1', 'below');
  await controlAt(page, 'r1', 'above');
  const controlled = await savedDraft(page);
  assert.equal(controlled.rules[0].wires, 5);
  assert.deepEqual(controlled.rules[0].left[0].controls, [{ wire: 0, value: 1 }, { wire: 4, value: 1 }, { wire: 1, value: 1 }]);
  assert.equal(controlled.rules[0].left[0].wire, 2);
  assert.equal(controlled.rules[0].right[0].wire, 2, 'Inserting a wire translates both equation sides');
  assert.deepEqual(controlled.rules[0].right[0].controls, [{ wire: 1, value: 1 }]);
  await chip(page, 'o1').click();
  await controlButton(page, 'r1').click();
  await picker(page).locator('[data-action="remove-controls"]').click();
  assert.equal((await ops())[0].controls, undefined);
  assert.equal((await ops())[1].controls.length, 3);
  await page.locator('#undo-theory').click();
  assert.deepEqual(await savedDraft(page), controlled);
  await rejectMode('PROP');
  await page.screenshot({ path: join(output, 'controlled-desktop.png'), fullPage: true });
  await audit(page, 'whole controlled circuit with nested controls');
  report.checks.push('whole-side controls, existing/above/below wires, repeated nesting, selective removal, and undo');

  await load(make('Selected controlled body', 'Controlled PROP', 3, [gate('o1', 'g1', 1, 0), gate('o2', 'g2', 1, 1), gate('o3', 'g1', 2, 2)]));
  await chip(page, 'o1').click();
  await chip(page, 'o2').click();
  assert.equal(await side(page, 'r1').locator('.placed-gate[data-selected]').count(), 2);
  await controlAt(page, 'r1', 0);
  assert.deepEqual((await ops()).map(operation => operation.controls), [[{ wire: 0, value: 1 }], [{ wire: 0, value: 1 }], undefined]);
  await chip(page, 'o1').click();
  await page.keyboard.press('Escape');
  assert.equal(await side(page, 'r1').locator('.placed-gate[data-selected]').count(), 0);
  await load(make('Reject an open body', 'Controlled PROP', 2, [gate('o1', 'g1', 1, 0), gate('o2', 'g1', 1, 1), gate('o3', 'g2', 1, 2)]));
  await chip(page, 'o1').click();
  await chip(page, 'o3').click();
  const beforeOpenBody = await savedDraft(page);
  await controlButton(page, 'r1').click();
  assert.equal(await picker(page).locator('[data-control-wire]:enabled').count(), 0);
  await page.keyboard.press('Escape');
  assert.deepEqual(await savedDraft(page), beforeOpenBody);
  report.checks.push('tap multi-selection controls only its closed body; Escape clears; non-closed selections cannot mutate');

  await load(make('Translate controlled gate', 'Controlled PROP', 4, [gate('o1', 'g1', 1, 0, [{ wire: 0, value: 1 }])], [gate('o2', 'g2', 3, 0)]));
  await chip(page, 'o1').dragTo(insert(page, 'r1', 2, 1));
  assert.deepEqual((await ops())[0], gate('o1', 'g1', 2, 0, [{ wire: 1, value: 1 }]));
  await chip(page, 'o1').dragTo(cell(page, 'r1', 1, 0, 'right'));
  assert.deepEqual((await ops('right')).find(operation => operation.id === 'o1'), gate('o1', 'g1', 1, 0, [{ wire: 0, value: 1 }]));
  await page.locator('#undo-theory').click();
  assert.deepEqual((await ops())[0].controls, [{ wire: 1, value: 1 }]);
  report.checks.push('dragging controlled gates translates control wires and preserves IDs across sides');

  await load(make('Controlled scalar', 'Controlled PROP', 0, [gate('o1', 'g1', 0, 0)], [], [{ id: 'g1', name: 's', arity: 0 }]));
  await controlAt(page, 'r1', 'above');
  const scalar = await savedDraft(page);
  assert.equal(scalar.rules[0].wires, 1);
  assert.deepEqual(scalar.rules[0].left[0].controls, [{ wire: 0, value: 1 }]);
  assert.equal(scalar.rules[0].left[0].wire, 0);
  assert.equal(await side(page, 'r1').locator('.control-wires circle').count(), 1);
  await audit(page, 'controlled scalar');

  await load(make('Ordered control values', 'Polycontrolled PROP', 3, [gate('o1', 'g1', 2, 0)]));
  for (const value of [2, 3, 4, 5, 6]) {
    await page.locator('#control-values').selectOption(String(value));
    assert.equal((await savedDraft(page)).controlValues, value);
  }
  await page.locator('#control-values').selectOption('4');
  await controlAt(page, 'r1', 0, { value: 0 });
  await controlAt(page, 'r1', 1, { value: 2 });
  const poly = await savedDraft(page);
  assert.deepEqual(poly.rules[0].left[0].controls, [{ wire: 1, value: 2 }, { wire: 0, value: 0 }]);
  assert.deepEqual(await side(page, 'r1').locator('.control-wires text').allTextContents(), ['2', '0']);
  assert.match(await chip(page, 'o1').getAttribute('aria-label'), /outer to inner: value 2 on wire 2; value 0 on wire 1/);
  await rejectMode('Controlled PROP');
  const beforeValues = await savedDraft(page);
  await page.locator('#control-values').selectOption('2');
  assert.deepEqual(await savedDraft(page), beforeValues);
  assert.equal(await page.locator('#control-values').inputValue(), '4');
  const forwardSVG = await side(page, 'r1').locator('.control-wires').innerHTML();
  const reversed = structuredClone(poly);
  reversed.name = 'Reversed nesting';
  reversed.rules[0].left[0].controls.reverse();
  await load(reversed);
  assert.deepEqual((await ops())[0].controls, [{ wire: 0, value: 0 }, { wire: 1, value: 2 }]);
  assert.notEqual(await side(page, 'r1').locator('.control-wires').innerHTML(), forwardSVG);
  await load(poly);
  const polySource = await saveDraft(page, 'ordered-controls');
  await page.reload();
  await page.locator('#theory-structure').waitFor();
  assert.deepEqual(await savedDraft(page), parseDraft(polySource));
  await page.screenshot({ path: join(output, 'polycontrolled-desktop.png'), fullPage: true });
  await audit(page, 'polycontrolled ordered values');
  report.checks.push('polycontrol arity2–6, visible values, ordered nesting, persistence, and invalid downgrade/value-count rejection');

  const valueAware = make('Value-aware parallel choices', 'Polycontrolled PROP', 3,
    [gate('o1', 'g1', 1, 0), gate('o2', 'g2', 2, 0, [{ wire: 0, value: 0 }])]);
  valueAware.controlValues = 3;
  await load(valueAware);
  await chip(page, 'o1').click();
  await controlButton(page, 'r1').click();
  assert.equal(await controlChoice(page, 0).isDisabled(), true);
  await page.locator('#control-value').selectOption('0');
  assert.equal(await controlChoice(page, 0).isEnabled(), true);
  await page.locator('#control-value').selectOption('1');
  assert.equal(await controlChoice(page, 0).isDisabled(), true);
  await page.locator('#control-value').selectOption('0');
  await controlChoice(page, 0).click();
  assert.deepEqual((await ops()).map(operation => operation.controls), [[{ wire: 0, value: 0 }], [{ wire: 0, value: 0 }]]);
  report.checks.push('control wire choices revalidate when selected values change against parallel ordered contexts');
  return { controlled, poly, scalar, braids };
}

async function mobileModes(page, fixtures) {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 780 });
    for (const [kind, draft] of [['controlled', fixtures.controlled], ['polycontrolled', fixtures.poly], ['braids', fixtures.braids], ['scalar-control', fixtures.scalar]]) {
      await openDraft(page, serializeDraft(draft));
      await fits(page, `${kind} ${width}px`);
      await page.screenshot({ path: join(output, `${kind}-mobile${width}.png`), fullPage: true });
      await audit(page, `${kind} ${width}px`);
    }
    await openDraft(page, serializeDraft(fixtures.poly));
    await controlButton(page, 'r1').tap();
    await pickerFits(page);
    await page.locator('#control-value').selectOption('3');
    await picker(page).waitFor({ state: 'visible' });
    await page.screenshot({ path: join(output, `control-picker-mobile${width}.png`) });
    await audit(page, `control picker ${width}px`);
    await page.keyboard.press('Escape');
    await picker(page).waitFor({ state: 'hidden' });
    await openDraft(page, serializeDraft(fixtures.controlled));
    await chip(page, 'o1').tap();
    await chip(page, 'o2').tap();
    assert.equal(await side(page, 'r1').locator('.placed-gate[data-selected]').count(), 2);
    await controlAt(page, 'r1', 'above', { touch: true });
    const touched = await savedDraft(page);
    assert.equal(touched.rules[0].wires, 6);
    assert.equal(touched.rules[0].left.every(operation => operation.controls.length === 4), true);
    await page.locator('#undo-theory').tap();
    assert.deepEqual(await savedDraft(page), fixtures.controlled, 'Touch multi-selection wraps in one undoable action');
  }
  report.checks.push('controlled/braided/scalar and value-picker layouts, touch and axe at390px/320px');
}

async function compactSide(page, id, value = 'left') {
  const operations = (await savedDraft(page)).rules.find(rule => rule.id === id)[value];
  const columns = [...new Set(operations.map(operation => operation.column))].sort((a, b) => a - b);
  assert.deepEqual(columns, columns.map((_, index) => index), 'Deleting or moving gates leaves compact stored columns');
  const layout = await side(page, id, value).locator('.circuit-grid').evaluate(grid => ({
    tracks: getComputedStyle(grid).gridTemplateColumns.split(/\s+/).map(Number.parseFloat),
    width: grid.getBoundingClientRect().width,
    boundaries: [...new Set([...grid.querySelectorAll('.insert-slot')].map(slot => Number(slot.dataset.boundary)))].sort((a, b) => a - b),
  }));
  assert.deepEqual(layout.boundaries, Array.from({ length: columns.length + 1 }, (_, index) => index), 'There is one leading, between and trailing insertion boundary');
  const expected = columns.length ? Array.from({ length: columns.length * 2 + 1 }, (_, index) => index % 2 ? 48 : 32) : [48];
  assert.equal(layout.tracks.length, expected.length, 'The side has exactly its content and insertion tracks');
  layout.tracks.forEach((track, index) => assert.ok(Math.abs(track - expected[index]) <= 1, 'Content tracks are48px and insertion gaps32px'));
  assert.ok(Math.abs(layout.width - expected.reduce((sum, track) => sum + track, 0)) <= 1, 'Diagrams fit their content');
}

async function fitButtons(page) {
  const controls = await page.locator('#add-generator, #add-shortcut, #add-rule, #run-search').evaluateAll(buttons => buttons.map(button => {
    const style = getComputedStyle(button), text = document.createRange();
    text.selectNodeContents(button);
    return { id: button.id, width: button.getBoundingClientRect().width,
      expected: text.getBoundingClientRect().width + Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)
        + Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.borderRightWidth) };
  }));
  for (const control of controls) assert.ok(Math.abs(control.width - control.expected) <= 3, `${control.id} fits its text: ${JSON.stringify(control)}`);
}

async function fits(page, label) {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  assert.ok(dimensions.document <= dimensions.viewport + 1, `${label}: document does not overflow horizontally: ${JSON.stringify(dimensions)}`);
  report.checks.push(`${label}: fits viewport`);
}
async function bounded(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} did not finish within ${milliseconds / 1000}s.`)), milliseconds);
    })]);
  } finally {
    clearTimeout(timer);
  }
}
async function audit(page, label, scope) {
  if (!axeSource) return;
  console.log(`Accessibility audit: ${label}`);
  await bounded(page.evaluate(axeSource), 15_000, `Load axe for ${label}`);
  const result = await bounded(page.evaluate(scope => window.axe.run(scope ? { include: scope.map(selector => [selector]) } : document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] },
  }), scope), 30_000, `Axe audit for ${label}`);
  report.accessibility.push({ label, scope: scope ?? 'document', passedRules: result.passes.length, violations: result.violations.map(({ id, impact, help, nodes }) => ({
    id, impact, help, targets: nodes.map(node => node.target), explanations: nodes.map(node => node.failureSummary),
  })) });
}

async function ergonomics(page, touch = false) {
  const profile = touch ? 'touch' : 'mouse';
  const activate = target => target[touch ? 'tap' : 'click']();
  const selected = () => page.locator('.placed-gate[data-selected]').count();
  const disclosure = page.locator('#shortcut-editors');
  const visibleInViewport = async (target, label) => {
    const bounds = await target.boundingBox(), viewport = page.viewportSize();
    assert.ok(bounds && bounds.y >= -1 && bounds.x >= -1 && bounds.y + bounds.height <= viewport.height + 1
      && bounds.x + bounds.width <= viewport.width + 1, `${label} stays reachable: ${JSON.stringify(bounds)}`);
  };

  await page.waitForFunction(() => !document.getElementById('theory-zoo').disabled && document.getElementById('theory-zoo').getAttribute('aria-busy') === 'false');
  await page.locator('#theory-zoo').selectOption('clifford_t');
  const clifford = await savedDraft(page);
  assert.equal(clifford.shortcuts.length, 12);
  assert.equal(await disclosure.evaluate(element => element.open), false, 'Existing shortcut definitions start collapsed');
  assert.equal(await page.locator('#shortcut-list').isVisible(), false);
  const equationsTop = await page.locator('#rules-heading').evaluate(element => element.getBoundingClientRect().top + scrollY);
  (report.ergonomics ??= []).push({ profile, width: page.viewportSize().width, equationsTop,
    toolbarHeight: await page.locator('.minimality-heading').evaluate(element => element.getBoundingClientRect().height) });
  if (touch) assert.ok(equationsTop < 2000, `The mobile equations no longer follow twelve expanded editors (${equationsTop}px)`);
  await activate(disclosure.locator(':scope > summary'));
  assert.equal(await page.locator('#shortcut-list').isVisible(), true);
  if (touch) assert.ok(await page.locator('#rules-heading').evaluate(element => element.getBoundingClientRect().top + scrollY) > equationsTop + 1000);
  const shortcutName = rule(page, clifford.shortcuts[0].id).locator('[data-field="shortcut-name"]');
  await shortcutName.fill('AUX');
  await shortcutName.press('Tab');
  assert.equal(await disclosure.evaluate(element => element.open), true, 'Editing preserves the open shortcut disclosure');
  await activate(disclosure.locator(':scope > summary'));
  await rule(page, clifford.rules.at(-1).id).scrollIntoViewIfNeeded();
  for (const id of ['save-theory', 'undo-theory', 'run-search', 'search-timeout']) await visibleInViewport(page.locator(`#${id}`), `${profile} ${id}`);
  assert.equal(await page.locator('#run-search').count(), 1, 'Run remains a single control');
  assert.equal(await page.locator('.minimality-search').isVisible(), false, 'An unused results panel does not leave an empty card');
  await page.screenshot({ path: join(output, `${profile}-ergonomics-toolbar.png`) });
  await fits(page, `${profile} compact Clifford+T`);
  report.checks.push(`${profile}: compact existing shortcuts, preserved disclosure state, mobile equation reach and sticky document/search controls`);

  await loadExample(page);
  const original = await savedDraft(page), name = generator(page, 'g1').locator('[data-field="generator-name"]');
  await name.fill('ABCDE');
  await name.press('Tab');
  const error = await localError(page, name, /must render as 1–4/);
  assert.deepEqual(await savedDraft(page), original, 'Invalid names leave the complete presentation intact');
  assert.equal(await name.evaluate(element => element === document.activeElement), true, 'Rejected edits retain input focus');
  const distance = await error.evaluate((element, field) => Math.abs(element.getBoundingClientRect().top - document.querySelector(field).getBoundingClientRect().bottom), '[data-generator-id="g1"] [data-field="generator-name"]');
  assert.ok(distance < 150, 'Name validation appears beside its own row');
  await name.fill('Had');
  await name.press('Tab');
  assert.notEqual(await name.getAttribute('aria-invalid'), 'true', 'A valid correction clears the field error');
  await activate(generator(page, 'g1').locator('[data-action="remove-generator"]'));
  assert.equal(await generator(page, 'g1').locator('.inline-message').isVisible(), true, 'Blocked deletion explains itself beside the generator');
  const wires = rule(page, 'r1').locator('[data-field="rule-wires"]');
  await wires.selectOption('0');
  await localError(page, wires);
  assert.equal(await wires.evaluate(element => element === document.activeElement), true, 'A rejected wire change keeps focus on its selector');
  assert.equal((await savedDraft(page)).rules[0].wires, 1);
  const beforeMalformed = await savedDraft(page);
  await page.locator('#theory-file').setInputFiles({ name: 'malformed.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  const openError = page.locator('.workspace-actions > .inline-message');
  await openError.waitFor({ state: 'visible' });
  assert.ok((await openError.textContent()).trim());
  await visibleInViewport(openError, `${profile} malformed Open error`);
  assert.deepEqual(await savedDraft(page), beforeMalformed, 'Malformed Open leaves the presentation intact');
  report.checks.push(`${profile}: local name, used-delete and wire validation, atomic edits, focus retention and recovery`);

  const draft = { version: 1, name: `Ergonomics ${profile}`, structure: 'PRO', controlValues: 2,
    generators: [{ id: 'h', name: 'H', arity: 1 }, { id: 'pair', name: 'Pair', arity: 2 }],
    shortcuts: [{ id: 's1', name: 'X', wires: 1, left: [{ id: 'sx', generator: 'h', wire: 0, column: 0 }], right: [] }],
    rules: [{ id: 'r1', name: 'Equation', wires: 3,
      left: [{ id: 'a', generator: 'h', wire: 1, column: 0 }, { id: 'b', generator: 'h', wire: 1, column: 1 }],
      right: [{ id: 'c', generator: 'h', wire: 1, column: 0 }] }],
  };
  await openDraft(page, serializeDraft(draft), { expand: false });
  await activate(page.locator('#add-shortcut'));
  assert.equal(await disclosure.evaluate(element => element.open), true, 'Adding a shortcut immediately reveals its editor');
  const added = (await savedDraft(page)).shortcuts.at(-1);
  assert.equal(await rule(page, added.id).isVisible(), true);
  const addedName = rule(page, added.id).locator('[data-field="shortcut-name"]');
  await addedName.fill('X');
  await addedName.press('Tab');
  await localError(page, addedName, /unique/);
  assert.equal(await disclosure.evaluate(element => element.open), true, 'Shortcut validation stays visible');
  report.checks.push(`${profile}: new shortcuts open directly and duplicate names have local explanations`);

  for (const structure of ['PRO', 'PROP', 'Braided', 'Controlled PROP', 'Polycontrolled PROP']) {
    await openDraft(page, serializeDraft({ ...draft, structure }), { expand: false });
    await activate(chip(page, 'a'));
    assert.equal(await selected(), 1);
    await activate(chip(page, 'a'));
    assert.equal(await selected(), 0, `${structure}: the same gate toggles off`);
    await activate(chip(page, 'a'));
    await activate(chip(page, 'b'));
    assert.equal(await selected(), 2, `${structure}: successive gates select together`);
    const diagram = rule(page, 'r1').locator('.equation-diagrams'), bounds = await diagram.boundingBox();
    await diagram[touch ? 'tap' : 'click']({ position: { x: bounds.width - 16, y: 35 } });
    assert.equal(await selected(), 0, `${structure}: blank circuit space clears selection`);
    await activate(chip(page, 'a'));
    await activate(chip(page, 'b'));
    await activate(chip(page, 'c'));
    assert.equal(await selected(), 1, `${structure}: changing equation side resets the previous selection`);
    await page.keyboard.press('Escape');
    assert.equal(await selected(), 0);
  }
  report.checks.push(`${profile}: consistent gate toggling, additive same-side selection and Escape across all categorical structures`);

  await openDraft(page, serializeDraft({ ...draft, structure: 'Controlled PROP' }), { expand: false });
  const control = controlButton(page, 'r1');
  assert.equal(await control.textContent(), 'Control circuit…');
  await activate(chip(page, 'a'));
  await activate(chip(page, 'b'));
  assert.equal(await control.textContent(), 'Control selected (2)…');
  await activate(control);
  assert.equal(await controlChoice(page, 1).locator('.picker-reason').isVisible(), true, 'An unavailable control wire explains itself without hover');
  assert.equal(await controlChoice(page, 1).getAttribute('aria-description'), await controlChoice(page, 1).locator('.picker-reason').textContent(), 'The disabled choice exposes the same explanation to assistive technology');
  await controlChoice(page, 0).focus();
  const previewWires = () => side(page, 'r1').locator('.circuit-slot[data-placement]').evaluateAll(slots => [...new Set(slots.map(slot => Number(slot.dataset.wire)))].sort());
  assert.deepEqual(await previewWires(), [0], 'Control preview identifies the new control wire');
  assert.equal(await side(page, 'r1').locator('.placed-gate[data-preview]').count(), 2, 'Control preview highlights the complete selected body');
  await page.screenshot({ path: join(output, `${profile}-ergonomics-control-preview.png`) });
  await page.keyboard.press('Escape');
  assert.equal(await side(page, 'r1').locator('[data-placement]').count(), 0, 'Closing the picker clears its preview');
  assert.deepEqual(await savedDraft(page), { ...draft, structure: 'Controlled PROP' }, 'Previewing controls does not edit the circuit');

  if (!touch) {
    const target = insert(page, 'r1', 0, 1);
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    await generator(page, 'pair').locator('.generator-drag').dispatchEvent('dragstart', { dataTransfer });
    await target.dispatchEvent('dragover', { dataTransfer });
    assert.deepEqual(await previewWires(), [0, 1], 'Dragging a two-wire gate previews both affected wires');
    assert.equal(await side(page, 'r1').locator('.circuit-grid[data-insert-preview]').count(), 1, 'Insertion previews indicate the shift boundary');
    await page.screenshot({ path: join(output, 'mouse-ergonomics-drag-preview.png') });
    await generator(page, 'pair').locator('.generator-drag').dispatchEvent('dragend');
    await dataTransfer.dispose();
    assert.equal(await side(page, 'r1').locator('[data-placement]').count(), 0);
    assert.equal(await side(page, 'r1').locator('.circuit-grid[data-insert-preview]').count(), 0);
    const controlledMove = { ...draft, structure: 'Controlled PROP', rules: [{ ...draft.rules[0], wires: 4,
      left: [{ id: 'a', generator: 'h', wire: 1, column: 0, controls: [{ wire: 0, value: 1 }] }] }] };
    await openDraft(page, serializeDraft(controlledMove), { expand: false });
    const moveTransfer = await page.evaluateHandle(() => new DataTransfer());
    await chip(page, 'a').dispatchEvent('dragstart', { dataTransfer: moveTransfer });
    await insert(page, 'r1', 2, 1).dispatchEvent('dragover', { dataTransfer: moveTransfer });
    assert.deepEqual(await previewWires(), [1, 2], 'Moving a controlled gate previews its translated body and control wires');
    await chip(page, 'a').dispatchEvent('dragend');
    await moveTransfer.dispose();
    assert.deepEqual(await savedDraft(page), controlledMove, 'Cancelling the translated preview leaves the controlled gate untouched');
    const scalarMove = { ...controlledMove, generators: [...draft.generators, { id: 'omega', name: 'omega', arity: 0 }],
      rules: [{ ...controlledMove.rules[0], left: [{ id: 'phase', generator: 'omega', wire: 0, column: 0, controls: [{ wire: 0, value: 1 }] }], right: [] }] };
    await openDraft(page, serializeDraft(scalarMove), { expand: false });
    const scalarTransfer = await page.evaluateHandle(() => new DataTransfer());
    await chip(page, 'phase').dispatchEvent('dragstart', { dataTransfer: scalarTransfer });
    await insert(page, 'r1', 2, 1).dispatchEvent('dragover', { dataTransfer: scalarTransfer });
    assert.deepEqual(await previewWires(), [0], 'Moving a controlled scalar from a body-wire insertion point preserves its control-wire preview');
    await chip(page, 'phase').dispatchEvent('dragend');
    await scalarTransfer.dispose();
    assert.deepEqual(await savedDraft(page), scalarMove, 'Cancelling a scalar preview preserves the complete circuit');
    await openDraft(page, serializeDraft({ ...draft, structure: 'Controlled PROP' }), { expand: false });
  }
  report.checks.push(`${profile}: clear circuit/selection control labels, complete control-wire preview and cancelled-preview cleanup${touch ? '' : ', full two-wire drag footprint and shift marker'}`);

  await page.keyboard.press('Escape');
  const grid = side(page, 'r1').locator('.circuit-grid');
  const stops = grid.locator('button[tabindex="0"]');
  assert.equal(await stops.count(), 1, 'Each circuit has one Tab stop');
  await insert(page, 'r1', 1, 0).focus();
  const beforeArrow = await page.evaluate(() => document.activeElement.dataset.focusKey);
  await page.keyboard.down('ArrowRight');
  assert.notEqual(await page.evaluate(() => document.activeElement.dataset.focusKey), beforeArrow, 'ArrowRight moves to the next circuit position');
  const firstMove = await page.evaluate(() => ({ key: document.activeElement.dataset.focusKey, scrollY }));
  await page.keyboard.down('ArrowRight');
  assert.notEqual(await page.evaluate(() => document.activeElement.dataset.focusKey), firstMove.key, 'Holding an arrow continues through circuit positions');
  assert.equal(await page.evaluate(() => scrollY), firstMove.scrollY, 'A repeated navigation key does not scroll the page');
  await page.keyboard.up('ArrowRight');
  assert.equal(await grid.evaluate(element => element.contains(document.activeElement)), true);
  assert.equal(await stops.count(), 1, 'Arrow navigation retains exactly one Tab stop');
  await page.keyboard.press('ArrowDown');
  assert.equal(await grid.evaluate(element => element.contains(document.activeElement)), true);
  await page.keyboard.press('Tab');
  assert.equal(await grid.evaluate(element => element.contains(document.activeElement)), false, 'Tab exits the circuit rather than visiting every insertion point');
  await insert(page, 'r1', 0, 0).focus();
  await page.keyboard.press('Enter');
  await picker(page).waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  assert.equal(await insert(page, 'r1', 0, 0).evaluate(element => element === document.activeElement), true, 'Keyboard menu dismissal returns to its circuit position');
  report.checks.push(`${profile}: one Tab stop per circuit, arrow movement, Tab exit and Enter/Escape insertion menus`);

  await page.locator('#theory-structure').selectOption('Braided');
  assert.equal(await page.locator('#run-search').isDisabled(), true);
  assert.equal(await page.locator('#search-availability').isVisible(), true, 'Unsupported search has an explanation usable on touch');
  assert.match(await page.locator('#search-availability').textContent(), /braid|support|available/i);
  const unavailable = page.locator('#zoo-unavailable');
  assert.equal(await unavailable.isVisible(), true);
  await activate(unavailable.locator(':scope > summary'));
  assert.ok(await unavailable.locator('dt').count() > 0, 'Unavailable zoo names have visible reasons');
  assert.equal(await unavailable.locator('dt').count(), await unavailable.locator('dd').count());
  for (const reason of await unavailable.locator('dd').allTextContents()) assert.ok(reason.trim());
  await activate(page.locator('#see-references'));
  const dialog = page.locator('#theory-references-dialog');
  await dialog.waitFor({ state: 'visible' });
  await dialog.locator('dd').last().scrollIntoViewIfNeeded();
  await visibleInViewport(dialog.locator('[data-modal-close]'), `${profile} reference Close`);
  await activate(dialog.locator('[data-modal-close]'));
  await fits(page, `${profile} upgraded editor`);
  await audit(page, `${profile} ergonomics`);
  report.checks.push(`${profile}: touch-readable unavailable zoo/search reasons and always-reachable reference Close`);
}

async function searchErgonomics(page) {
  await loadExample(page);
  const draft = await savedDraft(page);
  draft.rules.push({ id: 'r4', name: 'Identity', wires: 1, left: [], right: [] });
  await openDraft(page, serializeDraft(draft));
  await page.locator('#search-timeout').selectOption('10');
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const hold = async route => { await held; await route.continue(); };
  await page.route('**/api/minimality', hold);
  const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/minimality' && response.request().method() === 'POST');
  try {
    await page.locator('#run-search').click();
    await page.waitForFunction(() => document.getElementById('run-search').hasAttribute('data-running'));
    assert.equal(await page.locator('.minimality-search').isVisible(), true, 'Search results become visible when a run begins');
    const heading = await page.locator('#search-heading').boundingBox(), toolbar = await page.locator('.minimality-heading').boundingBox();
    assert.ok(heading.y >= toolbar.y + toolbar.height - 1 && heading.y + heading.height < page.viewportSize().height,
      `Starting from the toolbar brings live results into view below it: ${JSON.stringify({ heading, toolbar })}`);
    assert.equal(await page.locator('#run-search').evaluate(element => element === document.activeElement), true, 'The running Stop control keeps keyboard focus while results scroll into view');
    assert.equal(await page.locator('#add-generator').isDisabled(), true, 'Search locks editing');
    assert.equal(await page.locator('#save-theory').isEnabled(), true, 'Search keeps Save usable');
    assert.equal(await page.locator('#see-references').isEnabled(), true, 'Search keeps references usable');
    await saveDraft(page, 'ergonomics-during-search');
    await page.locator('#see-references').click();
    await page.locator('#theory-references-dialog').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    release();
    assert.equal((await response).status(), 200, 'The held request still reaches the real search backend');
    await page.waitForFunction(() => !document.getElementById('run-search').hasAttribute('data-running'), null, { timeout: 90_000 });
    assert.equal(await page.locator('#search-error').isVisible(), false);
    assert.match(await page.locator('#search-summary').textContent(), /3 \/ 4 certified independent/i);
    assert.equal(await page.locator('.result-row[data-state="found"]').count(), 3);
    for (const text of await page.locator('.result-row[data-state="found"] .result-state').allTextContents()) assert.match(text, /^Certified independent$/);
    assert.match(await page.locator('.result-row[data-state="unresolved"] .result-state').textContent(), /^No witness (?:within time limit|found)$/);
    await page.screenshot({ path: join(output, 'desktop-ergonomics-results.png') });
    report.checks.push('real search: Save/references remain usable while editing is locked, certified results and a witness-free identity have precise labels');
  } finally {
    release();
    await page.unroute('**/api/minimality', hold);
  }
}

async function openDraft(page, source, { expand = true } = {}) {
  await page.locator('#theory-file').setInputFiles({ name: 'browser-test.minimality.json', mimeType: 'application/json', buffer: Buffer.from(source) });
  const expected = parseDraft(source);
  await page.waitForFunction(({ name, source }) => document.getElementById('theory-name').value === name &&
    localStorage.getItem('minimality-theory-v1') === source, { name: expected.name, source: serializeDraft(expected) });
  assert.deepEqual(await savedDraft(page), expected, 'Open restores the complete editor draft');
  if (expand) await expandShortcuts(page);
}
async function saveDraft(page, name) {
  const pending = page.waitForEvent('download');
  await page.locator('#save-theory').click();
  const download = await pending;
  assert.match(download.suggestedFilename(), /\.minimality\.json$/);
  const source = await readFile(await download.path(), 'utf8');
  assert.deepEqual(parseDraft(source), await savedDraft(page), 'Save contains exactly the persisted editable draft');
  await writeFile(join(output, `${name}.json`), source);
  return source;
}

async function staleFileReads(page, olderSource, currentSource) {
  await page.evaluate(() => {
    const original = File.prototype.text;
    window.minimalityDelayedRead = { original, ready: false };
    File.prototype.text = function () {
      if (this.name !== 'delayed.minimality.json') return original.call(this);
      return new Promise(resolve => {
        window.minimalityDelayedRead.release = () => original.call(this).then(resolve);
        window.minimalityDelayedRead.ready = true;
      });
    };
  });
  const begin = async () => {
    await page.locator('#theory-file').setInputFiles({ name: 'delayed.minimality.json', mimeType: 'application/json', buffer: Buffer.from(olderSource) });
    await page.waitForFunction(() => window.minimalityDelayedRead.ready);
  };
  const release = () => page.evaluate(async () => {
    await window.minimalityDelayedRead.release();
    window.minimalityDelayedRead.ready = false;
  });
  try {
    await begin();
    await openDraft(page, currentSource);
    await release();
    assert.deepEqual(await savedDraft(page), parseDraft(currentSource), 'A delayed earlier Open cannot overwrite a newer Open');
    await begin();
    await page.locator('#new-theory').click();
    await release();
    assert.equal(await page.locator('.equation-card').count(), 0, 'A delayed Open cannot replace New');
    assert.equal((await savedDraft(page)).name, 'Untitled theory');
    await openDraft(page, currentSource);
    await begin();
    await page.locator('#theory-name').fill('Newer manual edit');
    await page.locator('#theory-name').press('Tab');
    await release();
    assert.equal((await savedDraft(page)).name, 'Newer manual edit', 'A delayed Open cannot replace a subsequent edit');
    assert.equal(await page.locator('.equation-card').count(), 4);
  } finally {
    await page.evaluate(() => { File.prototype.text = window.minimalityDelayedRead.original; delete window.minimalityDelayedRead; });
  }
  await openDraft(page, currentSource);
  report.checks.push('delayed Open cannot overwrite a newer Open, New or edit');
}

try {
  const context = await browser.newContext({ viewport: { width: 1365, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
  const page = await context.newPage();
  watch(page, 'desktop');
  const response = await page.goto(new URL('/minimality/', base).href);
  assert.equal(response.status(), 200);
  if (process.env.MINIMALITY_ERGONOMICS_ONLY === '1') {
    await ergonomics(page);
    await searchErgonomics(page);
    await context.close();
    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', acceptDownloads: true });
    const mobile = await mobileContext.newPage();
    watch(mobile, 'mobile ergonomics');
    await mobile.goto(new URL('/minimality/', base).href);
    await ergonomics(mobile, true);
    await mobile.setViewportSize({ width: 320, height: 780 });
    await fits(mobile, 'small mobile ergonomics');
    await mobile.screenshot({ path: join(output, 'mobile320-ergonomics.png') });
    await audit(mobile, 'small mobile ergonomics');
    await mobileContext.close();
  } else if (process.env.MINIMALITY_REFERENCES_ONLY === '1') {
    await referenceLibrary(page);
    await context.close();
    const mobileContext = await browser.newContext({ viewport: { width: 320, height: 780 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', acceptDownloads: true });
    const mobile = await mobileContext.newPage();
    watch(mobile, 'mobile references');
    await mobile.goto(new URL('/minimality/', base).href);
    await referenceLibrary(mobile, true);
    await mobileContext.close();
  } else if (process.env.MINIMALITY_PHASES_ONLY === '1') {
    await globalPhases(page);
    await context.close();
    const mobileContext = await browser.newContext({ viewport: { width: 320, height: 780 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', acceptDownloads: true });
    const mobile = await mobileContext.newPage();
    watch(mobile, 'mobile phases');
    await mobile.goto(new URL('/minimality/', base).href);
    await globalPhases(mobile, true);
    await mobileContext.close();
  } else if (process.env.MINIMALITY_ZOO_ONLY === '1') {
    await referenceLibrary(page);
    await gateLabels(page);
    await officialZooShortcuts(page);
    await context.close();
    const mobileContext = await browser.newContext({ viewport: { width: 320, height: 780 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce', acceptDownloads: true });
    const mobile = await mobileContext.newPage();
    watch(mobile, 'mobile zoo');
    await mobile.goto(new URL('/minimality/', base).href);
    await referenceLibrary(mobile, true);
    await gateLabels(mobile, true);
    await officialZooShortcuts(mobile, true);
    await mobileContext.close();
  } else if (process.env.MINIMALITY_MODES_ONLY === '1') {
    const fixtures = await modeChecks(page);
    await context.close();
    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    const mobile = await mobileContext.newPage();
    watch(mobile, 'mobile modes');
    await mobile.goto(new URL('/minimality/', base).href);
    await mobileModes(mobile, fixtures);
    await mobileContext.close();
  } else {
  await page.locator('#add-generator').waitFor();
  assert.equal(await page.locator('.generator-row').count(), 0);
  assert.equal(await page.locator('.equation-card').count(), 0);
  assert.equal(await page.locator('.category-badge').count(), 0, 'The editor has no redundant category label');
  assert.equal(await page.locator('#run-search').isDisabled(), true);
  await fits(page, 'desktop empty');
  await page.screenshot({ path: join(output, 'desktop-empty.png'), fullPage: true });
  report.checks.push('empty editor and disabled Run');

  await page.locator('#add-rule').click();
  const emptyRuleId = await page.locator('.equation-card').getAttribute('data-rule-id');
  const emptyPalette = await savedDraft(page);
  await openPicker(page, insert(page, emptyRuleId, 0, 0));
  assert.equal(await picker(page).locator('[data-picker-generator]').count(), 0, 'A circuit + also opens with no generators defined');
  await page.keyboard.press('Escape');
  assert.deepEqual(await savedDraft(page), emptyPalette, 'An empty picker leaves the equation unchanged');
  await page.locator('#undo-theory').click();
  assert.equal(await page.locator('.equation-card').count(), 0);
  report.checks.push('empty-palette circuit + opens safely');

  await loadExample(page);
  assert.equal(await page.locator('.generator-row').count(), 2);
  assert.equal(await page.locator('.equation-card').count(), 3);
  assert.equal(await page.locator('#run-search').isEnabled(), true);
  await page.locator('#search-timeout').selectOption('30');
  const apiResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/minimality' && response.request().method() === 'POST');
  await page.locator('#run-search').click();
  const search = await apiResponse;
  assert.equal(search.status(), 200, search.status() === 200 ? undefined : await search.text());
  if (await page.locator('#run-search').getAttribute('data-running') !== null) {
    assert.equal(await page.locator('#add-generator').isDisabled(), true, 'Editing is locked while search is running');
  }
  await page.waitForFunction(() => document.getElementById('search-summary').textContent === '3 / 3 certified independent', null, { timeout: 90_000 });
  await page.waitForFunction(() => !document.getElementById('run-search').hasAttribute('data-running'), null, { timeout: 90_000 });
  assert.equal(await page.locator('.result-row[data-state="found"]').count(), 3);
  assert.equal(await page.locator('#search-error').isVisible(), false);
  assert.match(await page.locator('#search-progress').innerText(), /^Finished/);
  assert.match(await page.locator('#search-source').innerText(), /^minimality-auto · /);
  assert.match(search.headers()['content-type'], /application\/(?:x-)?ndjson/);
  assert.equal(search.request().postDataJSON().theory.equations.length, 3, 'The editor sends the entered presentation to the real Python endpoint');
  report.checks.push('real local Python stream: 3 / 3 independent');
  report.search = { status: search.status(), contentType: search.headers()['content-type'],
    source: await page.locator('#search-source').innerText(), summary: await page.locator('#search-summary').innerText() };
  await page.screenshot({ path: join(output, 'desktop-results.png'), fullPage: true });
  await audit(page, 'desktop results');
  const exampleSource = await saveDraft(page, 'example');

  const retainedNodes = await page.evaluateHandle(() => [...document.querySelectorAll('#generator-list *, #rule-list *')]);
  await chooseGenerator(page, 'g2');
  await side(page, 'r1').locator('.gate-chip').first().click();
  assert.equal(await retainedNodes.evaluate(nodes => nodes.every(node => node.isConnected)), true, 'Generator and gate selection retain all editor DOM nodes');
  assert.equal(await retainedNodes.evaluate(nodes => nodes.length), await page.locator('#generator-list *, #rule-list *').count());
  await retainedNodes.dispose();
  report.checks.push('selection preserves existing generator and equation DOM nodes');

  await page.locator('#add-generator').click();
  const generatorId = await page.locator('.generator-row').last().getAttribute('data-generator-id');
  const nameField = generator(page, generatorId).locator('[data-field="generator-name"]');
  await nameField.fill('Pair');
  await nameField.press('Tab');
  await generator(page, generatorId).locator('[data-field="generator-arity"]').selectOption('2');
  await chooseGenerator(page, generatorId);
  await page.locator('#add-rule').click();
  const ruleId = await page.locator('.equation-card').last().getAttribute('data-rule-id');
  await rule(page, ruleId).locator('[data-field="rule-wires"]').selectOption('2');
  const equationName = rule(page, ruleId).locator('[data-field="rule-name"]');
  await equationName.fill('Pair equation');
  await equationName.press('Tab');
  await compactSide(page, ruleId);
  await compactSide(page, ruleId, 'right');
  assert.equal(await side(page, ruleId).locator('.wire-cell').count(), 0, 'An empty diagram has only its one insertion position');
  await pickerBasics(page, ruleId, generatorId);
  await generator(page, generatorId).locator('.generator-drag').dragTo(insert(page, ruleId, 0, 0));
  await side(page, ruleId).locator('.placed-gate').waitFor();
  assert.equal(await side(page, ruleId).locator('.placed-gate').evaluate(gate => getComputedStyle(gate).gridRowEnd), 'span 2');
  let state = await savedDraft(page);
  assert.deepEqual(state.rules.at(-1).left.map(({ generator, wire, column }) => ({ generator, wire, column })), [{ generator: generatorId, wire: 0, column: 0 }]);
  const pairId = state.rules.at(-1).left[0].id;
  await compactSide(page, ruleId);
  await side(page, ruleId).locator('.gate-chip').click();
  await addAt(page, insert(page, ruleId, 0, 1), 'g1');
  state = await savedDraft(page);
  assert.deepEqual(state.rules.at(-1).left.find(operation => operation.id === pairId), { id: pairId, generator: generatorId, wire: 0, column: 0 },
    'Choosing at + adds a new gate while leaving the selected gate in place');
  assert.notEqual(state.rules.at(-1).left.at(-1).id, pairId);
  await addAt(page, insert(page, ruleId, 1, 1), 'g2');
  await addAt(page, insert(page, ruleId, 1, 0), 'g1');
  const ordered = async (value = 'left') => (await savedDraft(page)).rules.at(-1)[value]
    .sort((a, b) => a.column - b.column || a.wire - b.wire);
  assert.deepEqual((await ordered()).map(operation => operation.generator), ['g1', generatorId, 'g2', 'g1'], 'Insertion before, between and after gates shifts their order');
  await compactSide(page, ruleId);
  await side(page, ruleId).locator('.gate-chip').filter({ hasText: /^Pair$/ }).dragTo(insert(page, ruleId, 0, 4));
  assert.deepEqual((await ordered()).map(operation => operation.generator), ['g1', 'g2', 'g1', generatorId], 'A multiwire gate drags from the middle to the end');
  assert.equal((await ordered()).at(-1).id, pairId);
  await compactSide(page, ruleId);
  await side(page, ruleId).locator('.gate-chip').filter({ hasText: /^Pair$/ }).dragTo(insert(page, ruleId, 0, 0));
  assert.equal((await ordered())[0].id, pairId, 'Dragging moves a gate to the leading insertion boundary');
  await side(page, ruleId).locator('.gate-chip').filter({ hasText: /^Pair$/ }).dragTo(insert(page, ruleId, 0, 0, 'right'));
  assert.equal((await ordered('right'))[0].id, pairId, 'Dragging preserves a multiwire gate when changing sides');
  await compactSide(page, ruleId);
  await compactSide(page, ruleId, 'right');
  await addAt(page, insert(page, ruleId, 1, 1, 'right'), 'g1');
  await side(page, ruleId, 'right').locator('.gate-chip').filter({ hasText: /^Pair$/ }).dragTo(insert(page, ruleId, 0, 2, 'right'));
  assert.deepEqual((await ordered('right')).map(operation => operation.generator), ['g1', generatorId], 'Right-side insertion and drag reorder use the same behavior');
  await compactSide(page, ruleId, 'right');
  await side(page, ruleId, 'right').locator('.gate-chip').filter({ hasText: /^Pair$/ }).dragTo(insert(page, ruleId, 0, 1));
  assert.equal((await ordered())[1].id, pairId, 'A multiwire gate can move back between existing gates');
  await side(page, ruleId, 'right').locator('.gate-chip').click();
  await side(page, ruleId, 'right').locator('[data-action="delete-selection"]').click();
  await compactSide(page, ruleId);
  await compactSide(page, ruleId, 'right');
  report.checks.push('compact identity diagrams; chosen before/between/after additions; selected gates stay in place; multiwire drag reordering across sides');

  await addAt(page, cell(page, ruleId, 0, 0), 'g1');
  assert.equal((await ordered()).filter(operation => operation.column === 0).length, 2, 'Free cells retain parallel placement');
  state = await savedDraft(page);
  await openPicker(page, cell(page, ruleId, 0, 2));
  assert.equal(await pickerChoice(page, 'g1').isEnabled(), true);
  assert.equal(await pickerChoice(page, generatorId).isDisabled(), true, 'An overlapping multiwire choice is disabled');
  await page.keyboard.press('Escape');
  assert.deepEqual(await savedDraft(page), state, 'An invalid choice does not change saved state');
  const withPair = state.rules.at(-1).left.length, withoutPair = withPair - 1;
  await side(page, ruleId).locator('.gate-chip').filter({ hasText: /^Pair$/ }).click();
  await side(page, ruleId).locator('[data-action="delete-selection"]').click();
  assert.equal((await savedDraft(page)).rules.at(-1).left.length, withoutPair);
  await compactSide(page, ruleId);
  await page.locator('#undo-theory').click();
  assert.equal((await savedDraft(page)).rules.at(-1).left.length, withPair);
  await page.locator('#redo-theory').click();
  assert.equal((await savedDraft(page)).rules.at(-1).left.length, withoutPair);
  await page.locator('#undo-theory').click();
  assert.equal((await savedDraft(page)).rules.at(-1).left.length, withPair);
  await compactSide(page, ruleId);
  report.checks.push('chosen parallel placement; disabled overlap choice; deletion compacts columns; undo and redo');

  const pairChip = () => side(page, ruleId).locator('.gate-chip').filter({ hasText: /^Pair$/ });
  await pairChip().click();
  assert.equal(await pairChip().evaluate(element => element === document.activeElement), true, 'Selecting a gate preserves keyboard focus after rendering');
  await page.keyboard.press('Escape');
  assert.equal(await side(page, ruleId).locator('.placed-gate[data-selected]').count(), 0);
  await pairChip().click();
  await page.keyboard.press('Delete');
  assert.equal((await savedDraft(page)).rules.at(-1).left.length, withoutPair, 'Keyboard Delete removes the selected gate');
  await page.keyboard.press('Control+z');
  assert.equal((await savedDraft(page)).rules.at(-1).left.length, withPair, 'Keyboard undo remains inside the editor after deleting a gate');
  await page.keyboard.press('Control+Shift+z');
  assert.equal((await savedDraft(page)).rules.at(-1).left.length, withoutPair);
  await page.keyboard.press('Control+z');
  assert.equal((await savedDraft(page)).rules.at(-1).left.length, withPair);
  report.checks.push('keyboard focus, Escape, Delete, undo and redo');

  const renamedTheory = page.locator('#theory-name');
  await renamedTheory.fill('Browser test presentation');
  await renamedTheory.press('Tab');
  const editedSource = await saveDraft(page, 'edited');
  const persisted = await savedDraft(page);
  await page.reload();
  await page.locator('.equation-card').last().waitFor();
  assert.deepEqual(await savedDraft(page), persisted);
  assert.equal(await page.locator('#theory-name').inputValue(), persisted.name);
  await page.locator('#new-theory').click();
  assert.equal(await page.locator('.equation-card').count(), 0);
  await openDraft(page, exampleSource);
  assert.equal(await page.locator('.equation-card').count(), 3);
  await openDraft(page, editedSource);
  assert.equal(await page.locator('.equation-card').count(), 4);
  report.checks.push('reload persistence and editable Save/Open round trips');
  await staleFileReads(page, exampleSource, editedSource);
  await fitButtons(page);
  await fits(page, 'desktop edited');
  await page.screenshot({ path: join(output, 'desktop-editor.png'), fullPage: true });
  await audit(page, 'desktop editor');
  await crossSideParallelMove(page);
  await buttonInteractions(page);
  await multiwirePicker(page);
  await globalPhases(page);
  await referenceLibrary(page);
  await gateLabels(page);
  await officialZooShortcuts(page);
  await circuitShortcuts(page);
  const modeFixtures = await modeChecks(page);
  await context.close();

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const mobile = await mobileContext.newPage();
  watch(mobile, 'mobile');
  await mobile.goto(new URL('/minimality/', base).href);
  await mobile.locator('#add-generator').waitFor();
  await fits(mobile, 'mobile empty');
  await loadExample(mobile);
  await fits(mobile, 'mobile example');
  await mobile.screenshot({ path: join(output, 'mobile-example.png'), fullPage: true });
  await audit(mobile, 'mobile example');
  await openDraft(mobile, editedSource);
  const mobileRule = rule(mobile, ruleId);
  const beforeTouch = (await savedDraft(mobile)).rules.at(-1).left;
  await mobileRule.locator('.gate-chip').filter({ hasText: /^Pair$/ }).tap();
  await openPicker(mobile, insert(mobile, ruleId, 0, 4), true);
  await pickerFits(mobile);
  await mobile.screenshot({ path: join(output, 'mobile-generator-picker.png') });
  await audit(mobile, 'mobile generator picker');
  await pickerChoice(mobile, 'g2').tap();
  await picker(mobile).waitFor({ state: 'hidden' });
  const afterTouch = (await savedDraft(mobile)).rules.at(-1).left;
  assert.deepEqual(afterTouch.filter(operation => beforeTouch.some(previous => previous.id === operation.id)), beforeTouch,
    'Choosing a generator by touch leaves every existing gate in place');
  assert.deepEqual(afterTouch.filter(operation => !beforeTouch.some(previous => previous.id === operation.id))
    .map(({ generator, wire, column }) => ({ generator, wire, column })), [{ generator: 'g2', wire: 0, column: 4 }],
    'Touch + then choice adds the requested generator at that position');
  await compactSide(mobile, ruleId);
  await compactSide(mobile, ruleId, 'right');
  await fitButtons(mobile);
  await fits(mobile, 'mobile edited');
  await mobile.screenshot({ path: join(output, 'mobile-editor.png'), fullPage: true });
  await audit(mobile, 'mobile editor');
  await mobile.setViewportSize({ width: 320, height: 780 });
  await fits(mobile, 'small mobile edited');
  await fitButtons(mobile);
  await mobile.screenshot({ path: join(output, 'mobile-320-editor.png'), fullPage: true });
  await audit(mobile, 'small mobile editor');
  const beforeDismiss = await savedDraft(mobile);
  await openPicker(mobile, insert(mobile, ruleId, 0, 0, 'right'), true);
  await pickerFits(mobile);
  await mobile.screenshot({ path: join(output, 'mobile-320-generator-picker.png') });
  await audit(mobile, 'small mobile generator picker');
  await mobile.getByRole('heading', { name: 'Minimality', exact: true }).tap();
  await picker(mobile).waitFor({ state: 'hidden' });
  assert.deepEqual(await savedDraft(mobile), beforeDismiss, 'Touching outside the picker dismisses without adding');
  await side(mobile, ruleId).locator('.placed-gate[data-wire="0"][data-boundary="0"] .gate-chip').tap();
  await side(mobile, ruleId).locator('.placed-gate[data-wire="1"][data-boundary="0"] .gate-chip').focus();
  await audit(mobile, 'small mobile adjacent selected and focused gates');
  report.checks.push('fit-content controls; mobile touch picker addition and outside dismissal;390px and320px layouts');
  await buttonInteractions(mobile, true);
  await multiwirePicker(mobile, true);
  await globalPhases(mobile, true);
  await referenceLibrary(mobile, true);
  await gateLabels(mobile, true);
  await officialZooShortcuts(mobile, true);
  await circuitShortcuts(mobile, true);
  await longPicker(mobile);
  await mobileModes(mobile, modeFixtures);
  await mobileContext.close();
  }
  assert.deepEqual(report.errors, [], 'No browser runtime or console errors');
  const violations = report.accessibility.flatMap(result => result.violations.map(violation => `${result.label}: ${violation.id}`));
  assert.equal(violations.length, 0, `Axe accessibility violations: ${violations.join('; ')}. See browser-report.json for targets.`);
} catch (error) {
  report.failure = { message: error.message, stack: error.stack };
  for (const [index, page] of browser.contexts().flatMap(context => context.pages()).entries()) {
    try { await bounded(page.screenshot({ path: join(output, `failure-${index}.png`), fullPage: true, timeout: 10_000 }), 12_000, 'Failure screenshot'); }
    catch { /* Preserve the original failure if its page has already closed. */ }
  }
  throw error;
} finally {
  await writeFile(join(output, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
  console.log('BROWSER_CLOSED');
  console.log(JSON.stringify({ checks: report.checks, errors: report.errors,
    accessibility: report.accessibility.map(({ label, passedRules, violations }) => ({ label, passedRules, violations: violations.map(value => value.id) })),
    failure: report.failure?.message, output }, null, 2));
}
