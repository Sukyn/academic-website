/** Keep a circuit and its amplitude paths aligned while scrolling or following a gate. */
export function createCircuitViewport(circuit, flow, pinLabels) {
  function scroll(left) {
    circuit.scrollLeft = left; flow.scrollLeft = circuit.scrollLeft;
    circuit.scrollLeft = flow.scrollLeft;
    pinLabels(flow.scrollLeft);
  }
  for (const [source, target] of [[circuit, flow], [flow, circuit]]) {
    source.addEventListener('scroll', () => {
      if (Math.abs(target.scrollLeft - source.scrollLeft) > 1) scroll(source.scrollLeft);
      else pinLabels(flow.scrollLeft);
    }, { passive: true });
  }
  return {
    follow(element, finished = false) {
      if (finished) { scroll(circuit.scrollWidth); return; }
      if (!element) { scroll(0); return; }
      const bounds = circuit.getBoundingClientRect(), target = element.getBoundingClientRect();
      const width = Math.min(circuit.clientWidth, flow.clientWidth);
      // Keep the pinned basis labels clear and both sides of the active gate visible.
      scroll(circuit.scrollLeft + target.left + target.width / 2 - bounds.left - circuit.clientLeft - (40 + width) / 2);
    },
  };
}
