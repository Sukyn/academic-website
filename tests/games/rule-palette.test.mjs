import assert from 'node:assert/strict';
import test from 'node:test';
import { createRulePalette } from '../../src/lib/games/rule-palette.js';

function button(rule) {
  let click;
  return { dataset: { rule }, disabled: true, hidden: false,
    addEventListener(type, handler) { assert.equal(type, 'click'); click = handler; },
    click() { click(); } };
}

function placedButtons(rules, nativeMove = false) {
  const doc = { activeElement: null }, entries = rules.map(button), moves = [], focuses = [];
  const parent = { children: [...entries], ownerDocument: doc,
    get firstElementChild() { return this.children[0] ?? null; },
    insertBefore(node, before) {
      moves.push(node.dataset.rule);
      this.children.splice(this.children.indexOf(node), 1);
      this.children.splice(before === null ? this.children.length : this.children.indexOf(before), 0, node);
      if (!nativeMove && doc.activeElement === node) doc.activeElement = null;
    },
  };
  if (nativeMove) parent.moveBefore = parent.insertBefore;
  for (const node of entries) {
    node.parentElement = parent;
    Object.defineProperty(node, 'nextElementSibling', { get: () => parent.children[parent.children.indexOf(node) + 1] ?? null });
    node.focus = options => { focuses.push(options); doc.activeElement = node; };
  }
  return { entries, parent, doc, moves, focuses, order: () => parent.children.map(node => node.dataset.rule) };
}

test('circuit equations apply the first legal match and discard stale matches', () => {
  const hh = button('hh'), color = button('color'), played = [];
  const palette = createRulePalette([hh, color], { apply: move => played.push(move) });
  const moves = [{ rule: 'hh', row: 1 }, { rule: 'hh', row: 2 }];
  palette.update(moves); hh.click(); color.click();
  assert.deepEqual(played, [moves[0]]);
  palette.update([]); hh.click(); assert.equal(played.length, 1);
  palette.update(moves, { disabled: true }); hh.click(); assert.equal(played.length, 1);
  palette.update(moves, { allowed: ['color'] }); hh.click();
  assert.equal(hh.hidden, true); assert.equal(hh.disabled, true); assert.equal(played.length, 1);
  palette.update(moves); assert.equal(hh.hidden, false); assert.equal(hh.disabled, false);
});

test('inverse moves share their equation and ambiguous choices are left to the game', () => {
  const identity = button('identity'), choices = [], played = [];
  const palette = createRulePalette([identity], { apply: move => played.push(move),
    ruleOf: move => move.rule === 'insert' ? 'identity' : move.rule,
    choose: (moves, trigger) => choices.push({ moves, trigger }) });
  const moves = [{ rule: 'insert', kind: 'z' }, { rule: 'insert', kind: 'x' }];
  palette.update(moves); identity.click();
  assert.deepEqual(choices, [{ moves, trigger: identity }]);
  assert.deepEqual(played, []);
  palette.update([moves[1]]); identity.click();
  assert.deepEqual(played, [moves[1]], 'A unique match applies without opening a chooser');
  palette.update([], { disabled: true }); identity.click(); assert.equal(choices.length, 1);
});

test('available equations come first in canonical order without moving unchanged or locked controls', () => {
  const state = placedButtons(['a', 'b', 'c', 'd']), played = [];
  const palette = createRulePalette(state.entries, { apply: move => played.push(move) });
  const moves = [{ rule: 'd' }, { rule: 'b' }];
  palette.update(moves);
  assert.deepEqual(state.order(), ['b', 'd', 'a', 'c']);
  state.entries[1].click(); assert.equal(played[0], moves[1], 'Moving the button preserves its handler');
  const changes = state.moves.length;
  palette.update(moves); assert.equal(state.moves.length, changes, 'Metadata updates keep the same DOM nodes in place');
  palette.update([{ rule: 'c' }], { disabled: true });
  assert.deepEqual(state.order(), ['b', 'd', 'a', 'c']); assert.equal(state.moves.length, changes);
  state.entries[1].click(); assert.equal(played.length, 1, 'Locked controls cannot reuse a stale match');
  palette.update([{ rule: 'd' }, { rule: 'b' }], { allowed: ['b', 'c'] });
  assert.deepEqual(state.order(), ['b', 'a', 'c', 'd'], 'Hidden matches do not precede available equations');
  palette.update([]); assert.deepEqual(state.order(), ['a', 'b', 'c', 'd']);
});

for (const nativeMove of [false, true]) test(`moving an equation retains keyboard focus (${nativeMove ? 'native move' : 'legacy insert'})`, () => {
  const state = placedButtons(['a', 'b', 'c'], nativeMove);
  state.doc.activeElement = state.entries[2];
  const palette = createRulePalette(state.entries, { apply() {} });
  palette.update([{ rule: 'c' }]);
  assert.deepEqual(state.order(), ['c', 'a', 'b']); assert.equal(state.doc.activeElement, state.entries[2]);
  assert.deepEqual(state.focuses, nativeMove ? [] : [{ preventScroll: true }]);
});

test('the sole tutorial equation is first after the tutorial locks the other matches', () => {
  const state = placedButtons(['a', 'b', 'c', 'd']);
  const palette = createRulePalette(state.entries, { apply() {} });
  palette.update([{ rule: 'c' }, { rule: 'd' }]);
  for (const node of state.entries) node.disabled = node.dataset.rule !== 'd';
  palette.prioritize('d'); assert.deepEqual(state.order(), ['d', 'a', 'b', 'c']);
  const changes = state.moves.length;
  palette.prioritize('d'); palette.prioritize(undefined); assert.equal(state.moves.length, changes);
  palette.update([{ rule: 'b' }, { rule: 'c' }]); assert.deepEqual(state.order(), ['b', 'c', 'a', 'd']);
});
