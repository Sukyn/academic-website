// Offline diagnostics: local similarity is not a certificate of puzzle difficulty.
import { LEARNED_RULE_IDS, validateCircuit } from '../../src/lib/circuit-reduction/engine.js';

const permutations = values => values.length ? values.flatMap((value, i) =>
  permutations(values.filter((_, j) => i !== j)).map(rest => [value, ...rest])) : [[]];

function graph(circuit) {
  validateCircuit(circuit);
  const nodes = [], wires = circuit.map(() => []);
  for (let column = 0; column < circuit[0].length; column++) for (let row = 0; row < circuit.length; row++) {
    const upper = circuit[row][column];
    if (upper === '.' || upper.endsWith('D')) continue;
    const rows = upper.endsWith('U') ? [row, row + 1] : [row];
    const lower = circuit[row + 1]?.[column];
    const kind = rows.length === 1 ? upper : upper === 'ZU' && lower === 'ZD' ? 'CZ' :
      upper === 'XU' && lower === 'XD' ? 'XX' : 'CX';
    const node = { kind, rows, control: kind === 'CX' ? upper === 'ZU' ? row : row + 1 : null };
    for (const wire of rows) wires[wire].push(nodes.length);
    nodes.push(node);
  }
  // Empty wires carry no interaction structure and must not affect relabelling.
  const active = wires.map((trace, row) => trace.length ? row : -1).filter(row => row >= 0);
  for (const node of nodes) {
    node.rows = node.rows.map(row => active.indexOf(row));
    if (node.control !== null) node.control = active.indexOf(node.control);
  }
  return { nodes, wires: active.map(row => wires[row]) };
}

function token(node, permutation) {
  const rows = node.rows.map(row => permutation[row]);
  return node.kind === 'CX' ? `CX:${permutation[node.control]}>${rows.find(row => row !== permutation[node.control])}` :
    `${node.kind}:${rows.sort((a, b) => a - b).join(',')}`;
}

// Canonical topological ordering removes arbitrary ordering of disjoint gates.
function orderedTokens(graph, tokens, reverse) {
  const traces = graph.wires.map(trace => reverse ? [...trace].reverse() : trace);
  const positions = traces.map(() => 0), result = [];
  while (result.length < graph.nodes.length) {
    const heads = new Set(traces.flatMap((trace, wire) => trace[positions[wire]] === undefined ? [] : [trace[positions[wire]]]));
    const ready = [...heads].filter(id => graph.nodes[id].rows.every(wire => traces[wire][positions[wire]] === id));
    ready.sort((a, b) => tokens[a] < tokens[b] ? -1 : 1);
    const id = ready[0];
    result.push(tokens[id]);
    for (const wire of graph.nodes[id].rows) positions[wire]++;
  }
  return result.join('|');
}

function analyze(circuit, withGrams = false) {
  const data = graph(circuit), orders = permutations(data.wires.map((_, wire) => wire));
  const tokenOrders = orders.map(order => data.nodes.map(node => token(node, order)));
  const structuralKey = tokenOrders.flatMap(tokens => [false, true].map(reverse => orderedTokens(data, tokens, reverse))).sort()[0];
  const gateTypes = {};
  for (const { kind } of data.nodes) gateTypes[kind] = (gateTypes[kind] ?? 0) + 1;
  let maxAlternatingCZ = 0;
  for (const trace of data.wires) for (let start = 0; start + 1 < trace.length; start++) {
    const first = trace[start], second = trace[start + 1];
    if (data.nodes[first].kind !== 'CZ' || data.nodes[second].kind !== 'CZ' ||
        tokenOrders[0][first] === tokenOrders[0][second]) continue;
    let length = 2;
    while (start + length < trace.length && tokenOrders[0][trace[start + length]] === tokenOrders[0][trace[start + length % 2]]) length++;
    maxAlternatingCZ = Math.max(maxAlternatingCZ, length);
  }
  const gateCount = data.nodes.length;
  const entropy = gateCount ? -Object.values(gateTypes).reduce((sum, count) => {
    const p = count / gateCount;
    return sum + p * Math.log2(p);
  }, 0) : 0;
  const metrics = { structuralKey, gateCount, gateTypes, maxAlternatingCZ,
    repetitionShare: gateCount ? maxAlternatingCZ / gateCount : 0, entropy: Math.max(0, entropy) };
  if (!withGrams) return { metrics };
  // Anchor each motif to its wire and transform the whole circuit consistently.
  // Reversing windows independently would hide conflicting orders across wires.
  const grams = orders.flatMap((order, i) => [false, true].map(reverse => {
    const counts = new Map();
    data.wires.forEach((original, wire) => {
      const trace = reverse ? [...original].reverse() : original;
      for (const size of [1, 2, 3]) for (let start = 0; start + size <= trace.length; start++) {
        const key = `${order[wire]}@${trace.slice(start, start + size).map(id => tokenOrders[i][id]).join('|')}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    });
    return counts;
  }));
  return { metrics, grams };
}

export const circuitMetrics = circuit => analyze(circuit).metrics;

function gramDistance(left, right) {
  let intersection = 0, union = 0;
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    intersection += Math.min(left.get(key) ?? 0, right.get(key) ?? 0);
    union += Math.max(left.get(key) ?? 0, right.get(key) ?? 0);
  }
  return union ? 1 - intersection / union : 0;
}

const distance = (left, right) => Math.min(...right.grams.map(grams => gramDistance(left.grams[0], grams)));

// Multiset Jaccard distance of typed wire motifs, in [0, 1]. It measures local
// similarity; distinct whole circuits can share the same collection of motifs.
export const structuralDistance = (a, b) => distance(analyze(a, true), analyze(b, true));

const median = values => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length ? sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 : null;
};

export function catalogueMetrics(entries) {
  const classes = new Map();
  for (const { circuit } of entries) {
    const key = circuitMetrics(circuit).structuralKey;
    if (!classes.has(key)) classes.set(key, { circuit, count: 0, nearest: Infinity });
    classes.get(key).count++;
  }
  const unique = [...classes.values()];
  for (const item of unique) if (item.count > 1) item.nearest = 0;
  // Duplicate classes already have distance zero; compare other classes once.
  for (let i = 0; i < unique.length; i++) for (let j = i + 1; j < unique.length; j++) {
    const a = unique[i], b = unique[j];
    if (a.count > 1 && b.count > 1) continue;
    a.analysis ??= analyze(a.circuit, true); b.analysis ??= analyze(b.circuit, true);
    const gap = distance(a.analysis, b.analysis);
    a.nearest = Math.min(a.nearest, gap); b.nearest = Math.min(b.nearest, gap);
  }
  const nearest = unique.flatMap(item => Array(item.count).fill(item.nearest));
  const effectiveStructural = entries.length ? Math.exp(-unique.reduce((sum, { count }) => {
    const p = count / entries.length;
    return sum + p * Math.log(p);
  }, 0)) : 0;
  const result = { structuralUnique: classes.size, effectiveStructural,
    minimumNearestNeighborDistance: entries.length > 1 ? Math.min(...nearest) : null,
    medianNearestNeighborDistance: entries.length > 1 ? median(nearest) : null };
  if (entries.some(entry => Array.isArray(entry.solution))) {
    result.ruleUse = Object.fromEntries(LEARNED_RULE_IDS.map(rule => [rule, 0]));
    result.ruleBoards = { ...result.ruleUse };
    for (const { solution = [] } of entries) {
      const used = new Set();
      for (const { rule } of solution) if (Object.hasOwn(result.ruleUse, rule)) { result.ruleUse[rule]++; used.add(rule); }
      for (const rule of used) result.ruleBoards[rule]++;
    }
  }
  return result;
}
