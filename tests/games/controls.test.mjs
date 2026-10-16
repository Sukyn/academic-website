import assert from 'node:assert/strict';
import test from 'node:test';
import { bindGameDialogs, ignoresGameShortcut } from '../../src/lib/games/controls.js';

for (const extraDialogs of [[], ['gate-legend']]) test(`shared dialogs respect disabled controls and backdrop boundaries (${extraDialogs.length ? 'with guide' : 'default'})`, () => {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) {
      const listeners = new Map();
      nodes.set(id, {
        open: false, disabled: false, openings: 0,
        addEventListener(type, action) { listeners.set(type, action); },
        emit(type, event = {}) { listeners.get(type)?.({ target: this, ...event }); },
        showModal() { this.open = true; this.openings++; }, close() { this.open = false; },
        getBoundingClientRect() { return { left: 10, right: 100, top: 20, bottom: 120 }; },
      });
    }
    return nodes.get(id);
  };
  bindGameDialogs(get, extraDialogs);
  const show = get('show-rules'), rules = get('rules-dialog'), win = get('win-dialog');
  show.disabled = true; show.emit('click'); assert.equal(rules.open, false);
  show.disabled = false; show.emit('click'); show.emit('click'); assert.equal(rules.openings, 1);
  rules.emit('click', { clientX: 50, clientY: 50 }); assert.equal(rules.open, true);
  rules.emit('click', { target: {}, clientX: 0, clientY: 0 }); assert.equal(rules.open, true);
  rules.emit('click', { clientX: 9, clientY: 50 }); assert.equal(rules.open, false);
  show.emit('click'); get('close-rules').emit('click'); assert.equal(rules.open, false);
  win.showModal(); win.emit('click', { clientX: 50, clientY: 121 }); assert.equal(win.open, false);
  win.showModal(); get('close-win').emit('click'); assert.equal(win.open, false);
  if (extraDialogs.length) {
    const legend = get('gate-legend-dialog'), showLegend = get('show-gate-legend');
    showLegend.disabled = true; showLegend.emit('click'); assert.equal(legend.open, false);
    showLegend.disabled = false; showLegend.emit('click'); showLegend.emit('click'); assert.equal(legend.openings, 1);
    legend.emit('click', { clientX: 50, clientY: 50 }); assert.equal(legend.open, true);
    legend.emit('click', { clientX: 0, clientY: 0 }); assert.equal(legend.open, false);
    showLegend.emit('click'); get('close-gate-legend').emit('click'); assert.equal(legend.open, false);
  }
});

test('shared shortcut guard protects editing and dialogs without swallowing game-specific modifiers', context => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let modal = null;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => modal } });
  context.after(() => {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else delete globalThis.document;
  });
  const event = (extra = {}, target = {}) => ({ target: { tagName: 'BUTTON', ...target }, ...extra });
  assert.equal(ignoresGameShortcut(event()), false);
  for (const flag of ['defaultPrevented', 'altKey', 'repeat']) assert.equal(ignoresGameShortcut(event({ [flag]: true })), true);
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(ignoresGameShortcut(event({}, { tagName })), true);
  assert.equal(ignoresGameShortcut(event({}, { isContentEditable: true })), true);
  for (const flag of ['ctrlKey', 'metaKey', 'shiftKey']) assert.equal(ignoresGameShortcut(event({ [flag]: true })), false);
  modal = {}; assert.equal(ignoresGameShortcut(event()), true);
});
