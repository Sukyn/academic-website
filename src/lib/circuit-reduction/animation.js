import { CIRCUIT_COLORS, gateGlyph, svgNode } from '../games/circuit-graphics.js';
import { createRewriteTransition, transitionSample, REWRITE_DURATION } from './transition.js';

/** Animate the small rewrite window over the old board; never redraw per frame. */
export function animateRewrite(board, before, after, move, { duration = REWRITE_DURATION } = {}) {
  const view = board.ownerDocument?.defaultView;
  if (typeof board.animate !== 'function' || view?.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const plan = createRewriteTransition(before, after, move);
  if (!plan) return null;
  const overlay = document.createElement('div');
  overlay.className = 'rewrite-overlay'; overlay.setAttribute('aria-hidden', 'true');
  const hidden = [], animations = [], completions = [], sprites = [];
  for (const [items, link] of [[plan.links, true], [plan.gates, false]]) {
    for (const item of items) {
      if (item.phase !== 'in') {
        const key = `${item.row}:${item.fromColumn}`;
        const node = board.querySelector(link ? `[data-link="${key}"]` : `[data-cell="${key}"] .gate-glyph`);
        if (node) { hidden.push({ node, visibility: node.style.visibility }); node.style.visibility = 'hidden'; }
      }
      const sprite = document.createElement('div');
      sprite.className = link ? 'rewrite-link' : 'rewrite-gate';
      sprite.style.left = `${link ? 52 : 32}px`;
      sprite.style.top = `${item.row * 72 + (link ? 36 : 14)}px`;
      if (link) {
        const svg = svgNode('svg', { width: 4, height: 72, viewBox: '0 0 4 72' });
        svg.appendChild(svgNode('path', { d: 'M2 0V72', stroke: CIRCUIT_COLORS.z, 'stroke-width': 2.4 }));
        sprite.appendChild(svg);
      } else sprite.appendChild(gateGlyph(item.cell));
      overlay.appendChild(sprite); sprites.push({ sprite, item, link });
    }
  }
  board.appendChild(overlay);
  board.dataset.rewriteAnimating = 'true'; board.setAttribute('aria-busy', 'true');
  let settled = false, resolve;
  const finished = new Promise(done => { resolve = done; });
  const finish = completed => {
    if (settled) return;
    settled = true;
    for (const animation of animations) animation.cancel();
    for (const { node, visibility } of hidden) node.style.visibility = visibility;
    overlay.remove(); delete board.dataset.rewriteAnimating; board.removeAttribute('aria-busy');
    resolve(completed);
  };
  try {
    // All writes precede animation startup. Geometry stays in board coordinates,
    // including the enlarged touch layout; no measurements or JS frame loop.
    for (const { sprite, item, link } of sprites) {
      const frames = [0, .16, .3, .45, .55, .6, .7, .84, 1].map(progress => {
        const { column, opacity, scale } = transitionSample(item, progress);
        return { transform: `translateX(${column * 64}px) scale(${link ? 1 : scale})`, opacity, offset: progress };
      });
      if (frames.every(frame => frame.transform === frames[0].transform && frame.opacity === 1)) {
        sprite.style.transform = frames[0].transform;
        continue;
      }
      const animation = sprite.animate(frames, { duration, fill: 'both', easing: 'linear' });
      animations.push(animation);
      completions.push(animation.finished.then(() => true, () => false));
    }
    Promise.all(completions).then(results => finish(results.every(Boolean)));
  } catch { finish(false); return null; }
  return { finished, cancel: () => finish(false) };
}
