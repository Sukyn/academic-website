/** A fixed worked example. Games own the moves; this guide owns their order.
 * Each step has text, a target selector, an optional selection/layout preparation
 * and an action that may return an animation promise.
 */
export function createTutorial({ get, steps, onReset, controls, onLeave = () => {}, isBlocked = () => false,
  intro = 'Choose the highlighted control or Next step.' }) {
  let active = false, executing = false, index = -1, revision = 0, focus = null, failed = false;
  const panel = get('tutorial-panel'), startButton = get('tutorial-start'), nextButton = get('tutorial-next');
  const locked = new Map();
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
    clearFocus();
    if (!active) return;
    for (const control of locked.keys()) if (control.isConnected === false) locked.delete(control);
    for (const control of document.querySelectorAll(controls)) {
      if (!locked.has(control)) locked.set(control, control.disabled);
      control.disabled = true;
    }
    const done = finished();
    get('tutorial-heading').textContent = done ? 'Tutorial complete' : index < 0 ? 'Guided example' : `Step ${index + 1} of ${steps.length}`;
    get('tutorial-text').textContent = failed ? 'Step failed. Restart the tutorial.' :
      done ? '' : index < 0 ? intro : steps[index].text;
    startButton.textContent = index < 0 ? 'Start tutorial' : 'Restart tutorial';
    const blocked = executing || isBlocked();
    startButton.disabled = blocked;
    nextButton.hidden = index < 0 || done || failed;
    nextButton.disabled = blocked;
    get('tutorial-levels').hidden = !done;
    const step = currentStep();
    if (step) {
      focus = document.querySelector(step.target);
      if (focus) { focus.disabled = false; focus.setAttribute('data-tutorial-focus', ''); }
    }
  }
  function leave() {
    revision++; active = false; executing = false; clearFocus(); unlock(); onLeave(); render();
  }
  function reset(nextIndex) {
    revision++; unlock(); onLeave(); active = true; index = nextIndex; failed = false; executing = true;
    try { onReset(); steps[index]?.prepare?.(); }
    finally { executing = false; render(); }
  }
  function reveal() { focus?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }
  function enter() { reset(-1); }
  function start() {
    if (!active || executing || isBlocked()) return;
    reset(0); reveal();
  }
  async function next() {
    const step = currentStep();
    if (!step) return;
    const current = revision;
    executing = true; render();
    try {
      await step.action();
      if (!active || current !== revision) return;
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
  // Capture before the game's normal handler, so the same click cannot play twice.
  document.addEventListener('click', event => {
    const step = currentStep();
    if (!step || !event.target.closest?.(step.target)) return;
    event.preventDefault(); event.stopImmediatePropagation(); void next();
  }, true);
  return { get active() { return active; }, get executing() { return executing; }, get finished() { return finished(); },
    enter, leave, render, start, next };
}
