import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { pathGraph } from '../../src/lib/graph-states/engine.js';
import { LEVELS } from '../../src/lib/graph-states/puzzles.js';
import { REPLAY_COMPLEMENT_DURATION } from '../../src/lib/graph-states/animation.js';
import { updateDailyHeading } from '../../src/lib/games/daily-ui.js';

const root = new URL('../../', import.meta.url);
const settle = () => new Promise(resolve => setImmediate(resolve));

// Exercise the actual controller with controllable motion/network boundaries.
// Gate geometry and native interactions have their own rendering/browser tests.
test('graph replay keeps completed-round actions stable and cancels stale animations', async context => {
  class Element {
    constructor() { this.listeners = new Map(); this.dataset = {}; this.attrs = {}; this.children = []; this.hidden = this.disabled = this.open = false; }
    appendChild(child) {
      if (child.parentElement) child.parentElement.children.splice(child.parentElement.children.indexOf(child), 1);
      child.parentElement = this; this.children.push(child); return child;
    }
    addEventListener(name, callback) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]); }
    async dispatch(name, event = {}) { await Promise.all((this.listeners.get(name) ?? []).map(callback => callback({ target: this, ...event }))); }
    click() { return this.disabled ? Promise.resolve() : this.dispatch('click'); }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    removeAttribute(name) { delete this.attrs[name]; if (name === 'data-graph-animating') delete this.dataset.graphAnimating; }
    querySelectorAll() { return []; }
    querySelector() { return null; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    focus() {}
  }
  const componentFiles = await readdir(new URL('src/components/games/', root));
  const markup = (await Promise.all([
    readFile(new URL('src/pages/games/graph-states.astro', root), 'utf8'),
    ...componentFiles.filter(file => file.endsWith('.astro')).map(file => readFile(new URL(`src/components/games/${file}`, root), 'utf8')),
  ])).join('\n');
  const elements = new Map([...markup.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], new Element()]));
  const get = id => { assert.ok(elements.has(id), `Game markup contains #${id}`); return elements.get(id); };
  const timers = new Map(), jobs = [], submitted = [], shared = [];
  let scoreOptions;
  const dependencies = {
    renderGraph: (node, graph) => { node.graph = structuredClone(graph); }, renderCircuit() {},
    edgeAtPoint() { return null; },
    REPLAY_COMPLEMENT_DURATION,
    animateGraphMove(_node, graph, move, options) {
      let finish;
      const job = { graph, move, options, cancelled: false,
        finished: new Promise(resolve => { finish = resolve; }), finish: completed => finish(completed),
        cancel() { this.cancelled = true; finish(false); },
      };
      jobs.push(job); return job;
    },
    createScoreboard(options) {
      scoreOptions = options;
      return { player: null, automatic: false, submitting: false, load() {}, reset() {}, dispose() {}, submit() {},
        autoSubmit() { if (options.canSubmit()) submitted.push(structuredClone(options.sequence())); },
      };
    },
    createDailySession: () => ({ loading: false, cancel() {}, refresh() {} }),
    createReplayShare: () => ({ close() {}, open(_source, replay) { shared.push(replay); } }),
    createMoveTimeline: node => sequence => { node.length = sequence.length; },
    createCustomPuzzleJson: () => ({ update() {}, close() {} }),
    createTutorial: () => ({ active: false, executing: false, enter() {}, leave() {}, render() {} }),
    startDailyFromLink: () => false, bindDailyControls() {}, updateDailyHeading,
  };
  const globals = { document: Object.assign(new Element(), { getElementById: get }), window: new Element(),
    __graphControllerTest: dependencies,
    setTimeout(callback, delay) { const timer = { callback, delay }; timers.set(timer, timer); return timer; },
    clearTimeout: timer => timers.delete(timer),
  };
  for (const [name, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    context.after(() => { if (original) Object.defineProperty(globalThis, name, original); else delete globalThis[name]; });
  }
  const script = new URL('src/scripts/graph-states.js', root);
  let source = await readFile(script, 'utf8');
  const mocked = new Set(['scoreboard.js', 'daily-session.js', 'daily-links.js',
    'replay-share.js', 'move-timeline.js', 'custom-puzzle-json.js', 'tutorial.js', 'daily-ui.js']);
  source = source.replace(/import \{([^}]+)\} from '([^']+)';/g, (statement, names, path) => {
    // The graph tutorial is data; only the shared tutorial controller is mocked.
    if ((path.includes('/games/') && mocked.has(path.split('/').at(-1))) || /graph-states\/(?:rendering|animation)\.js$/.test(path)) {
      return `const {${names}} = globalThis.__graphControllerTest;`;
    }
    return statement.replace(path, new URL(path, script).href);
  });
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const ui = () => ['show-results', 'share-replay', 'share-result', 'next-level', 'result-next', 'score-form', 'result-actions']
    .map(id => [id, get(id).hidden, get(id).disabled]);
  const playTimer = () => {
    assert.equal(timers.size, 1);
    const timer = timers.values().next().value;
    assert.equal(timer.delay, 200); timers.delete(timer); timer.callback();
  };
  const complete = async job => { job.finish(true); await settle(); };

  await get('mode-campaign').click();
  const vertex = Object.assign(new Element(), { dataset: { vertex: '1' }, closest: () => vertex });
  await get('graph-board').dispatch('click', { target: vertex, detail: 0 });
  assert.equal(jobs[0].options.duration, undefined, 'Live play keeps the normal animation duration');
  await complete(jobs[0]);
  assert.deepEqual(get('graph-board').graph.edges, pathGraph(3).edges);
  assert.equal(get('win-dialog').open, true); assert.equal(submitted.length, 1);
  get('win-dialog').close();
  const completedUi = ui();

  await get('replay').click();
  assert.equal(get('review-note').textContent, 'Operation 0 / 1');
  assert.deepEqual(get('graph-board').graph.edges, LEVELS[0].edges);
  assert.equal(scoreOptions.canSubmit(), false, 'Review never submits a score for a historical frame');
  assert.deepEqual(ui(), completedUi);
  playTimer();
  assert.equal(jobs[1].options.duration, REPLAY_COMPLEMENT_DURATION);
  assert.deepEqual(ui(), completedUi, 'Starting motion does not hide completed-round buttons or score fields');
  assert.equal(get('win-dialog').open, false);
  await complete(jobs[1]);
  assert.deepEqual(ui(), completedUi, 'Finishing motion does not toggle completed-round actions');
  assert.equal(get('review-note').textContent, 'Operation 1 / 1');
  assert.equal(submitted.length, 1); assert.equal(get('win-dialog').open, false);

  await get('replay').click(); playTimer();
  await get('share-replay').click();
  assert.equal(jobs[2].cancelled, true, 'Share cancels replay motion before restoring the completed graph');
  assert.equal(shared.length, 1); assert.deepEqual(shared[0].sequence, [{ vertex: 1 }]);
  assert.equal(get('review-controls').hidden, true);
  assert.deepEqual(get('graph-board').graph.edges, pathGraph(3).edges);
  await complete(jobs[2]);
  assert.equal(get('review-controls').hidden, true, 'A stale transition cannot restart review');

  await get('replay').click(); playTimer();
  await get('show-results').click();
  assert.equal(jobs[3].cancelled, true);
  assert.equal(get('win-dialog').open, true, 'Explicit Results remains usable during replay');
  assert.equal(get('review-controls').hidden, true);
  await complete(jobs[3]);
  assert.deepEqual(get('graph-board').graph.edges, pathGraph(3).edges);

  get('win-dialog').close();
  await get('replay').click(); playTimer();
  await get('restart').click();
  assert.equal(jobs[4].cancelled, true);
  await complete(jobs[4]);
  assert.deepEqual(get('graph-board').graph.edges, LEVELS[0].edges);
  assert.equal(get('sequence').length, 0); assert.equal(get('show-results').hidden, true);
  assert.equal(get('win-dialog').open, false); assert.equal(timers.size, 0);
});
