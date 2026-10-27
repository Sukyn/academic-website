import { CIRCUIT_COLORS, gateGlyph, svgNode } from './circuit-graphics.js';

// Build trusted gate icons without interpreting the surrounding prose as HTML.
function renderInstruction(node, text, icon) {
  node.replaceChildren(...text.split(/\b(CNOT|NOTC|CZ|H|T|X|Z)\b/).map((part, index) => {
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
    const gate = { CNOT: singleWire ? 'XU' : 'CX', NOTC: singleWire ? 'XD' : 'XC', CZ: singleWire ? 'ZU' : 'CZ' }[label] ?? label;
    const span = gateToken(gate, label === 'NOTC' ? 'CNOT: lower control' : label);
    if (gate === 'CX' || gate === 'XC' || gate === 'CZ') {
      const pair = document.createElement('span'); pair.className = 'tutorial-pair';
      for (const cell of gate === 'CZ' ? ['Z', 'Z'] : gate === 'XC' ? ['X', 'Z'] : ['Z', 'X']) pair.appendChild(gateGlyph(cell));
      span.appendChild(pair);
    } else {
      const glyph = gateGlyph(gate);
      // Match the rule diagrams: the connector continues towards the other endpoint.
      if (gate.endsWith('U') || gate.endsWith('D')) glyph.prepend(svgNode('path', {
        d: gate.endsWith('U') ? 'M22 22V44' : 'M22 0V22', stroke: CIRCUIT_COLORS.z, 'stroke-width': 2.4,
      }));
      span.appendChild(glyph);
    }
    return span;
  });
}
