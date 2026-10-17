import test from 'node:test';
import assert from 'node:assert/strict';
import { createStepReplay } from '../../src/lib/games/step-replay.js';

function fixture(context, count = 3, transition, interval = 650) {
  const timers = new Map(), renders = [];
  let entries = 0, allowed = true, length = count;
  context.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    const timer = { callback, delay }; timers.set(timer, timer); return timer;
  });
  context.mock.method(globalThis, 'clearTimeout', timer => timers.delete(timer));
  const replay = createStepReplay({ length: () => length, canReview: () => allowed,
    transition, interval,
    onEnter: () => { entries++; }, onChange: () => renders.push({ step: replay.step, playing: replay.playing }),
  });
  function tick() {
    assert.equal(timers.size, 1);
    const timer = timers.values().next().value;
    assert.equal(timer.delay, interval); timers.delete(timer); timer.callback();
  }
  return { replay, timers, renders, tick, get entries() { return entries; },
    /** @param {boolean} value */
    set allowed(value) { allowed = value; },
    /** @param {number} value */
    set length(value) { length = value; } };
}

test('play renders the initial snapshot once, advances every step and stops on the final snapshot', context => {
  const { replay, timers, renders, tick } = fixture(context);
  assert.equal(replay.step, null); assert.equal(replay.playing, false);
  assert.equal(replay.play(), true);
  assert.deepEqual(renders, [{ step: 0, playing: true }]);
  for (let step = 1; step <= 3; step++) {
    tick(); assert.equal(replay.step, step); assert.equal(replay.playing, step < 3);
  }
  assert.equal(timers.size, 0);
  assert.deepEqual(renders, [0, 1, 2, 3].map(step => ({ step, playing: step < 3 })));
});

test('games can shorten replay pauses without changing the default pace', context => {
  const { replay, tick, timers } = fixture(context, 2, null, 200);
  replay.play();
  assert.equal(timers.values().next().value.delay, 200);
  tick(); assert.equal(replay.step, 1);
  assert.equal(timers.values().next().value.delay, 200);
  tick(); assert.equal(replay.step, 2); assert.equal(replay.playing, false);
});

test('animated replay waits for each transition and clearing cancels pending motion', async context => {
  const jobs = [];
  const state = fixture(context, 2, step => {
    let finish;
    const job = { step, cancelled: false, finished: new Promise(resolve => { finish = resolve; }),
      cancel() { this.cancelled = true; finish(false); }, finish: value => finish(value) };
    jobs.push(job); return job;
  });
  state.replay.play(); state.tick();
  assert.equal(state.replay.step, 0); assert.equal(state.replay.playing, true);
  assert.equal(state.timers.size, 0); assert.equal(jobs[0].step, 0);
  jobs[0].finish(true); await Promise.resolve();
  assert.equal(state.replay.step, 1); assert.equal(state.timers.size, 1);
  state.tick(); assert.equal(jobs[1].step, 1);
  state.replay.clear();
  assert.equal(jobs[1].cancelled, true);
  state.replay.play(); jobs[1].finish(true); await Promise.resolve();
  assert.equal(state.replay.step, 0, 'An old animation cannot advance new playback');
  state.tick(); jobs[2].finish(true); await Promise.resolve();
  state.tick(); jobs[3].finish(true); await Promise.resolve();
  assert.equal(state.replay.step, 2); assert.equal(state.replay.playing, false);
});

test('inspection cancels motion and an interrupted transition stops playback without advancing', async context => {
  let finish, cancelled = 0;
  const state = fixture(context, 2, () => ({ finished: new Promise(resolve => { finish = resolve; }), cancel() { cancelled++; } }));
  state.replay.play(); state.tick();
  assert.equal(state.replay.inspect(2), true); assert.equal(cancelled, 1);
  finish(true); await Promise.resolve();
  assert.equal(state.replay.step, 2); assert.equal(state.replay.playing, false);
  state.replay.play(); state.tick(); finish(false); await Promise.resolve();
  assert.equal(state.replay.step, 0); assert.equal(state.replay.playing, false);
  assert.equal(state.timers.size, 0);
});

test('single-move and empty rounds respect their boundaries', context => {
  const state = fixture(context, 1);
  state.replay.play(); state.tick();
  assert.equal(state.replay.step, 1); assert.equal(state.replay.playing, false);
  state.replay.clear(); state.length = 0;
  assert.equal(state.replay.play(), false); assert.equal(state.replay.step, null);
  assert.equal(state.replay.inspect(0), true); assert.equal(state.replay.step, 0);
  assert.equal(state.replay.inspect(1), false); assert.equal(state.timers.size, 0);
});

test('inspection validates positions, cancels autoplay and invokes entering-review effects once', context => {
  const state = fixture(context);
  for (const step of [-1, 4, NaN, Infinity, .5, '1', null]) assert.equal(state.replay.inspect(step), false);
  assert.equal(state.entries, 0); assert.deepEqual(state.renders, []);
  state.replay.play();
  const stale = state.timers.values().next().value.callback;
  assert.equal(state.replay.inspect(3), true);
  assert.equal(state.entries, 2); assert.equal(state.timers.size, 0);
  assert.deepEqual(state.renders.at(-1), { step: 3, playing: false });
  stale(); assert.equal(state.replay.step, 3); assert.equal(state.renders.length, 2);
  assert.equal(state.replay.inspect(0), true); assert.equal(state.replay.step, 0);
});

test('clear cancels playback silently and stale callbacks cannot enter a new round', context => {
  const state = fixture(context);
  state.replay.play(); const stale = state.timers.values().next().value.callback;
  state.replay.clear(); state.replay.clear();
  assert.equal(state.replay.step, null); assert.equal(state.replay.playing, false);
  assert.equal(state.timers.size, 0); assert.equal(state.renders.length, 1);
  stale(); assert.equal(state.replay.step, null); assert.equal(state.renders.length, 1);
  state.length = 1; state.replay.play();
  stale(); assert.equal(state.replay.step, 0); assert.equal(state.timers.size, 1);
  state.tick(); assert.equal(state.replay.step, 1);
});

test('blocked games leave playback and inspection state unchanged', context => {
  const state = fixture(context);
  state.allowed = false;
  assert.equal(state.replay.play(), false); assert.equal(state.replay.inspect(0), false);
  assert.equal(state.replay.step, null); assert.equal(state.entries, 0);
  state.allowed = true; state.replay.play();
  const timer = state.timers.values().next().value;
  state.allowed = false;
  assert.equal(state.replay.play(), false); assert.equal(state.replay.inspect(2), false);
  assert.equal(state.timers.values().next().value, timer);
  assert.equal(state.replay.step, 0); assert.equal(state.entries, 1);
});
