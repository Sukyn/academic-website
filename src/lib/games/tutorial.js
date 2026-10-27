import { createTutorialBubble } from './tutorial-bubble.js';
import { unionTutorialRects } from './tutorial-placement.js';

/** A worked example. Games own the moves; this guide owns their order.
 * Each step has text, a target selector, an optional selection/layout preparation
 * and an action that may return an animation promise. Returning false cancels a step.
 */
export function createTutorial({ get, steps, onReset, controls, onLeave = () => {}, isBlocked = () => false,
  onRender = () => {}, revealTarget = null, getAnchor = (focus, step) => typeof step.anchor === 'function' ? step.anchor() : step.anchor ? document.querySelector(step.anchor) : focus,
  renderText = (node, text) => { node.textContent = text; },
  intro = 'Next step plays the demonstration. Restart returns to the beginning.' }) {
  let active = false, executing = false, index = -1, revision = 0, focus = null, failed = false;
  let renderedText;
  const panel = get('tutorial-panel'), startButton = get('tutorial-start'), nextButton = get('tutorial-next');
  const content = panel.closest('.game-content');
  const locked = new Map();
  const anchor = () => {
    const step = steps[index];
    return step ? getAnchor(focus ?? document.querySelector(step.target), step) : null;
  };
  const bubble = createTutorialBubble(panel, anchor);
  const finished = () => active && index === steps.length;
  const currentStep = () => active && !executing && !failed && !isBlocked() ? steps[index] : null;

  function clearFocus() {
    focus?.removeAttribute('data-tutorial-focus'); focus = null;
  }
  function unlock() {
    for (const [control, disabled] of locked) control.disabled = disabled;
    locked.clear();
  }
  function render() {
    panel.hidden = !active;
    content?.toggleAttribute('data-tutorial-demo', active);
    clearFocus();
    if (!active) { bubble.hide(); onRender(null); return; }
    for (const control of locked.keys()) if (control.isConnected === false) locked.delete(control);
    for (const control of document.querySelectorAll(controls)) {
      if (!locked.has(control)) locked.set(control, control.disabled);
      control.disabled = true;
    }
    const done = finished();
    get('tutorial-heading').textContent = done ? 'Tutorial complete' : index < 0 ? 'Guided demonstration' : `Step ${index + 1} of ${steps.length}`;
    const text = failed ? 'Step failed. Restart the tutorial.' : done ? '' : index < 0 ? intro : steps[index].text;
    if (text !== renderedText) { renderText(get('tutorial-text'), text); renderedText = text; }
    startButton.textContent = index < 0 ? 'Start tutorial' : 'Restart tutorial';
    const blocked = executing || isBlocked();
    startButton.disabled = isBlocked() && !executing;
    nextButton.hidden = index < 0 || done || failed;
    nextButton.disabled = blocked;
    get('tutorial-levels').hidden = !done;
    get('tutorial-close').hidden = index < 0 || done;
    const step = currentStep();
    if (step) {
      focus = document.querySelector(step.target);
      if (focus && !focus.closest('#tutorial-panel')) focus.setAttribute('data-tutorial-focus', '');
    }
    onRender(focus);
    bubble.update(index >= 0 && !done);
  }
  function leave() {
    revision++; active = false; executing = false; clearFocus(); unlock(); onLeave(); render();
  }
  function reset(nextIndex) {
    revision++; unlock(); onLeave(); active = true; index = nextIndex; failed = false; executing = true;
    try { onReset(); steps[index]?.prepare?.(); }
    finally { executing = false; render(); }
  }
  function reveal() {
    if (!focus) {
      if (finished()) panel.scrollIntoView?.({ block: 'nearest' });
      return;
    }
    if (revealTarget) revealTarget(focus);
    else {
      const referent = anchor(), elements = Array.isArray(referent) ? referent : referent?.elements ?? [referent?.element ?? referent];
      const target = elements[0];
      (target?.scrollIntoView ? target : focus).scrollIntoView?.({ block: 'center', inline: 'nearest' });
      const view = target?.ownerDocument?.defaultView;
      if (view && elements.length > 1) {
        for (let scroller = target.parentElement; scroller; scroller = scroller.parentElement) {
          if (scroller.scrollWidth <= scroller.clientWidth || !elements.every(element => scroller.contains(element)) ||
            !/(auto|scroll)/.test(view.getComputedStyle(scroller).overflowX)) continue;
          const group = unionTutorialRects(elements.map(element => element.getBoundingClientRect()));
          const left = scroller.getBoundingClientRect().left + scroller.clientLeft, right = left + scroller.clientWidth;
          if (group.left < left || group.right > right) scroller.scrollLeft += (group.left + group.right - left - right) / 2;
          break;
        }
      }
    }
    bubble.reveal();
  }
  function enter() { reset(-1); }
  function start() {
    if (!active || isBlocked() && !executing) return;
    reset(0); reveal();
  }
  async function next() {
    const step = currentStep();
    if (!step) return;
    const current = revision;
    executing = true; render();
    try {
      const completed = await step.action();
      if (!active || current !== revision || completed === false) return;
      index++; steps[index]?.prepare?.();
    } catch {
      if (current === revision) failed = true;
    } finally {
      if (active && current === revision) { executing = false; render(); reveal(); }
    }
  }
  startButton.addEventListener('click', start);
  nextButton.addEventListener('click', next);
  get('tutorial-levels').addEventListener('click', () => get('mode-campaign').click());
  get('tutorial-close').addEventListener('click', () => get('mode-campaign').click());
  const view = panel.ownerDocument?.defaultView;
  view?.addEventListener('pagehide', () => {
    revision++; executing = false; clearFocus(); bubble.hide();
  });
  view?.addEventListener('pageshow', event => {
    if (event.persisted && active) { render(); reveal(); }
  });
  // The guide calls game actions directly; viewer input never changes the example.
  function blockPlay(event) {
    if (!active || event.target.closest?.('#tutorial-panel')) return;
    const selector = event.type === 'wheel' ? 'canvas' : controls + ', canvas';
    if (!event.target.closest?.(selector)) return;
    if (event.type !== 'wheel') event.preventDefault();
    event.stopImmediatePropagation();
  }
  for (const type of ['pointerdown', 'pointermove', 'click', 'contextmenu', 'wheel']) document.addEventListener(type, blockPlay, true);
  document.addEventListener('keydown', event => {
    if (!active) return;
    // Reference tabs stay usable without exposing the game's keyboard shortcuts.
    const referenceTab = ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) &&
      event.target.closest?.('[role="tablist"]') && !event.target.closest?.(controls);
    if (!referenceTab) event.stopImmediatePropagation();
  }, true);
  return { get active() { return active; }, get executing() { return executing; }, get finished() { return finished(); },
    enter, leave, render, start, next, reposition: bubble.reposition, reveal: bubble.reveal };
}
