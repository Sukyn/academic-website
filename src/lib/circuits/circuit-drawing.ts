import type { Circuit, Operation } from './circuit-engine';

type Label = { text: string; tex: string };
type Node = { x: number; y: number; style: string; label: Label; width?: number };
type Edge = { from: number; to: number; dashed?: boolean };
export type Panel = { nodes: Node[]; edges: Edge[]; width: number; height: number };

const empty = { text: '', tex: '' };
const signed = (value: number, p: number) => value <= p / 2 ? value : value - p;

function elementLabel(value: number, p: number): Label {
  if (!Number.isSafeInteger(value) || value < 0 || !Number.isInteger(p) || p < 2 || p > 256) {
    throw new Error('A field label needs a nonnegative integer and a base between 2 and 256.');
  }
  const terms: { coefficient: number; degree: number }[] = [];
  for (let degree = 0; value; degree++, value = Math.floor(value / p)) {
    const coefficient = signed(value % p, p);
    if (coefficient) terms.unshift({ coefficient, degree });
  }
  const format = (tex: boolean) => terms.map(({ coefficient, degree }, i) => {
    const sign = coefficient < 0 ? '-' : i ? '+' : '';
    const number = degree && Math.abs(coefficient) === 1 ? '' : Math.abs(coefficient);
    const power = degree > 1 ? (tex ? `^{${degree}}` : String(degree).replace(/\d/g, digit => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(digit)])) : '';
    return `${sign}${number}${degree ? (tex ? '\\alpha' : 'α') + power : ''}`;
  }).join('') || '0';
  return { text: format(false), tex: format(true) };
}

function gateLabel(gate: Operation, q: number, p: number): Label {
  if (gate.op === 'swap') {
    // Prime-field transposition labels retain the Python renderer's residues.
    if (q === p) return { text: `${gate.a},${gate.b}`, tex: `X_{${gate.a},${gate.b}}` };
    const a = elementLabel(gate.a, p), b = elementLabel(gate.b, p);
    return { text: `${a.text},${b.text}`, tex: `X_{${a.tex},${b.tex}}` };
  }
  const coefficient = elementLabel(gate.coefficient, p);
  return gate.op === 'scale'
    ? { text: coefficient.text, tex: `M_{${coefficient.tex}}` }
    : coefficient;
}

/** Wrap at maxWidth pixels; omit it for one continuous row. */
export function layoutCircuit(circuit: Circuit, p: number, maxWidth = Infinity): Panel[] {
  const panels: Panel[] = [];
  const height = (circuit.wire_count - 1) * 44 + 76;
  let columns: { gate: Operation; x: number; label: Label; width: number }[] = [];
  let cursor = 44;

  function finish() {
    const naturalWidth = cursor + 44;
    const width = Math.max(170, naturalWidth);
    const offset = (width - naturalWidth) / 2;
    const nodes: Node[] = [], edges: Edge[] = [];
    const node = (style: string, x: number, y: number, label = empty, boxWidth?: number) => {
      nodes.push({ style, x, y, label, width: boxWidth });
      return nodes.length - 1;
    };
    const y = (wire: number) => 32 + wire * 44;
    const lastNodes: number[] = [];
    const wireNode = (wire: number, style: string, x: number, label = empty, boxWidth?: number) => {
      const mark = node(style, x, y(wire), label, boxWidth);
      if (lastNodes[wire] !== undefined) edges.push({ from: lastNodes[wire], to: mark });
      lastNodes[wire] = mark;
      return mark;
    };
    for (let wire = 0; wire < circuit.wire_count; wire++) {
      node('cinput', 23, y(wire), { text: String(wire), tex: `\\texttt{${wire}}` });
      node('coutput', width - 23, y(wire), { text: String(wire), tex: `\\texttt{${wire}}` });
      wireNode(wire, 'none', 32);
    }
    for (const { gate, x: columnX, label, width: boxWidth } of columns) {
      const x = columnX + offset;
      if (gate.op !== 'add') {
        wireNode(gate.wire, gate.op === 'swap' ? 'cswap' : 'cbox', x, label, boxWidth);
        continue;
      }
      const controls = [...gate.controls].sort((a, b) => a - b);
      const shortcut = controls.length > 1;
      const markers = controls.map(wire => wireNode(wire, 'ccontrol', x));
      const target = wireNode(gate.target, 'cplus', x, {
        text: label.text === '-1' ? '−' : '+', tex: label.text === '-1' ? '-' : '+',
      });
      markers.push(target);
      markers.sort((a, b) => nodes[a].y - nodes[b].y);
      for (let i = 1; i < markers.length; i++) edges.push({ from: markers[i - 1], to: markers[i], dashed: shortcut });
      if (label.text !== '1' && label.text !== '-1') {
        const nearest = controls.reduce((a, b) => Math.abs(a - gate.target) <= Math.abs(b - gate.target) ? a : b);
        const above = nearest > gate.target;
        node('ccoeff', x, y(gate.target) + (above ? -19 : 22), label);
      }
      for (let start = 0; start < controls.length;) {
        let end = start + 1;
        while (end < controls.length && controls[end] === controls[end - 1] + 1) end++;
        if (end - start > 3) node('cellipsis', x, (y(controls[start + 1]) + y(controls[start + 2])) / 2, { text: '⋮', tex: '\\vdots' });
        start = end;
      }
    }
    for (let wire = 0; wire < circuit.wire_count; wire++) wireNode(wire, 'none', width - 32);
    panels.push({ nodes, edges, width, height });
    columns = [];
    cursor = 44;
  }
  for (const gate of circuit.operations) {
    const label = gateLabel(gate, circuit.q, p);
    const width = gate.op === 'add' ? Math.max(20, label.text.length * 7) : Math.max(34, label.text.length * 7 + 19);
    const spacing = Math.max(40, width + 14);
    if (columns.length && cursor + spacing + 44 > maxWidth) finish();
    columns.push({ gate, label, x: cursor + spacing / 2, width });
    cursor += spacing;
  }
  if (columns.length || !panels.length) finish();
  return panels;
}

export function panelSvg(panel: Panel, index: number, total: number): string {
  const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  const label = (n: Node) => `<text x="${n.x}" y="${n.y}" dominant-baseline="central" text-anchor="middle">${escape(n.label.text)}</text>`;
  const lines = panel.edges.map(({ from, to, dashed }) => {
    const a = panel.nodes[from], b = panel.nodes[to];
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"${dashed ? ' stroke-dasharray="3 3"' : ''}/>`;
  }).join('');
  const nodes = panel.nodes.map(n => {
    switch (n.style) {
      case 'none': return '';
      case 'ccontrol': return `<circle class="dot" cx="${n.x}" cy="${n.y}" r="3.3"/>`;
      case 'cplus': return `<circle cx="${n.x}" cy="${n.y}" r="9"/><path d="M${n.x - 5} ${n.y}h10${n.label.tex === '+' ? ` M${n.x} ${n.y - 5}v10` : ''}"/>`;
      case 'cbox':
      case 'cswap': {
        const text = escape(n.label.text);
        const box = `<rect x="${n.x - n.width! / 2}" y="${n.y - 12}" width="${n.width}" height="24" rx="3"/>`;
        return box + `<text x="${n.x}" y="${n.y}" dominant-baseline="central" text-anchor="middle"><tspan font-style="italic">${n.style === 'cswap' ? 'X' : 'M'}</tspan><tspan baseline-shift="sub" font-size="10">${text.replaceAll('-', '−')}</tspan></text>`;
      }
      case 'ccoeff':
      case 'cellipsis': return `<g class="annotation">${label(n)}</g>`;
      default: return `<g class="wire-label">${label(n)}</g>`;
    }
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${panel.width}" height="${panel.height}" viewBox="0 0 ${panel.width} ${panel.height}" role="img" aria-label="Circuit, row ${index + 1} of ${total}"><g class="wires">${lines}</g><g class="gates">${nodes}</g></svg>`;
}

export function circuitTikz(panels: Panel[], circuit: Circuit, p: number): string {
  const styles = String.raw`% Requires \usepackage{tikz}.
\begingroup
\pgfdeclarelayer{nodelayer}
\pgfdeclarelayer{edgelayer}
\pgfsetlayers{edgelayer,nodelayer,main}
\tikzset{
 none/.style={inner sep=0pt,outer sep=0pt},
 cwire/.style={draw=black,line width=.45pt},
 cshortcut/.style={cwire,densely dashed},
 ccontrol/.style={circle,draw=black,fill=black,inner sep=0pt,outer sep=0pt,minimum size=1.5mm},
 cplus/.style={circle,draw=black,fill=white,inner sep=0pt,outer sep=0pt,minimum size=4mm,font=\footnotesize},
 cbox/.style={rectangle,draw=black,fill=white,rounded corners=.7mm,inner sep=1mm,outer sep=0pt,minimum height=5mm,font=\scriptsize},
 cswap/.style={cbox},
 cinput/.style={anchor=east,inner sep=0pt,font=\footnotesize},
 coutput/.style={anchor=west,inner sep=0pt,font=\footnotesize},
 ccoeff/.style={inner sep=0pt,font=\scriptsize,fill=white},
 cellipsis/.style={inner sep=0pt,font=\footnotesize,fill=white}
}`;
  // Separate pictures can break across pages and never exceed TeX's dimension limit.
  const pictures = panels.map(panel => {
    const nodes = panel.nodes.map((n, i) => {
      const tex = n.label.tex;
      return `\\node [style=${n.style}] (${i}) at (${(n.x / 60).toFixed(4)},${(-n.y / 60).toFixed(4)}) {${tex ? `$${tex}$` : ''}};`;
    });
    const edges = panel.edges.map(e => `\\draw [style=${e.dashed ? 'cshortcut' : 'cwire'}] (${e.from}) to (${e.to});`);
    return `\\noindent\\begin{tikzpicture}\n\\begin{pgfonlayer}{nodelayer}\n${nodes.join('\n')}\n\\end{pgfonlayer}\n\\begin{pgfonlayer}{edgelayer}\n${edges.join('\n')}\n\\end{pgfonlayer}\n\\end{tikzpicture}`;
  });
  const basis = circuit.modulus
    ? `% F_${circuit.q}: alpha is a root of ${circuit.modulus.map((c, i) => `${c}*x^${circuit.modulus!.length - 1 - i}`).join(' + ')} over F_${p}.\n`
    : '';
  return `${styles}\n${basis}${pictures.join('\n\\par\\medskip\n')}\n\\par\\endgroup\n`;
}
