const SIDES = ['above', 'below', 'left', 'right'];
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

function rect(input = {}) {
  const left = finite(input.left), top = finite(input.top);
  const width = Math.max(0, finite(input.width)), height = Math.max(0, finite(input.height));
  return { left, top, width, height, right: left + width, bottom: top + height };
}

export function unionTutorialRects(rectangles) {
  if (!rectangles.length) return null;
  const boxes = rectangles.map(rect);
  const left = Math.min(...boxes.map(box => box.left)), top = Math.min(...boxes.map(box => box.top));
  const right = Math.max(...boxes.map(box => box.right)), bottom = Math.max(...boxes.map(box => box.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/** Place a fixed bubble next to the visible part of its referent.
 * Arrow is an offset along the bubble edge: x for above/below, y for left/right.
 * Oversized bubbles stay at the viewport origin; their size must be limited by CSS.
 */
export function placeTutorialBubble(anchor, bubble, viewport, { gap = 12, padding = 12, preferredSide, avoid = [] } = {}) {
  const view = rect(viewport), source = rect(anchor), size = rect(bubble);
  gap = Math.max(0, finite(gap, 12)); padding = Math.max(0, finite(padding, 12));
  const visible = source => ({
    left: clamp(source.left, view.left, view.right), right: clamp(source.right, view.left, view.right),
    top: clamp(source.top, view.top, view.bottom), bottom: clamp(source.bottom, view.top, view.bottom),
  });
  const reference = visible(source);
  const context = avoid.length ? visible(unionTutorialRects([source, ...avoid])) : reference;
  const centerX = (reference.left + reference.right) / 2, centerY = (reference.top + reference.bottom) / 2;
  // Relax the inset in a tiny viewport rather than pushing a fitting bubble out.
  const insetX = Math.min(padding, Math.max(0, (view.width - size.width) / 2));
  const insetY = Math.min(padding, Math.max(0, (view.height - size.height) / 2));
  const left = view.left + insetX, right = view.right - insetX;
  const top = view.top + insetY, bottom = view.bottom - insetY;
  const centeredX = clamp(centerX - size.width / 2, left, right - size.width);
  const centeredY = clamp(centerY - size.height / 2, top, bottom - size.height);
  const candidates = {
    above: { left: centeredX, top: context.top - gap - size.height },
    below: { left: centeredX, top: context.bottom + gap },
    left: { left: context.left - gap - size.width, top: centeredY },
    right: { left: context.right + gap, top: centeredY },
  };
  const order = view.width < 640 ? ['below', 'above', 'right', 'left'] : ['right', 'left', 'below', 'above'];
  if (SIDES.includes(preferredSide)) {
    order.splice(order.indexOf(preferredSide), 1); order.unshift(preferredSide);
  }
  if (avoid.length) {
    const distance = candidate => Math.hypot(centerX - clamp(centerX, candidate.left, candidate.left + size.width),
      centerY - clamp(centerY, candidate.top, candidate.top + size.height));
    order.sort((first, second) => distance(candidates[first]) - distance(candidates[second]));
  }
  const fits = candidate => candidate.left >= left && candidate.top >= top &&
    candidate.left + size.width <= right && candidate.top + size.height <= bottom;
  const overlap = (candidate, bounds) =>
    Math.max(0, Math.min(candidate.left + size.width, bounds.right) - Math.max(candidate.left, bounds.left)) *
    Math.max(0, Math.min(candidate.top + size.height, bounds.bottom) - Math.max(candidate.top, bounds.top));
  let side = order.find(name => fits(candidates[name]));
  if (!side) {
    // Keep the bubble visible while obscuring as little of its referent as possible.
    let bestOverlap = Infinity, bestShift = Infinity;
    for (const name of order) {
      const candidate = candidates[name], x = clamp(candidate.left, left, right - size.width);
      const y = clamp(candidate.top, top, bottom - size.height);
      const covered = overlap({ left: x, top: y }, context);
      const shift = Math.abs(x - candidate.left) + Math.abs(y - candidate.top);
      if (covered < bestOverlap || covered === bestOverlap && shift < bestShift) {
        side = name; bestOverlap = covered; bestShift = shift;
      }
    }
  }
  const candidate = candidates[side], x = clamp(candidate.left, left, right - size.width);
  const y = clamp(candidate.top, top, bottom - size.height), horizontal = side === 'above' || side === 'below';
  const length = horizontal ? size.width : size.height, arrowInset = Math.min(32, length / 2);
  return { left: x, top: y, side, arrow: clamp(horizontal ? centerX - x : centerY - y, arrowInset, length - arrowInset) };
}

/** A curved comic tail, with edge-tangent shoulders and a precise speaker tip.
 * Curved-tail reference: https://nicolasgallagher.com/pure-css-speech-bubbles/demo/
 */
export function tutorialSpeechTail(anchor, bubble, placement, viewport) {
  const source = rect(anchor), size = rect(bubble), view = rect(viewport);
  const { side, arrow, left, top } = placement;
  const horizontal = side === 'above' || side === 'below';
  const targetX = horizontal ? source.left + source.width / 2 : side === 'left' ? source.left - 4 : source.right + 4;
  const targetY = horizontal ? side === 'above' ? source.top - 4 : source.bottom + 4 : source.top + source.height / 2;
  const tip = { x: clamp(targetX, view.left + 4, view.right - 4) - left, y: clamp(targetY, view.top + 4, view.bottom - 4) - top };
  const outward = side === 'above' || side === 'left' ? 1 : -1;
  const edge = side === 'above' ? size.height : side === 'left' ? size.width : 0;
  const depth = Math.max(0, ((horizontal ? tip.y : tip.x) - edge) * outward);
  const half = Math.min(16, 6 + depth * .07, (horizontal ? size.width : size.height) / 2);
  const along = horizontal ? tip.x : tip.y;
  // A small asymmetric sweep stays stable when the bubble moves across the screen.
  const bend = clamp((along - arrow) * .15 + depth * .08, -half * .7, half * .7);
  const point = (offset, distance) => horizontal ? { x: offset, y: edge + distance * outward } :
    { x: edge + distance * outward, y: offset };
  const a = point(arrow - half, 0), b = point(arrow + half, 0);
  const control = (offset, distance) => {
    const p = point(offset, distance);
    return `${clamp(p.x, view.left + 4 - left, view.right - 4 - left)},${clamp(p.y, view.top + 4 - top, view.bottom - 4 - top)}`;
  };
  return { path: `M${a.x},${a.y}C${control(arrow - half * .4, 0)} ${control(along - bend - half * .2, depth * .65)} ${tip.x},${tip.y}` +
      `C${control(along - bend + half * .2, depth * .65)} ${control(arrow + half * .4, 0)} ${b.x},${b.y}Z`,
    base: { x1: a.x + (horizontal ? 1 : 0), y1: a.y + (horizontal ? 0 : 1),
      x2: b.x - (horizontal ? 1 : 0), y2: b.y - (horizontal ? 0 : 1) } };
}
