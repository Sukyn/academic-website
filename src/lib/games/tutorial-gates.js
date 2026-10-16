import { CIRCUIT_COLORS, gateGlyph, svgNode } from './circuit-graphics.js';

// Build trusted gate icons without interpreting the surrounding prose as HTML.
function renderInstruction(node, text, icon) {
  node.replaceChildren(...text.split(/\b(CNOT|CZ|H|T|X|Z)\b/).map((part, index) => {
    if (index % 2) return icon(part);
    const span = document.createElement('span'); span.textContent = part; return span;
  }));
}

function gateToken(gate, label = gate) {
  const span = document.createElement('span');
  span.className = 'tutorial-gate'; span.setAttribute('data-gate', gate);
  span.setAttribute('role', 'img'); span.setAttribute('aria-label', label);
  return span;
}

export function renderGolfInstruction(node, text) {
  renderInstruction(node, text, gate => {
    const span = gateToken(gate); span.className += ' tutorial-letter'; span.textContent = gate;
    return span;
  });
}

export function renderCircuitInstruction(node, text, { singleWire = false } = {}) {
  renderInstruction(node, text, label => {
    const gate = label === 'CNOT' ? (singleWire ? 'XU' : 'CX') : label === 'CZ' && singleWire ? 'ZU' : label;
    const span = gateToken(gate, label);
    if (gate === 'CX' || gate === 'CZ') {
      const pair = document.createElement('span'); pair.className = 'tutorial-pair';
      for (const cell of gate === 'CZ' ? ['Z', 'Z'] : ['Z', 'X']) pair.appendChild(gateGlyph(cell));
      span.appendChild(pair);
    } else {
      const glyph = gateGlyph(gate);
      // Match the single-wire rule diagrams: the connector continues below the endpoint.
      if (gate.endsWith('U')) glyph.prepend(svgNode('path', { d: 'M22 22V44', stroke: CIRCUIT_COLORS.z, 'stroke-width': 2.4 }));
      span.appendChild(glyph);
    }
    return span;
  });
}
