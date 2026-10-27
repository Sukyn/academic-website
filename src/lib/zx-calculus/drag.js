const MINIMUM = 36, MAX_X = 2400, MAX_Y = 1600, THRESHOLD = 5;
const clamp = (value, maximum) => Math.max(MINIMUM, Math.min(maximum, value));

/** Drag layout positions without changing the diagram or rebuilding its DOM. */
export function bindNodeDragging(container, { canDrag = () => true, getPosition, onMove, onEnd = () => {} }) {
  const doc = container.ownerDocument, view = doc.defaultView;
  let gesture = null, frame = null, suppressClick = null, disposed = false;

  function stopFrame() {
    if (frame !== null) view.cancelAnimationFrame(frame);
    frame = null;
  }
  function finish(cancelled) {
    const current = gesture;
    if (!current) return;
    gesture = null; stopFrame();
    try {
      if (current.button.hasPointerCapture?.(current.pointer)) current.button.releasePointerCapture(current.pointer);
    } catch { /* A replaced node may already have lost its pointer capture. */ }
    if (current.dragging) onEnd(current.id, { cancelled });
  }
  function flush(current) {
    if (gesture !== current || !current.pending) return;
    if (!canDrag(current.id)) { finish(true); return; }
    const point = current.pending; current.pending = null;
    try { onMove(current.id, point); }
    catch (error) { finish(true); throw error; }
  }
  function point(current, event) {
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
    return {
      x: clamp(current.origin.x + (event.clientX - current.x) * current.scaleX, MAX_X),
      y: clamp(current.origin.y + (event.clientY - current.y) * current.scaleY, MAX_Y),
    };
  }
  function down(event) {
    if (disposed || gesture) return;
    suppressClick = null;
    if (event.button !== 0 || event.isPrimary === false || doc.hidden) return;
    const button = event.target.closest?.('[data-node]');
    if (!button || !container.contains(button) || button.disabled) return;
    const id = Number(button.dataset.node);
    if (!Number.isInteger(id) || !canDrag(id)) return;
    const origin = getPosition(id), svg = container.querySelector('.zx-svg');
    const box = svg?.viewBox?.baseVal, bounds = svg?.getBoundingClientRect();
    if (!origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y) ||
        !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY) ||
        !box || ![box.width, box.height, bounds?.width, bounds?.height].every(value => Number.isFinite(value) && value > 0)) return;
    gesture = { id, button, pointer: event.pointerId, x: event.clientX, y: event.clientY,
      origin: { ...origin }, scaleX: box.width / bounds.width, scaleY: box.height / bounds.height, dragging: false, pending: null };
    // Capture the button itself so an ordinary click still selects that node.
    try { button.setPointerCapture(event.pointerId); }
    catch { gesture = null; }
  }
  function move(event) {
    const current = gesture;
    if (!current || event.pointerId !== current.pointer) return;
    if (!canDrag(current.id)) { finish(true); return; }
    const next = point(current, event);
    if (!next) return;
    if (!current.dragging) {
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < THRESHOLD) return;
      current.dragging = true; suppressClick = { pointer: current.pointer };
    }
    event.preventDefault(); current.pending = next;
    if (frame === null) frame = view.requestAnimationFrame(() => {
      if (gesture !== current) return;
      frame = null; flush(current);
    });
  }
  function up(event) {
    const current = gesture;
    if (!current || event.pointerId !== current.pointer) return;
    if (current.dragging) {
      event.preventDefault(); current.pending = point(current, event) ?? current.pending;
      stopFrame(); flush(current);
    }
    if (gesture === current) finish(false);
  }
  function lost(event) { if (event.pointerId === gesture?.pointer) finish(true); }
  function click(event) {
    // Keyboard/programmatic activation must remain available after a drag.
    if (!suppressClick || event.detail === 0 ||
        (event.pointerId !== undefined && event.pointerId !== suppressClick.pointer)) return;
    suppressClick = null; event.preventDefault(); event.stopImmediatePropagation();
  }
  const cancel = () => finish(true);
  const hidden = () => { if (doc.hidden) cancel(); };
  const handlers = { pointerdown: down, pointermove: move, pointerup: up, pointercancel: lost, lostpointercapture: lost };
  for (const [type, handler] of Object.entries(handlers)) container.addEventListener(type, handler);
  container.addEventListener('click', click, true);
  view.addEventListener('blur', cancel); view.addEventListener('resize', cancel);
  doc.addEventListener('visibilitychange', hidden);
  return {
    cancel,
    dispose() {
      if (disposed) return;
      disposed = true; cancel(); suppressClick = null;
      for (const [type, handler] of Object.entries(handlers)) container.removeEventListener(type, handler);
      container.removeEventListener('click', click, true);
      view.removeEventListener('blur', cancel); view.removeEventListener('resize', cancel);
      doc.removeEventListener('visibilitychange', hidden);
    },
    get active() { return Boolean(gesture?.dragging); },
  };
}
