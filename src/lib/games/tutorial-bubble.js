import { placeTutorialBubble, unionTutorialRects, tutorialSpeechTail } from './tutorial-placement.js';

/** One nonmodal callout, measured only when its content or surroundings change.
 * Anchors are elements or element arrays. { element, rect, preferredSide } can
 * pinpoint a part of a larger hitbox, such as an edge's midpoint. `avoid` lists
 * the elements or rectangles that must stay clear during the demonstration.
 */
export function createTutorialBubble(panel, getAnchor) {
  const view = panel.ownerDocument?.defaultView;
  if (!view) return { update() {}, hide() {}, reposition() {}, reveal() {} };
  const native = typeof panel.showPopover === 'function';
  const menu = panel.closest?.('.game-layout')?.querySelector('.mode-menu');
  let active = false, frame = 0, pointer = null, revealPending = false;
  const anchors = new Map();
  const observer = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(schedule) : null;
  function mark(next) {
    const keep = new Set(next);
    for (const [element, description] of anchors) if (!keep.has(element)) {
      element.removeAttribute('data-tutorial-anchor');
      if (description === null) element.removeAttribute('aria-describedby');
      else element.setAttribute('aria-describedby', description);
      observer?.unobserve(element); anchors.delete(element);
    }
    for (const element of keep) if (!anchors.has(element)) {
      const description = element.getAttribute('aria-describedby');
      anchors.set(element, description);
      element.setAttribute('aria-describedby', [description, 'tutorial-text'].filter(Boolean).join(' '));
      element.setAttribute('data-tutorial-anchor', ''); observer?.observe(element);
    }
  }
  function position() {
    frame = 0;
    if (!active) return;
    const referent = getAnchor();
    const elements = Array.isArray(referent) ? referent : referent?.elements ?? [referent?.element ?? referent];
    mark(elements.filter(element => element?.getBoundingClientRect));
    const viewport = view.visualViewport;
    const bounds = { left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0,
      width: viewport?.width ?? view.innerWidth, height: viewport?.height ?? view.innerHeight };
    panel.style.setProperty('--tutorial-width', `${Math.max(1, bounds.width - 24)}px`);
    panel.style.setProperty('--tutorial-height', `${Math.max(1, bounds.height - 24)}px`);
    if (native && !panel.matches(':popover-open')) panel.showPopover();
    const centerX = bounds.left + bounds.width / 2, centerY = bounds.top + bounds.height / 2;
    const targets = [...anchors.keys()].map(element => element.getBoundingClientRect());
    const rect = unionTutorialRects(referent?.rect ? [referent.rect] : targets) ??
      { left: centerX, right: centerX, top: centerY, bottom: centerY, width: 0, height: 0 };
    const size = panel.getBoundingClientRect();
    const avoid = (referent?.avoid ?? []).map(element => element.getBoundingClientRect?.() ?? element);
    let placement = placeTutorialBubble(rect, size, bounds, { preferredSide: referent?.preferredSide, avoid });
    const overlaps = (position, box) => position.left < box.right && position.left + size.width > box.left &&
      position.top < box.bottom && position.top + size.height > box.top;
    const navigation = menu?.getBoundingClientRect();
    if (navigation && overlaps(placement, navigation)) {
      const alternative = placeTutorialBubble(rect, size, bounds, { preferredSide: referent?.preferredSide, avoid: [...avoid, navigation] });
      if (![rect, ...avoid, navigation].some(box => overlaps(alternative, box))) placement = alternative;
    }
    if (revealPending) {
      revealPending = false;
      if (avoid.length) {
        const context = unionTutorialRects([rect, ...avoid]);
        const side = ['above', 'below'].includes(referent?.preferredSide) ? referent.preferredSide :
          rect.top + rect.height / 2 < context.top + context.height / 2 ? 'above' : 'below';
        const free = side === 'above' ? context.top - bounds.top - 12 : bounds.top + bounds.height - context.bottom - 12;
        const visible = context.top >= bounds.top + 12 && context.bottom <= bounds.top + bounds.height - 12;
        // Leave room for page scrolling to round to device pixels instead of landing just outside a strict fit.
        const headroom = 2;
        if (context.height + size.height + 36 + headroom <= bounds.height &&
          (!visible || overlaps(placement, context) || referent?.preferredSide === side && free < size.height + 12)) {
          const targetTop = side === 'above' ? bounds.top + size.height + 24 + headroom :
            bounds.top + bounds.height - context.height - size.height - 24 - headroom;
          const shift = context.top - targetTop;
          if (Math.abs(shift) > .5) { view.scrollBy({ top: shift, behavior: 'instant' }); schedule(); return; }
        }
      }
    }
    panel.style.left = `${placement.left}px`; panel.style.top = `${placement.top}px`;
    panel.dataset.placement = placement.side;
    {
      if (!pointer) {
        pointer = panel.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
        pointer.setAttribute('class', 'tutorial-pointer'); pointer.setAttribute('aria-hidden', 'true');
        pointer.append(panel.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path'),
          panel.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'line'));
        panel.append(pointer);
      }
      const distance = target => Math.hypot(Math.max(placement.left - target.right, 0, target.left - placement.left - size.width),
        Math.max(placement.top - target.bottom, 0, target.top - placement.top - size.height));
      const speaker = referent?.rect || !targets.length ? rect : targets.reduce((nearest, target) => distance(target) < distance(nearest) ? target : nearest);
      const tail = tutorialSpeechTail(speaker, size, placement, bounds);
      pointer.firstElementChild.setAttribute('d', tail.path);
      for (const [key, value] of Object.entries(tail.base)) pointer.lastElementChild.setAttribute(key, String(value));
    }
    pointer.style.display = '';
    panel.style.visibility = '';
  }
  function schedule() {
    if (active && !frame) frame = view.requestAnimationFrame(position);
  }
  function listen(method) {
    view[method]('scroll', schedule, true); view[method]('resize', schedule);
    view.visualViewport?.[method]('scroll', schedule); view.visualViewport?.[method]('resize', schedule);
  }
  function hide() {
    if (!active) return;
    active = false; revealPending = false; view.cancelAnimationFrame(frame); frame = 0;
    listen('removeEventListener'); observer?.disconnect(); mark([]);
    if (native && panel.matches(':popover-open')) panel.hidePopover();
    panel.removeAttribute('popover'); delete panel.dataset.tutorialBubble; delete panel.dataset.placement;
    if (pointer) pointer.style.display = 'none';
    panel.removeAttribute('role'); panel.removeAttribute('aria-describedby');
    for (const property of ['left', 'top', 'visibility', '--tutorial-width', '--tutorial-height']) panel.style.removeProperty(property);
  }
  return {
    update(visible) {
      if (!visible) { hide(); return; }
      if (!active) {
        active = true; panel.dataset.tutorialBubble = ''; panel.style.visibility = 'hidden';
        panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-describedby', 'tutorial-text');
        if (native) panel.setAttribute('popover', 'manual');
        listen('addEventListener'); observer?.observe(panel);
      }
      schedule();
    },
    hide, reposition: schedule, reveal() { revealPending = true; schedule(); },
  };
}
