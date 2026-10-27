import { seededRandom } from '../games/random.js';
import levels from './levels.json' with { type: 'json' };

export const MAX_NODES = 32;
export const MAX_EDGES = 48;
export const MAX_MOVES = 128;
export const RULES = [
  { id: 'fusion', label: 'Fuse or split spiders' },
  { id: 'identity', label: 'Insert or remove identity' },
  { id: 'hh', label: 'Insert or cancel Hadamards' },
  { id: 'color', label: 'Change colour' },
  { id: 'hopf', label: 'Add or cancel two links' },
];
const RULE_IDS = RULES.map(rule => rule.id);
const phase = node => node.phase ?? 0;
const spider = node => node.kind === 'z' || node.kind === 'x';
const pair = (a, b) => a < b ? [a, b] : [b, a];
const edgeOrder = (a, b) => a[0] - b[0] || a[1] - b[1];
const fail = message => { throw new RangeError(message); };
const hasOnly = (value, keys) => Object.keys(value).every(key => keys.includes(key));

/** Both directions of an equation share the same lesson unlock. */
export function ruleFamily(rule) {
  switch (rule) {
    case 'split': return 'fusion';
    case 'insert': return 'identity';
    case 'insert-hh': return 'hh';
    case 'add-hopf': return 'hopf';
    default: return RULE_IDS.includes(rule) ? rule : undefined;
  }
}

/** Two labelled inputs (0, 1) and outputs (2, 3), joined by identity wires. */
export function targetDiagram() {
  return {
    nodes: [0, 1, 2, 3].map(id => ({ id, kind: 'boundary' })),
    edges: [[0, 2], [1, 3]],
  };
}

/** A bounded undirected multigraph. Phases count quarter turns, modulo four.
 * Boundaries have degree one and H boxes degree two. Parallel wires are kept;
 * drawing positions and node IDs carry no mathematical meaning.
 */
export function validateDiagram(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !hasOnly(input, ['nodes', 'edges']) ||
      !Array.isArray(input.nodes) || input.nodes.length < 4 || input.nodes.length > MAX_NODES ||
      !Array.isArray(input.edges) || input.edges.length > MAX_EDGES) fail('Expected a ZX diagram with at most 32 nodes and 48 wires.');
  const nodes = [], degree = new Map();
  for (const node of input.nodes) {
    if (!node || typeof node !== 'object' || Array.isArray(node) || !hasOnly(node, ['id', 'kind', 'phase']) ||
        !Number.isInteger(node.id) || node.id < 0 || node.id > 1_000_000 || degree.has(node.id) ||
        !['boundary', 'z', 'x', 'h'].includes(node.kind) ||
        ((node.id < 4) !== (node.kind === 'boundary')) ||
        (node.phase !== undefined && (!spider(node) || !Number.isInteger(node.phase) || node.phase < 0 || node.phase > 3))) {
      fail('Use unique node IDs, four boundaries, and phases from 0 to 3.');
    }
    const copy = { id: node.id, kind: node.kind };
    if (phase(node)) copy.phase = node.phase;
    degree.set(node.id, 0);
    nodes.push(copy);
  }
  for (let id = 0; id < 4; id++) if (!degree.has(id)) fail('Keep the four input and output boundaries.');
  const edges = input.edges.map(edge => {
    if (!Array.isArray(edge) || edge.length !== 2 || !degree.has(edge[0]) || !degree.has(edge[1]) || edge[0] === edge[1]) {
      fail('A wire must join two different existing nodes.');
    }
    degree.set(edge[0], degree.get(edge[0]) + 1);
    degree.set(edge[1], degree.get(edge[1]) + 1);
    return pair(...edge);
  });
  for (const node of nodes) {
    if ((node.kind === 'boundary' && degree.get(node.id) !== 1) || (node.kind === 'h' && degree.get(node.id) !== 2)) {
      fail('Each boundary needs one wire, and each Hadamard needs two.');
    }
  }
  return { nodes: nodes.sort((a, b) => a.id - b.id), edges: edges.sort(edgeOrder) };
}

function context(diagram) {
  const nodes = new Map(diagram.nodes.map(node => [node.id, node]));
  const legs = new Map(diagram.nodes.map(node => [node.id, []]));
  diagram.edges.forEach(([a, b], index) => {
    legs.get(a).push({ to: b, index });
    legs.get(b).push({ to: a, index });
  });
  return { nodes, legs };
}

function nextId(nodes) {
  let id = 4;
  while (nodes.has(id)) id++;
  return id;
}

function setPhase(node, value) {
  value = (value + 4) % 4;
  if (value) node.phase = value;
  else delete node.phase;
}

/** Rules use the usual ZX convention of equality up to a nonzero scalar.
 * Spider/identity/H rules: https://zxcalculus.com/intro.html
 * Hopf (parallel wires): https://pyzx.readthedocs.io/en/latest/notebooks/rules.html
 */
function transform(diagram, move) {
  if (!move || typeof move !== 'object' || Array.isArray(move) || typeof move.rule !== 'string') fail('Choose a ZX rule.');
  const { nodes, legs } = context(diagram);
  const removed = new Set(), removedEdges = new Set(), addedEdges = [];
  const selected = move.nodes;
  const requireNodes = count => {
    if (!hasOnly(move, ['rule', 'nodes', ...(move.rule === 'split' ? ['phase'] : [])]) ||
        !Array.isArray(selected) || selected.length !== count || new Set(selected).size !== count ||
        selected.some(id => !nodes.has(id))) fail('Select the nodes for this rule.');
    return selected.map(id => nodes.get(id));
  };
  const addNode = (kind, angle = 0) => {
    const node = { id: nextId(nodes), kind };
    if (angle) node.phase = angle;
    nodes.set(node.id, node);
    return node.id;
  };
  const connect = (a, b) => {
    // An ordinary self-loop on a spider contracts to that same spider.
    if (a === b) {
      if (!spider(nodes.get(a))) fail('This contraction would create an unsupported Hadamard loop.');
    } else addedEdges.push(pair(a, b));
  };
  switch (move.rule) {
    case 'fusion': {
      let [a, b] = requireNodes(2);
      if (a.id > b.id) [a, b] = [b, a];
      if (!spider(a) || a.kind !== b.kind || !legs.get(a.id).some(leg => leg.to === b.id)) fail('Fuse connected spiders of the same colour.');
      setPhase(a, phase(a) + phase(b));
      removed.add(b.id);
      for (const leg of legs.get(b.id)) {
        if (leg.to !== a.id) connect(a.id, leg.to);
      }
      break;
    }
    case 'identity': {
      const [node] = requireNodes(1), ends = legs.get(node.id);
      if (!spider(node) || phase(node) || ends.length !== 2) fail('Remove a spider with no turn and two wires.');
      removed.add(node.id);
      connect(ends[0].to, ends[1].to);
      break;
    }
    case 'hh': {
      const [a, b] = requireNodes(2);
      if (a.kind !== 'h' || b.kind !== 'h' || !legs.get(a.id).some(leg => leg.to === b.id)) fail('Select two connected Hadamards.');
      removed.add(a.id);
      removed.add(b.id);
      const ends = [...legs.get(a.id), ...legs.get(b.id)].filter(leg => leg.to !== a.id && leg.to !== b.id);
      if (ends.length) connect(ends[0].to, ends[1].to);
      break;
    }
    case 'color': {
      const [node] = requireNodes(1);
      if (!spider(node)) fail('Select a spider to change its colour.');
      node.kind = node.kind === 'z' ? 'x' : 'z';
      for (const leg of legs.get(node.id)) {
        removedEdges.add(leg.index);
        const h = addNode('h');
        connect(node.id, h);
        connect(h, leg.to);
      }
      break;
    }
    case 'hopf':
    case 'add-hopf': {
      const [a, b] = requireNodes(2);
      if (!spider(a) || !spider(b) || a.kind === b.kind) fail('Select one spider of each colour.');
      if (move.rule === 'hopf') {
        const parallel = legs.get(a.id).filter(leg => leg.to === b.id);
        if (parallel.length < 2) fail('Select opposite-colour spiders joined by two wires.');
        parallel.slice(0, 2).forEach(leg => removedEdges.add(leg.index));
      } else addedEdges.push(pair(a.id, b.id), pair(a.id, b.id));
      break;
    }
    case 'insert':
    case 'insert-hh': {
      if (!hasOnly(move, move.rule === 'insert' ? ['rule', 'edge', 'kind'] : ['rule', 'edge']) ||
          !Array.isArray(move.edge) || move.edge.length !== 2 ||
          (move.rule === 'insert' && !['z', 'x'].includes(move.kind))) fail('Choose a wire and a spider colour.');
      const [a, b] = pair(...move.edge);
      const index = diagram.edges.findIndex(edge => edge[0] === a && edge[1] === b);
      if (index < 0) fail('Choose an existing wire.');
      removedEdges.add(index);
      const first = addNode(move.rule === 'insert' ? move.kind : 'h');
      connect(a, first);
      if (move.rule === 'insert-hh') {
        const second = addNode('h');
        connect(first, second);
        connect(second, b);
      } else connect(first, b);
      break;
    }
    case 'split': {
      const [node] = requireNodes(1);
      if (!spider(node) || !Number.isInteger(move.phase) || move.phase < 0 || move.phase > 3) fail('Choose a spider and a phase from 0 to 3.');
      const other = addNode(node.kind, move.phase);
      setPhase(node, phase(node) - move.phase);
      const moved = legs.get(node.id).slice(0, Math.ceil(legs.get(node.id).length / 2));
      for (const leg of moved) {
        removedEdges.add(leg.index);
        connect(other, leg.to);
      }
      connect(node.id, other);
      break;
    }
    default: fail('Unknown ZX rule.');
  }
  return {
    nodes: [...nodes.values()].filter(node => !removed.has(node.id)),
    edges: [...diagram.edges.filter((edge, index) => !removedEdges.has(index) && !edge.some(id => removed.has(id))), ...addedEdges],
  };
}

export function applyMove(input, move) {
  return validateDiagram(transform(validateDiagram(input), move));
}

/** Enumerate bounded local matches, without matrix contraction or graph search. */
export function availableMoves(input, { expand = false } = {}) {
  const diagram = validateDiagram(input), { nodes, legs } = context(diagram), moves = [];
  const uniqueEdges = diagram.edges.filter((edge, index, edges) => !index || edgeOrder(edge, edges[index - 1]));
  const add = move => {
    try {
      // Rewrites mutate node colours/phases; their existing wire arrays stay read-only.
      const candidate = { nodes: diagram.nodes.map(node => ({ ...node })), edges: diagram.edges };
      validateDiagram(transform(candidate, move));
      moves.push(move);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  };
  for (const node of diagram.nodes) if (spider(node)) {
    if (!phase(node) && legs.get(node.id).length === 2) add({ rule: 'identity', nodes: [node.id] });
    add({ rule: 'color', nodes: [node.id] });
    if (expand && diagram.nodes.length < MAX_NODES && diagram.edges.length < MAX_EDGES) {
      for (let phase = 0; phase < 4; phase++) add({ rule: 'split', nodes: [node.id], phase });
    }
  }
  for (const [a, b] of uniqueEdges) {
    const left = nodes.get(a), right = nodes.get(b);
    if (spider(left) && left.kind === right.kind) add({ rule: 'fusion', nodes: [a, b] });
    if (left.kind === 'h' && right.kind === 'h') add({ rule: 'hh', nodes: [a, b] });
    if (spider(left) && spider(right) && left.kind !== right.kind && legs.get(a).filter(leg => leg.to === b).length >= 2) add({ rule: 'hopf', nodes: [a, b] });
    if (expand) {
      if (diagram.nodes.length < MAX_NODES && diagram.edges.length < MAX_EDGES) {
        moves.push({ rule: 'insert', edge: [a, b], kind: 'z' }, { rule: 'insert', edge: [a, b], kind: 'x' });
      }
      if (diagram.nodes.length + 2 <= MAX_NODES && diagram.edges.length + 2 <= MAX_EDGES) moves.push({ rule: 'insert-hh', edge: [a, b] });
    }
  }
  if (expand && diagram.edges.length + 2 <= MAX_EDGES) {
    const spiders = diagram.nodes.filter(spider);
    for (let a = 0; a < spiders.length; a++) for (let b = a + 1; b < spiders.length; b++) {
      if (spiders[a].kind !== spiders[b].kind) moves.push({ rule: 'add-hopf', nodes: [spiders[a].id, spiders[b].id] });
    }
  }
  return moves;
}

export function isSolved(input) {
  const diagram = validateDiagram(input);
  return diagram.nodes.length === 4 && diagram.edges.length === 2 &&
    diagram.edges[0][0] === 0 && diagram.edges[0][1] === 2 && diagram.edges[1][0] === 1 && diagram.edges[1][1] === 3;
}

function builder() {
  let diagram = targetDiagram();
  const solution = [];
  return {
    get diagram() { return diagram; },
    get solution() { return solution; },
    add(move) {
      const before = diagram, after = applyMove(before, move);
      const ids = new Set(before.nodes.map(node => node.id));
      const added = after.nodes.filter(node => !ids.has(node.id)).map(node => node.id);
      let inverse;
      if (move.rule === 'insert') inverse = [{ rule: 'identity', nodes: added }];
      else if (move.rule === 'insert-hh') inverse = [{ rule: 'hh', nodes: added }];
      else if (move.rule === 'split') inverse = [{ rule: 'fusion', nodes: [...move.nodes, ...added].sort((a, b) => a - b) }];
      else if (move.rule === 'add-hopf') inverse = [{ rule: 'hopf', nodes: move.nodes }];
      else if (move.rule === 'color') {
        try {
          const flipped = applyMove(after, move), afterIds = new Set(after.nodes.map(node => node.id));
          const firstLayer = new Set(added), { legs } = context(flipped);
          // A second colour change adds another layer; only HH removes the two layers.
          inverse = [move, ...flipped.nodes.filter(node => !afterIds.has(node.id)).map(node => ({
            rule: 'hh', nodes: [node.id, legs.get(node.id).find(leg => firstLayer.has(leg.to)).to].sort((a, b) => a - b),
          }))];
          const restored = inverse.slice(1).reduce((value, step) => applyMove(value, step), flipped);
          if (JSON.stringify(restored) !== JSON.stringify(before)) return false;
        } catch (error) {
          if (!(error instanceof RangeError)) throw error;
          return false;
        }
      } else fail('Use an expansion to build a puzzle.');
      diagram = after;
      solution.unshift(...inverse);
      return true;
    },
  };
}

/** Generate from identity by reversible ZX rules; keep a concrete solution.
 * A cross-wire Hopf pair prevents the puzzles being just two gate chains.
 */
export function generatePuzzle(seed, difficulty = 2) {
  if ((typeof seed !== 'string' && !Number.isSafeInteger(seed)) || String(seed).length > 100 ||
      !Number.isInteger(difficulty) || difficulty < 1 || difficulty > 3) fail('Choose a seed and a difficulty from 1 to 3.');
  const random = seededRandom(seed), build = builder();
  const first = random() < 0.5 ? 'z' : 'x';
  build.add({ rule: 'insert', edge: [0, 2], kind: first });
  build.add({ rule: 'insert', edge: [1, 3], kind: first === 'z' ? 'x' : 'z' });
  build.add({ rule: 'add-hopf', nodes: [4, 5] });
  build.add({ rule: 'split', nodes: [random() < 0.5 ? 4 : 5], phase: 1 + Math.floor(random() * 3) });
  if (difficulty > 1) {
    build.add({ rule: 'insert-hh', edge: build.diagram.edges[Math.floor(random() * build.diagram.edges.length)] });
    const choices = build.diagram.nodes.filter(spider);
    build.add({ rule: 'color', nodes: [choices[Math.floor(random() * choices.length)].id] });
  }
  const length = 3 + difficulty * 3;
  const weights = { insert: 2, 'insert-hh': 1, split: 4, 'add-hopf': 1, color: 3 };
  for (let attempt = 0; attempt < 64 && build.solution.length < length; attempt++) {
    const choices = availableMoves(build.diagram, { expand: true }).filter(move => weights[move.rule]);
    if (!choices.length) break;
    const total = choices.reduce((sum, move) => sum + weights[move.rule], 0);
    let pick = random() * total, chosen = choices[choices.length - 1];
    for (const move of choices) {
      pick -= weights[move.rule];
      if (pick < 0) { chosen = move; break; }
    }
    if (chosen.rule === 'split') chosen = { ...chosen, phase: 1 + Math.floor(random() * 3) };
    build.add(chosen);
  }
  return { diagram: build.diagram, solution: build.solution, rules: [...RULE_IDS] };
}

export const LEVELS = levels;

// The first two actions are fusion and identity; only then introduce H and Hopf.
const tutorial = builder();
tutorial.add({ rule: 'insert', edge: [0, 2], kind: 'z' });
tutorial.add({ rule: 'insert', edge: [1, 3], kind: 'x' });
tutorial.add({ rule: 'add-hopf', nodes: [4, 5] });
tutorial.add({ rule: 'color', nodes: [4] });
tutorial.add({ rule: 'insert-hh', edge: [1, 5] });
tutorial.add({ rule: 'insert', edge: [0, 6], kind: 'z' });
tutorial.add({ rule: 'split', nodes: [12], phase: 1 });
export const TUTORIAL = { diagram: tutorial.diagram, solution: tutorial.solution };
