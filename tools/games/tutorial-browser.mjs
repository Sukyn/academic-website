// Focused real-input checks for the shared tutorial bubble and every worked example.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { GOLF_TUTORIAL } from '../../src/lib/quantum-golf/tutorial.js';
import { TUTORIAL_STEPS as CIRCUIT_STEPS } from '../../src/lib/circuit-reduction/tutorial.js';
import { TUTORIAL_STEPS as SIGNAL_STEPS } from '../../src/lib/quantum-signals/tutorial.js';
import { TUTORIAL as GRAPH_TUTORIAL } from '../../src/lib/graph-states/tutorial.js';
import { TUTORIAL as ZX_TUTORIAL } from '../../src/lib/zx-calculus/engine.js';
import { getTutorial } from '../../src/lib/categorical-circuits/puzzles.js';
import { createBrowserApi } from '../circuit-reduction/browser-api.mjs';

const require = createRequire(resolve(process.env.PLAYWRIGHT_MODULE_DIR ?? 'tmp/quality-tools/node_modules', 'package.json'));
const qualityRequire = createRequire(resolve(process.env.QUALITY_MODULE_DIR ?? 'tmp/quality-tools/node_modules', 'package.json'));
const { chromium } = require('playwright');
const axe = await readFile(qualityRequire.resolve('axe-core/axe.min.js'), 'utf8');
const base = process.env.GAME_BASE_URL ?? 'http://127.0.0.1:4323';
const output = resolve('tmp/tutorial-browser');
const fixture = createBrowserApi({ now: Date.parse('2026-10-25T10:00:00Z') });
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {}) });
const errors = [], reports = [];
const trace = message => { if (process.env.GAME_TUTORIAL_TRACE) console.log(message); };
const games = [
  ['quantum-golf', GOLF_TUTORIAL.moves.length],
  ['circuit-reduction', CIRCUIT_STEPS.length],
  ['quantum-signals', SIGNAL_STEPS.length],
  ['graph-states', GRAPH_TUTORIAL.steps.length],
  ['zx-calculus', ZX_TUTORIAL.solution.length],
  ...['prop', 'controlled'].flatMap(category => [
    ['circuit-reduction', getTutorial(category, 'simplification').steps.length, category],
    ['quantum-signals', getTutorial(category, 'signals').steps.length, category],
  ]),
];
await mkdir(output, { recursive: true });

async function activate(locator, touch) {
  if (touch) await locator.tap(); else await locator.click();
}

async function accessibility(page) {
  await page.evaluate(axe);
  const result = await page.evaluate(() => window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] },
  }));
  assert.deepEqual(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })), []);
}

async function frames(page, count = 2) {
  let timer;
  try {
    await Promise.race([
      page.evaluate(count => new Promise(resolve => {
        const next = () => { if (--count) requestAnimationFrame(next); else resolve(true); };
        requestAnimationFrame(next);
      }), count),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The foreground page stopped drawing frames.')), 5_000); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function bubbleGeometry(page, label) {
  await page.locator('#tutorial-panel[data-tutorial-bubble]').waitFor();
  assert.equal(await page.locator('.game-content[data-tutorial-demo]').count(), 1, label + ': one read-only demonstration is active');
  await frames(page);
  await page.waitForFunction(() => {
    const panel = document.getElementById('tutorial-panel');
    const box = panel.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && Number.isFinite(Number.parseFloat(panel.style.left));
  });
  const result = await page.evaluate(() => {
    const panel = document.getElementById('tutorial-panel');
    const cue = document.querySelector('[data-tutorial-focus]');
    const anchors = [...document.querySelectorAll('[data-tutorial-anchor]')];
    const toRect = node => {
      const { left, top, right, bottom, width, height } = node.getBoundingClientRect();
      return { left, top, right, bottom, width, height };
    };
    const box = toRect(panel);
    const references = anchors.map(anchor => {
      const reference = toRect(anchor);
      // Graph edge controls have a large rotated hitbox; their referent is the midpoint.
      if (anchor.matches('[data-edge]')) {
        const x = (reference.left + reference.right) / 2, y = (reference.top + reference.bottom) / 2;
        Object.assign(reference, { left: x - 4, right: x + 4, top: y - 4, bottom: y + 4 });
      }
      for (let node = anchor.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node), clip = node.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
          reference.left = Math.max(reference.left, clip.left + node.clientLeft);
          reference.right = Math.min(reference.right, clip.left + node.clientLeft + node.clientWidth);
        }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
          reference.top = Math.max(reference.top, clip.top + node.clientTop);
          reference.bottom = Math.min(reference.bottom, clip.top + node.clientTop + node.clientHeight);
        }
      }
      reference.left = Math.max(0, reference.left); reference.right = Math.min(innerWidth, reference.right);
      reference.top = Math.max(0, reference.top); reference.bottom = Math.min(innerHeight, reference.bottom);
      return reference;
    });
    const reference = references.length && {
      left: Math.min(...references.map(rect => rect.left)), right: Math.max(...references.map(rect => rect.right)),
      top: Math.min(...references.map(rect => rect.top)), bottom: Math.max(...references.map(rect => rect.bottom)),
    };
    const button = cue && toRect(cue);
    const next = document.getElementById('tutorial-next'), nextBox = toRect(next);
    const nextHit = document.elementFromPoint(nextBox.left + nextBox.width / 2, nextBox.top + nextBox.height / 2);
    const pointer = panel.querySelector('.tutorial-pointer path');
    // M base C shoulder control tip C control shoulder base Z: the first curve ends at the speaker.
    const path = pointer?.getAttribute('d') ?? '';
    const coordinates = (path.match(/[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    const tip = pointer && { x: coordinates[6], y: coordinates[7] };
    const screenTip = tip && new DOMPoint(tip.x, tip.y).matrixTransform(pointer.getScreenCTM());
    const body = panel.querySelector('.tutorial-body'), bodyBox = body.getBoundingClientRect();
    const clip = { left: bodyBox.left + body.clientLeft, top: bodyBox.top + body.clientTop };
    const borderClearance = [...panel.querySelectorAll('.tutorial-actions button')].filter(button => !button.hidden)
      .map(button => {
        const box = button.getBoundingClientRect();
        return { left: box.left - clip.left, top: box.top - clip.top,
          right: clip.left + body.clientWidth - box.right, bottom: clip.top + body.clientHeight - box.bottom };
      });
    return { box, reference, references, placement: panel.dataset.placement, position: getComputedStyle(panel).position,
      anchorCount: anchors.length, anchorInside: anchors.some(anchor => panel.contains(anchor)),
      connector: pointer && getComputedStyle(pointer.parentElement).display !== 'none' && screenTip && { x: screenTip.x, y: screenTip.y },
      tail: pointer && { closed: /z\s*$/i.test(path), curves: (path.match(/c/gi) ?? []).length,
        fill: getComputedStyle(pointer).fill, background: getComputedStyle(panel).backgroundColor },
      nextHighlighted: next.hasAttribute('data-tutorial-focus'),
      borderClearance,
      cue: button && { ...button, disabled: cue.disabled, insideBubble: panel.contains(cue) },
      next: { ...nextBox, disabled: next.disabled, covered: !next.contains(nextHit) },
      width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth,
      text: document.getElementById('tutorial-text').textContent,
    };
  });
  const { box, reference, cue } = result;
  assert.equal(result.position, 'fixed', label + ': the bubble uses viewport coordinates');
  assert.ok(['above', 'below', 'left', 'right'].includes(result.placement), label + ': one arrow side is chosen');
  assert.ok(box.left >= -1 && box.top >= -1 && box.right <= result.width + 1 && box.bottom <= result.height + 1,
    label + ': the complete bubble fits the viewport: ' + JSON.stringify(result));
  assert.ok(result.connector,
    label + ': the speech tail is visible');
  assert.ok(result.tail?.closed && result.tail.curves === 2 && result.tail.fill === result.tail.background,
    label + ': the bubble has a filled curved tail instead of an arrow');
  assert.ok(result.anchorCount >= 1, label + ': the relevant visual elements are marked');
  assert.equal(result.anchorInside, false, label + ': the bubble points outside itself');
  assert.ok(result.references.length && result.references.every(rect => rect.right > rect.left && rect.bottom > rect.top),
    label + ': every relevant element is visible');
  if (result.connector) {
    const { x, y } = result.connector;
    const distance = Math.hypot(Math.max(reference.left - x, 0, x - reference.right), Math.max(reference.top - y, 0, y - reference.bottom));
    assert.ok(distance <= 6, label + ': the pointer ends at the precise referent: ' + JSON.stringify(result));
  }
  const clearSide = reference && (reference.left >= box.width + 12 || result.width - reference.right >= box.width + 12 ||
    reference.top >= box.height + 12 || result.height - reference.bottom >= box.height + 12);
  const overlap = reference && Math.max(0, Math.min(box.right, reference.right) - Math.max(box.left, reference.left)) *
    Math.max(0, Math.min(box.bottom, reference.bottom) - Math.max(box.top, reference.top));
  if (clearSide) assert.ok(overlap <= 1, label + ': available space keeps the referent uncovered: ' + JSON.stringify(result));
  assert.ok(!cue || !cue.insideBubble && cue.disabled, label + ': highlighted game controls stay read-only');
  assert.equal(result.nextHighlighted, false, label + ': Next step never receives the diagram highlight');
  assert.ok(result.borderClearance.every(gaps => Object.values(gaps).every(gap => gap >= 1)),
    label + ': the scroll area leaves every button border unclipped: ' + JSON.stringify(result.borderClearance));
  assert.ok(!result.next.disabled && !result.next.covered, label + ': Next is enabled and accepts a real pointer');
  assert.ok(result.next.top >= 0 && result.next.left >= 0 && result.next.bottom <= result.height + 1 && result.next.right <= result.width + 1,
    label + ': Next stays inside the viewport');
  assert.ok(result.documentWidth <= result.width + 1, label + ': the bubble adds no page overflow');
  return result;
}

async function clean(page, label) {
  assert.equal(await page.locator('#tutorial-panel').isVisible(), false, label + ': no orphan explanation');
  assert.equal(await page.locator('[data-tutorial-anchor], [data-tutorial-focus], [data-tutorial-bubble]').count(), 0,
    label + ': focus, referent and floating state are removed');
  assert.equal(await page.locator('[data-tutorial-demo]').count(), 0, label + ': normal gameplay is restored');
  assert.equal(await page.locator('#tutorial-panel').evaluate(node => node.matches(':popover-open')), false, label + ': no open tutorial popover');
}

async function uncovered(page, selector, label) {
  const result = await page.locator(selector).evaluateAll(nodes => {
    const bubble = document.getElementById('tutorial-panel').getBoundingClientRect();
    return nodes.map(node => {
      const rect = node.getBoundingClientRect();
      return { visible: rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight,
        overlap: Math.max(0, Math.min(rect.right, bubble.right) - Math.max(rect.left, bubble.left)) *
          Math.max(0, Math.min(rect.bottom, bubble.bottom) - Math.max(rect.top, bubble.top)) };
    });
  });
  assert.ok(result.length && result.every(node => node.visible && node.overlap <= 1), label + ': related visual context stays visible: ' + JSON.stringify(result));
}

async function graphContext(page, label) {
  const result = await page.evaluate(() => {
    const bubble = document.getElementById('tutorial-panel').getBoundingClientRect();
    const nodes = [...document.querySelectorAll('#graph-board [data-vertex]')].map(node => node.getBoundingClientRect());
    const plot = { left: Math.min(...nodes.map(node => node.left)), right: Math.max(...nodes.map(node => node.right)),
      top: Math.min(...nodes.map(node => node.top)), bottom: Math.max(...nodes.map(node => node.bottom)) };
    const tail = document.querySelector('#tutorial-panel .tutorial-pointer path');
    const toTail = tail.getScreenCTM().inverse();
    const centersInTail = nodes.filter(node => tail.isPointInFill(new DOMPoint((node.left + node.right) / 2,
      (node.top + node.bottom) / 2).matrixTransform(toTail))).length;
    return { count: nodes.length, visible: nodes.every(node => node.left >= 0 && node.right <= innerWidth && node.top >= 0 && node.bottom <= innerHeight),
      overlap: Math.max(0, Math.min(plot.right, bubble.right) - Math.max(plot.left, bubble.left)) *
        Math.max(0, Math.min(plot.bottom, bubble.bottom) - Math.max(plot.top, bubble.top)), centersInTail };
  });
  assert.ok(result.count && result.visible && result.overlap <= 1 && result.centersInTail === 0,
    label + ': all vertices and the graph between them remain visible: ' + JSON.stringify(result));
}

async function circuitCommutationMovie(page, label, name) {
  await page.locator('#circuit-board[data-rewrite-animating]').waitFor();
  // Pause the native tracks to inspect the moving gates and links at reproducible frames.
  await page.evaluate(() => document.getElementById('circuit-board').getAnimations({ subtree: true }).forEach(animation => animation.pause()));
  try {
    for (const progress of [.15, .5, .85]) {
      await page.evaluate(progress => document.getElementById('circuit-board').getAnimations({ subtree: true }).forEach(animation => {
        animation.currentTime = Number(animation.effect.getTiming().duration) * progress;
      }), progress);
      await frames(page);
      const result = await page.evaluate(() => {
        const bubble = document.getElementById('tutorial-panel').getBoundingClientRect();
        const tail = document.querySelector('#tutorial-panel .tutorial-pointer path');
        const toTail = tail.getScreenCTM().inverse();
        return [...document.querySelectorAll('#circuit-board .rewrite-gate, #circuit-board .rewrite-link')]
          .filter(node => Number(getComputedStyle(node).opacity) > .01).map(node => {
            const box = node.getBoundingClientRect();
            return { visible: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight,
              overlap: Math.max(0, Math.min(box.right, bubble.right) - Math.max(box.left, bubble.left)) *
                Math.max(0, Math.min(box.bottom, bubble.bottom) - Math.max(box.top, bubble.top)),
              inTail: tail.isPointInFill(new DOMPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2).matrixTransform(toTail)) };
          });
      });
      assert.ok(result.length && result.every(node => node.visible && node.overlap <= 1 && !node.inTail),
        `${label}: CZ/Z animation remains uncovered at ${progress}: ${JSON.stringify(result)}`);
      if (progress === .5) await page.screenshot({ path: resolve(output, name + '-commutation.png') });
    }
  } finally {
    await page.evaluate(() => document.getElementById('circuit-board').getAnimations({ subtree: true }).forEach(animation => animation.play()));
  }
}

async function graphPivotMovie(page, label, name, edge) {
  await page.locator('#graph-board[data-animation-vertex]').waitFor();
  // The pivot consists of three full local-complementation stages.
  for (const [stage, phase] of [edge[0], edge[1], edge[0]].map(String).entries()) {
    await page.waitForFunction(vertex => document.getElementById('graph-board').dataset.animationVertex === vertex, phase);
    await graphContext(page, label + ' pivot vertex ' + phase);
    await page.waitForTimeout(350);
    await graphContext(page, label + ' travelling dots');
    if (stage === 1) await page.screenshot({ path: resolve(output, name + '-pivot-animation.png') });
  }
}

async function stableTutorialControls(page, label) {
  await page.mouse.move(0, 0); await frames(page);
  const box = await page.locator('#tutorial-next').boundingBox();
  assert.ok(box, label + ': Next has a visible hitbox');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - .25);
  const positions = await page.evaluate(() => new Promise(resolve => {
    const tops = [];
    const sample = () => {
      tops.push(document.getElementById('tutorial-next').getBoundingClientRect().top);
      if (tops.length < 6) requestAnimationFrame(sample); else resolve(tops);
    }; requestAnimationFrame(sample);
  }));
  assert.equal(new Set(positions).size, 1, label + ': hovering the button edge cannot make Next oscillate');
  await page.locator('#tutorial-next').focus(); await page.keyboard.press('Shift+Tab');
  assert.equal(await page.locator('#tutorial-start').evaluate(node => node === document.activeElement && node.matches(':focus-visible')), true,
    label + ': Restart has a visible keyboard focus ring');
  const focused = await bubbleGeometry(page, label + ' keyboard focus');
  const ring = await page.locator('#tutorial-start').evaluate(node => {
    const style = getComputedStyle(node);
    return Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset);
  });
  assert.ok(Object.values(focused.borderClearance[0]).every(gap => gap >= ring - .5),
    label + ': the complete Restart focus ring fits inside the scroll clip');
}

async function readOnlyScene(page, game, touch, label) {
  const snapshot = () => page.evaluate(() => {
    const attributes = ['data-cell', 'data-gate', 'data-filled', 'aria-pressed', 'transform', 'd', 'cx', 'cy'];
    const scene = [...document.querySelectorAll('#circuit-board, #categorical-board, #signal-board, #signal-flow, #graph-board, #zx-board')]
      .map(board => [board.id, [...board.querySelectorAll('[data-cell], [data-hole], [data-vertex], [data-edge], [data-zx-node], .signal-flow-path')]
        .map(node => attributes.map(name => node.getAttribute(name)))]);
    return { scene, history: document.getElementById('sequence')?.innerHTML,
      heading: document.getElementById('tutorial-heading').textContent,
      canvas: document.getElementById('sphere')?.toDataURL() };
  });
  const selector = game === 'quantum-golf' ? '#sphere' :
    game === 'circuit-reduction' ? '#categorical-board, #circuit-board' :
      game === 'quantum-signals' ? '#categorical-board, #signal-board, #signal-flow' : game === 'graph-states' ? '#graph-board' : '#zx-board';
  const scene = page.locator(selector).filter({ visible: true }).first();
  const before = await snapshot();
  const injected = await scene.evaluate(root => {
    const board = root.id === 'signal-flow' ? document.getElementById('signal-board') : root;
    const target = board.querySelector('button, [data-cell], [data-vertex], [data-node]') ?? board;
    const dispatch = event => { target.dispatchEvent(event); return event.defaultPrevented; };
    return {
      press: dispatch(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 91, clientX: 20, clientY: 20 })),
      click: dispatch(new MouseEvent('click', { bubbles: true, cancelable: true })),
      context: dispatch(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
      key: dispatch(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'h' })),
    };
  });
  assert.equal(injected.press, true, label + ': direct scene presses are blocked');
  assert.equal(injected.click, true, label + ': direct scene clicks are blocked');
  assert.equal(injected.context, true, label + ': context actions are blocked');
  assert.equal(injected.key, false, label + ': native keyboard actions are preserved');
  const point = await scene.evaluate(root => {
    const box = root.getBoundingClientRect();
    let leftEdge = Math.max(0, box.left), rightEdge = Math.min(innerWidth, box.right);
    let topEdge = Math.max(0, box.top), bottomEdge = Math.min(innerHeight, box.bottom);
    for (let node = root.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node), clip = node.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        leftEdge = Math.max(leftEdge, clip.left + node.clientLeft);
        rightEdge = Math.min(rightEdge, clip.left + node.clientLeft + node.clientWidth);
      }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        topEdge = Math.max(topEdge, clip.top + node.clientTop);
        bottomEdge = Math.min(bottomEdge, clip.top + node.clientTop + node.clientHeight);
      }
    }
    for (const x of [.1, .3, .5, .7, .9]) for (const y of [.1, .3, .5, .7, .9]) {
      const left = leftEdge + (rightEdge - leftEdge) * x, top = topEdge + (bottomEdge - topEdge) * y;
      const hit = document.elementFromPoint(left, top);
      if (left >= 12 && left + 30 < innerWidth && top >= 12 && top + 20 < innerHeight && root.contains(hit)) return { x: left, y: top };
    }
    return null;
  });
  assert.ok(point, label + ': part of the demonstrated scene remains visible');
  if (touch) {
    const input = await page.context().newCDPSession(page);
    await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await input.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + 30, y: point.y + 20 }] });
    await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await input.detach();
    // A read-only touch drag may scroll the page; finish that native gesture
    // before testing a button tap rather than using the tap to stop momentum.
    await scene.evaluate(root => {
      for (let node = root; node; node = node.parentElement) node.scrollTo?.({ left: node.scrollLeft, top: node.scrollTop, behavior: 'instant' });
      window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' });
    });
  } else {
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    await page.mouse.move(point.x + 30, point.y + 20, { steps: 4 }); await page.mouse.up();
  }
  await frames(page, 3);
  assert.deepEqual(await snapshot(), before, label + ': clicking, dragging and shortcuts cannot change the demonstration');
}

async function interruptedSignals(page, touch, label) {
  const playingPaths = async () => {
    await page.locator('#signal-flow[data-flow-animating]').waitFor({ state: 'attached' });
    assert.equal(await page.locator('.signals-game').getAttribute('data-signal-tutorial-view'), 'paths', label + ': each placed gate automatically reveals its path animation');
    assert.equal(await page.locator('#flow-panel').isVisible(), true, label + ': the path movie is visible while the gate is playing');
  };
  const reachPlacement = async () => {
    for (let step = 1; step <= SIGNAL_STEPS.findIndex(step => step.gate); step++) {
      await page.getByText(`Step ${step} of ${SIGNAL_STEPS.length}`, { exact: true }).waitFor();
      await activate(page.locator('#tutorial-next'), touch);
    }
  };
  await reachPlacement();
  await activate(page.locator('#tutorial-next'), touch);
  await playingPaths();
  await activate(page.locator('#tutorial-start'), touch);
  await page.getByText(`Step 1 of ${SIGNAL_STEPS.length}`, { exact: true }).waitFor();
  await frames(page);
  assert.equal(await page.locator('#sequence [data-step]').count(), 0, label + ': Restart clears the unfinished move');
  assert.equal(await page.locator('#signal-board [data-filled="true"]').count(), 0, label + ': Restart restores the initial empty circuit');
  await bubbleGeometry(page, label + ' restarted during animation');
  await reachPlacement();
  await page.getByText(`Step ${SIGNAL_STEPS.findIndex(step => step.gate) + 1} of ${SIGNAL_STEPS.length}`, { exact: true }).waitFor();
  await activate(page.locator('#tutorial-next'), touch);
  await playingPaths();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await frames(page);
  assert.equal(await page.locator('[data-tutorial-anchor], [data-tutorial-bubble]').count(), 0,
    label + ': cancelling an unfinished gate cannot reopen the bubble');
  assert.equal(await page.locator('#tutorial-panel').evaluate(node => node.matches(':popover-open')), false);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await bubbleGeometry(page, label + ' restored from page cache');
  const heading = await page.locator('#tutorial-heading').innerText();
  await activate(page.locator('#tutorial-next'), touch);
  await page.waitForFunction(text => document.getElementById('tutorial-heading').textContent !== text, heading);
  assert.doesNotMatch(await page.locator('#tutorial-text').innerText(), /failed/i);
  await bubbleGeometry(page, label + ' restored guide advances');
}

async function run([game, count, category], touch, fallback = false) {
  const name = [game, category, touch ? 'mobile' : 'desktop', fallback && 'fallback'].filter(Boolean).join('-');
  const context = await browser.newContext({ viewport: touch ? { width: Number(process.env.GAME_TUTORIAL_MOBILE_WIDTH ?? 390), height: 844 } : { width: 1440, height: 1050 },
    ...(touch ? { isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : {}), reducedMotion: 'no-preference' });
  if (fallback) await context.addInitScript(() => {
    for (const name of ['showPopover', 'hidePopover', 'togglePopover']) Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: undefined });
  });
  if (process.env.GAME_TUTORIAL_TRACE) await context.addInitScript(() => {
    window.testTutorialInputs = [];
    for (const type of ['pointerdown', 'pointerup', 'click', 'touchstart', 'touchend']) document.addEventListener(type, event => {
      queueMicrotask(() => {
        window.testTutorialInputs.push({ type, target: event.target.id || event.target.tagName, prevented: event.defaultPrevented });
        if (window.testTutorialInputs.length > 30) window.testTutorialInputs.shift();
      });
    }, true);
  });
  const page = await context.newPage();
  await page.bringToFront();
  page.setDefaultTimeout(12_000); page.setDefaultNavigationTimeout(20_000);
  page.on('pageerror', error => errors.push({ page: name, message: error.message }));
  await fixture.install(page);
  try {
    await page.goto(`${base}/games/${game}/${category ? '?category=' + category : ''}`);
    await page.locator('#tutorial-start:enabled').waitFor();
    assert.equal(await page.locator('#tutorial-panel[data-tutorial-bubble]').count(), 0, 'The introduction stays in the page');
    await activate(page.locator('#tutorial-start'), touch);
    await page.getByText(`Step 1 of ${count}`, { exact: true }).waitFor();
    await bubbleGeometry(page, name + ' first step');
    await activate(page.locator('#tutorial-start'), touch);
    await page.getByText(`Step 1 of ${count}`, { exact: true }).waitFor();
    for (let index = 0; index < count; index++) {
      const label = `${name} step ${index + 1}`;
      trace(label);
      await page.waitForFunction(text => document.getElementById('tutorial-heading').textContent === text, `Step ${index + 1} of ${count}`);
      const geometry = await bubbleGeometry(page, label);
      const referents = await page.locator('[data-tutorial-anchor]').evaluateAll(nodes => nodes.map(node => ({
        id: node.id, vertex: node.dataset.vertex, edge: node.dataset.edge,
        zxNode: node.closest('[data-zx-node]')?.dataset.zxNode,
        container: node.matches('#sphere, #circuit-board, #circuit-scroll, #categorical-board, #categorical-scroll, #signal-board, #signal-scroll, #signal-flow, #flow-panel, #graph-board, #zx-board'),
      })));
      assert.ok(referents.every(node => !node.container), label + ': an explanation never targets a whole board or scroll container');
      if (game === 'circuit-reduction' && !category && CIRCUIT_STEPS[index].target) {
        assert.equal(referents.length, 1, label + ': spacing actions point to their own control');
        assert.equal(await page.locator(CIRCUIT_STEPS[index].target).evaluate(node => node.hasAttribute('data-tutorial-anchor')), true,
          label + ': the bubble points to the action button');
        if (CIRCUIT_STEPS[index].move.rule === 'compact-identities') await uncovered(page, '#compact-identities', label + ' Tidy button');
      }
      if (game === 'quantum-golf') assert.deepEqual(referents.map(node => node.id), ['gate-' + GOLF_TUTORIAL.moves[index].gate.toLowerCase()]);
      if (game === 'zx-calculus') assert.deepEqual(referents.map(node => Number(node.zxNode)).sort((a, b) => a - b), [...ZX_TUTORIAL.solution[index].nodes].sort((a, b) => a - b));
      if (game === 'graph-states') {
        const move = GRAPH_TUTORIAL.steps[index].move;
        if (move.vertex !== undefined) assert.deepEqual(referents.map(node => Number(node.vertex)), [move.vertex]);
        else assert.deepEqual(referents.map(node => node.edge), [move.edge.join(':')]);
        await graphContext(page, label);
      }
      if (game === 'quantum-signals' && !category) {
        assert.equal(await page.locator('.signal-flow-wire-heading').count(), 0, 'The expanded paths have no wire-number heading');
        assert.equal(await page.locator('#signal-board .signal-wires text').count(), 0, 'Circuit wires have no number labels');
        if (SIGNAL_STEPS[index].chapter === 2) assert.equal(await page.locator('#signal-target').getAttribute('data-match'), 'false',
          'The last worked circuit has not reached its goal before the final action');
        if (index === 4) {
          const explanation = await page.locator('#tutorial-text').innerText();
          assert.match(explanation, /input bit 0, both keep its colour/);
          assert.match(explanation, /input bit 1, the lower branch swaps colour/);
        }
        if (SIGNAL_STEPS[index].chapter === 1 && SIGNAL_STEPS[index].gate === 'H') {
          const input = page.locator('#signal-flow .signal-flow-node[data-boundary="2"][data-basis="2"]');
          assert.equal(await input.getAttribute('data-phase'), '-', 'The second H example starts with the white branch prepared by Z');
          assert.equal(await input.evaluate(node => getComputedStyle(node).fill), 'rgb(255, 255, 255)');
          assert.match((await page.locator('#tutorial-text').innerText()).replace(/\s+/g, ' '), /apply.*again on the upper wire/);
          await uncovered(page, '#signal-flow .signal-flow-node[data-boundary="2"][data-basis="2"]', label + ' white input');
          await page.screenshot({ path: resolve(output, name + '-white-input.png') });
        }
        if (SIGNAL_STEPS[index].gate === 'XC') {
          const reversed = page.locator('#tutorial-text [data-gate="XC"]');
          assert.equal(await reversed.count(), 1, 'The explanation shows the reversed CNOT before placing it');
          assert.deepEqual(await reversed.locator('.tutorial-pair > .gate-glyph').evaluateAll(nodes => nodes.map(node => node.children.length)), [2, 1],
            'The reversed icon has its target above its control');
          await page.screenshot({ path: resolve(output, `${name}-reversed-cnot.png`) });
        }
        const expected = SIGNAL_STEPS[index].anchor;
        const actual = await page.locator('[data-tutorial-anchor]').evaluateAll(nodes => nodes.map(node => ({
          tag: node.tagName.toLowerCase(), basis: Number(node.dataset.basis ?? node.parentElement.dataset.basis),
          column: Number(node.dataset.column), fixed: node.classList.contains('signal-fixed'),
          wire: Number(node.dataset.wire), hole: node.dataset.hole, boundary: Number(node.dataset.boundary),
          wall: node.classList.contains('signal-flow-cancellation'), goal: node.classList.contains('signal-flow-target'),
        })));
        if (expected.kind === 'bits') {
          assert.ok(actual.every(node => node.tag === 'tspan' && node.basis === expected.basis));
          assert.deepEqual(actual.map(node => node.wire), expected.wires);
        } else if (expected.kind === 'gate') {
          if (expected.hole) assert.ok(actual.every(node => node.hole === expected.hole || node.tag === 'svg'));
          else assert.ok(actual.every(node => node.fixed && node.column === expected.column));
        }
        else if (expected.kind === 'goal') assert.equal(actual[0].goal, true);
        else if (expected.kind === 'memo') {
          const memo = page.locator('#signal-memo');
          assert.equal(await memo.locator('summary[data-tutorial-anchor]').count(), 1, 'The reminder points to the gate memo');
          assert.match(await page.locator('#tutorial-text').innerText(), /forget what a gate does/);
          await uncovered(page, '#signal-target .signal-flow-target', label + ' completed goal');
          const circuit = await page.locator('#signal-board').innerHTML();
          await activate(memo.locator('summary'), touch);
          assert.equal(await memo.evaluate(node => node.open), true, 'The reference can be opened during the cinematic tutorial');
          await bubbleGeometry(page, label + ' memo open');
          await uncovered(page, '#signal-memo-tabs', label + ' memo gates');
          await uncovered(page, '#signal-memo-map', label + ' memo circuits');
          assert.equal(await memo.locator('#signal-memo-black, #signal-memo-white').count(), 0, 'One reference diagram covers either input colour');
          await activate(memo.locator('[data-memo-choice="H"]'), touch);
          await bubbleGeometry(page, label + ' memo split paths');
          await uncovered(page, '#signal-memo-map', label + ' memo split circuits');
          await uncovered(page, '#signal-target .signal-flow-target', label + ' goal with memo open');
          assert.equal(await page.locator('#tutorial-panel .tutorial-pointer path').evaluate(tail =>
            tail.getBoundingClientRect().bottom <= document.getElementById('signal-memo-map').getBoundingClientRect().top), true,
          'The speech tail stops before the expanded reference paths');
          assert.equal(await memo.locator('.signal-memo-lane').count(), 2, 'The reference uses fixed basis lanes');
          assert.equal(await memo.locator('.signal-memo-node[data-role="output"]').count(), 2, 'The selected H input visibly splits into two output lanes');
          await activate(memo.locator('[data-memo-input="1"]'), touch);
          assert.equal(await memo.locator('[data-memo-input="1"]').getAttribute('aria-pressed'), 'true');
          assert.deepEqual(await memo.locator('.signal-memo-node[data-role="output"]').evaluateAll(nodes => nodes.map(node => node.dataset.colourSwap)), ['false', 'true']);
          assert.equal(await memo.locator('.signal-memo-paths .signal-memo-colour-swap[data-from="1"][data-to="1"][data-active="true"]').count(), 1,
            'The second H branch swaps colour when the input is 1');
          await page.screenshot({ path: resolve(output, name + '-memo-H.png') });
          const tabs = memo.locator('[role="tab"]');
          assert.deepEqual(await tabs.evaluateAll(nodes => nodes.map(node => node.dataset.memoChoice)), ['I', 'H', 'X', 'Z'],
            'The tutorial memo includes every one-wire gate although this hole only allows I and X');
          await activate(tabs.last(), touch);
          assert.equal(await tabs.last().getAttribute('aria-selected'), 'true', 'A reference gate remains usable even when the puzzle does not offer it');
          await activate(tabs.first(), touch);
          assert.equal(await tabs.first().getAttribute('aria-selected'), 'true');
          if (!touch) {
            await tabs.first().focus(); await page.keyboard.press('End');
            assert.equal(await tabs.last().getAttribute('aria-selected'), 'true', 'Tutorial keyboard capture preserves memo navigation');
            await page.keyboard.press('Home');
            assert.equal(await tabs.first().getAttribute('aria-selected'), 'true');
            await page.keyboard.press('r');
          }
          assert.equal(await page.locator('#signal-board').innerHTML(), circuit, 'Reading a map cannot change the demonstration');
          assert.equal(await page.locator('#tutorial-heading').innerText(), `Step ${index + 1} of ${count}`);
          await accessibility(page);
          await page.screenshot({ path: resolve(output, name + '-memo.png') });
          await activate(memo.locator('summary'), touch);
          await bubbleGeometry(page, label + ' memo closed');
        }
        else {
          const expectedBases = SIGNAL_STEPS[index].focus.phase && expected.kind === 'node' ? SIGNAL_STEPS[index].focus.bases ?? [expected.basis] : [expected.basis];
          assert.deepEqual(actual.map(node => node.basis).sort((a, b) => a - b), [...expectedBases].sort((a, b) => a - b));
          assert.ok(actual.every(node => node.boundary === expected.boundary && node.wall === (expected.kind === 'wall')));
          if (expected.kind === 'node') {
            const speaker = await page.locator(`#signal-flow .signal-flow-node[data-basis="${expected.basis}"][data-boundary="${expected.boundary}"]`).boundingBox();
            const { x, y } = geometry.connector;
            const distance = Math.hypot(Math.max(speaker.x - x, 0, x - speaker.x - speaker.width),
              Math.max(speaker.y - y, 0, y - speaker.y - speaker.height));
            assert.ok(distance <= 6, label + ': the tail points to the amplitude being explained');
          }
        }
        if (index === 0) await uncovered(page, '#signal-target .signal-flow-target', label + ' goal');
        if (expected.kind === 'wall') await uncovered(page, '#signal-flow .signal-flow-node[data-boundary="3"][data-basis="2"]', label + ' surviving path');
        if (index === 1) {
          const explanation = await page.locator('#tutorial-text').innerText();
          assert.match(explanation, /10 instead of 00/);
          assert.equal(await page.locator('#signal-board [data-filled="true"]').count(), 1);
          assert.equal(await page.locator('#signal-flow .signal-flow-node[data-boundary="1"][data-basis="0"]').count(), 0);
          await page.waitForTimeout(1400);
          assert.equal(await page.locator('#tutorial-heading').innerText(), `Step 2 of ${count}`, 'The result waits for Next instead of disappearing after the animation');
          assert.equal(await page.locator('#tutorial-text').innerText(), explanation);
          await page.screenshot({ path: resolve(output, `${name}-first-not-result.png`) });
        }
      }
      if (game === 'circuit-reduction' && !category && index === 0) {
        assert.deepEqual(await page.locator('[data-tutorial-anchor]').evaluateAll(nodes => nodes.map(node => node.closest('[data-cell]')?.dataset.cell)), ['0:0', '0:1'],
          'The first Circuit simplification bubble refers to both initial X gates');
        assert.ok(await page.locator('[data-tutorial-anchor]').evaluateAll(nodes => nodes.every(node => node.classList.contains('gate-glyph'))),
          'The referents are the gate drawings, not their scroll container');
      }
      if (game === 'quantum-signals' && !category && touch) {
        const view = SIGNAL_STEPS[index].view;
        assert.equal(await page.locator('.signals-game').getAttribute('data-signal-tutorial-view'), view,
          label + ': the demonstration automatically reveals its relevant view');
        assert.equal(await page.locator('#signal-scroll').isVisible(), view === 'circuit');
        assert.equal(await page.locator('#flow-panel').isVisible(), view === 'paths');
        assert.equal(await page.locator('[data-tutorial-view]').count(), 0, 'The viewer progresses with Next without changing tutorial views manually');
      }
      if (index === 0) {
        await accessibility(page);
        await page.screenshot({ path: resolve(output, name + '-first.png') });
        await page.evaluate(() => {
          const anchor = document.querySelector('[data-tutorial-anchor]').getBoundingClientRect();
          window.scrollBy({ top: anchor.top < innerHeight / 2 ? -24 : 24, behavior: 'instant' });
        });
        await page.waitForTimeout(80); await bubbleGeometry(page, label + ' after page scroll');
        const size = page.viewportSize();
        await page.setViewportSize({ width: touch ? 320 : 1000, height: touch ? 780 : 900 });
        await page.waitForTimeout(80); await bubbleGeometry(page, label + ' after resize');
        await page.setViewportSize(size); await page.waitForTimeout(80);
        if (!touch) await stableTutorialControls(page, label);
      }
      if (game === 'quantum-signals' && !category && (SIGNAL_STEPS[index].focus.toBases?.length || SIGNAL_STEPS[index].gate === 'CZ') ||
        game === 'graph-states' && index === count - 1) {
        await page.screenshot({ path: resolve(output, `${name}-step-${index + 1}.png`) });
      }
      const nextButton = page.locator('#tutorial-next');
      if (fallback && index === 0) { await nextButton.focus(); await page.keyboard.press('Enter'); }
      else await activate(nextButton, touch);
      trace(label + ' Next sent');
      await frames(page, 1);
      const during = await page.evaluate(() => {
        const panel = document.getElementById('tutorial-panel');
        return { visible: !panel.hidden && getComputedStyle(panel).visibility !== 'hidden' };
      });
      assert.ok(during.visible, label + ': explanation stays visible through the move');
      if (game === 'circuit-reduction' && !category && CIRCUIT_STEPS[index].move.rule === 'phase-up')
        await circuitCommutationMovie(page, label, name);
      if (game === 'graph-states' && index === count - 1) await graphPivotMovie(page, label, name, GRAPH_TUTORIAL.steps[index].move.edge);
      const next = index + 1 === count ? 'Tutorial complete' : `Step ${index + 2} of ${count}`;
      await page.waitForFunction(text => document.getElementById('tutorial-heading').textContent === text, next, { timeout: 20_000 });
      if (game === 'quantum-signals' && !category && SIGNAL_STEPS[index].chapter === 2)
        assert.equal(await page.locator('#signal-target').getAttribute('data-match'), String(index === count - 1),
          'Only the final action reaches the last example’s goal');
    }
    trace(name + ' example complete');
    assert.equal(await page.locator('#tutorial-panel[data-tutorial-bubble]').count(), 0, 'Completion returns to the page');
    assert.equal(await page.locator('[data-tutorial-anchor], [data-tutorial-focus]').count(), 0);
    assert.equal(await page.locator('#win-dialog[open]').count(), 0, 'The guided example has no competing win dialog');
    const completion = await page.locator('#tutorial-levels').evaluate(node => {
      const { top, bottom, left, right } = node.getBoundingClientRect();
      return { top, bottom, left, right, height: innerHeight, width: innerWidth, scrollY };
    });
    assert.ok(completion.top >= 0 && completion.bottom <= completion.height && completion.left >= 0 && completion.right <= completion.width,
      name + ': completion offers Play levels without auto-scrolling a test locator: ' + JSON.stringify(completion));
    await accessibility(page);
    trace(name + ' completion accessibility passed');
    await activate(page.locator('#tutorial-levels'), touch); await clean(page, name + ' completion');
    trace(name + ' Levels cleanup passed');
    await activate(page.locator('#mode-tutorial'), touch); await activate(page.locator('#tutorial-start'), touch);
    await bubbleGeometry(page, name + ' reenter');
    await activate(page.locator('#tutorial-close'), touch); await clean(page, name + ' close');
    trace(name + ' Close cleanup passed');
    await activate(page.locator('#mode-tutorial'), touch); await activate(page.locator('#tutorial-start'), touch);
    await bubbleGeometry(page, name + ' reenter after close');
    await activate(page.locator('#mode-random'), touch); await clean(page, name + ' mode switch');
    trace(name + ' mode cleanup passed');
    await activate(page.locator('#mode-tutorial'), touch); await activate(page.locator('#tutorial-start'), touch);
    if (game === 'quantum-signals' && !category) await interruptedSignals(page, touch, name);
    await bubbleGeometry(page, name + ' before page hide');
    await readOnlyScene(page, game, touch, name + ' read-only scene');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    assert.equal(await page.locator('[data-tutorial-anchor], [data-tutorial-bubble]').count(), 0, name + ': page hide removes floating state');
    assert.equal(await page.locator('#tutorial-panel').evaluate(node => node.matches(':popover-open')), false);
    reports.push({ name, steps: count, fallback, completion, passed: true });
    console.log(`${name}: ${count} steps, read-only scenes, Next/Restart, anchors/arrows, scroll/resize, accessibility and cleanup passed.`);
  } catch (error) {
    if (process.env.GAME_TUTORIAL_TRACE) console.error(await page.evaluate(() => ({
      inputs: window.testTutorialInputs, heading: document.getElementById('tutorial-heading')?.textContent,
      nextDisabled: document.getElementById('tutorial-next')?.disabled,
    })).catch(() => 'The page stopped responding.'));
    await page.screenshot({ path: resolve(output, name + '-failure.png'), timeout: 5_000 }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}

try {
  const requested = process.env.GAME_TUTORIAL_ONLY?.split(',');
  const selected = requested ? games.filter(([game, , category]) =>
    requested.includes([game, category].filter(Boolean).join('-'))) : games;
  assert.ok(selected.length, 'Choose an existing tutorial configuration');
  for (const game of selected) for (const touch of [false, true]) await run(game, touch);
  if (selected.some(([game]) => game === 'quantum-golf')) await run(games[0], true, true);
  assert.deepEqual(errors, [], 'No uncaught tutorial errors');
  await writeFile(resolve(output, 'report.json'), JSON.stringify(reports, null, 2) + '\n');
} finally { await browser.close(); }
