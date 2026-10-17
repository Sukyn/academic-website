import { svgNode } from '../games/circuit-graphics.js';
import { flowColumnX } from './rendering.js';

export const flowElements = svg => [...svg.querySelectorAll('.signal-flow-path, .signal-flow-node, .signal-flow-cancellation')];
const columnOf = node => node.dataset.column === undefined ? Number(node.dataset.boundary) - 1 : Number(node.dataset.column);
const key = node => node.dataset.column === undefined ?
  `${node.classList.contains('signal-flow-node') ? 'node' : 'wall'}:${node.dataset.boundary}:${node.dataset.basis}` :
  `path:${node.dataset.column}:${node.dataset.from}:${node.dataset.to}`;
const stationary = () => ({ finished: Promise.resolve(true), cancel() {} });

/** Crossfade changed columns without animating SVG geometry or moving its bounds. */
export function animateFlow(svg, previous, firstColumn) {
  const view = svg.ownerDocument.defaultView;
  if (typeof svg.animate !== 'function' || view.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return stationary();
  }
  const before = new Map(previous.map(node => [key(node), node])), groups = new Map(), animations = [];
  const viewport = svg.parentElement, left = viewport.scrollLeft, right = left + viewport.clientWidth;
  // Offscreen columns already show their final state; don't keep animating them.
  const visible = column => flowColumnX(column + 1) + 8 >= left && flowColumnX(column) - 8 <= right;
  const gutter = svg.querySelector('.signal-flow-gutter');
  const groupFor = column => {
    if (groups.has(column)) return groups.get(column);
    const old = svgNode('g', { class: 'signal-flow-ghost', 'aria-hidden': true });
    const next = svgNode('g', {});
    svg.insertBefore(old, gutter); svg.insertBefore(next, gutter);
    const group = { old, next }; groups.set(column, group); return group;
  };
  const ghost = node => {
    const group = groupFor(columnOf(node));
    for (const name of node.getAttributeNames()) {
      if (name.startsWith('data-') || name.startsWith('aria-') || name === 'class' || name === 'role') node.removeAttribute(name);
    }
    group.old.appendChild(node);
  };
  for (const node of flowElements(svg)) {
    const nodeKey = key(node), old = before.get(nodeKey); before.delete(nodeKey);
    if (columnOf(node) < firstColumn || !visible(columnOf(node)) || old?.getAttribute('data-amplitude') === node.getAttribute('data-amplitude')) continue;
    groupFor(columnOf(node)).next.appendChild(node);
    if (old) ghost(old);
  }
  for (const node of before.values()) if (columnOf(node) >= firstColumn && visible(columnOf(node))) ghost(node);
  if (!groups.size) return stationary();
  svg.dataset.flowAnimating = 'true'; svg.setAttribute('aria-busy', 'true');
  // Batch all DOM changes before starting browser animations.
  for (const [column, { old, next }] of groups) {
    const delay = (column - firstColumn) * 70;
    if (old.childNodes.length) animations.push(old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, delay, fill: 'forwards' }));
    if (next.childNodes.length) animations.push(next.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, delay, fill: 'backwards' }));
  }
  let settled = false, resolve;
  const finished = new Promise(done => { resolve = done; });
  const finish = completed => {
    if (settled) return;
    settled = true;
    for (const animation of animations) animation.cancel();
    for (const { old, next } of groups.values()) { old.remove(); next.replaceWith(...next.childNodes); }
    delete svg.dataset.flowAnimating; svg.removeAttribute('aria-busy'); resolve(completed);
  };
  Promise.all(animations.map(animation => animation.finished)).then(() => finish(true), () => finish(false));
  return { finished, cancel: () => finish(false) };
}
