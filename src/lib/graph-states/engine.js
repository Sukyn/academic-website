export const MIN_VERTICES = 3;
export const MAX_VERTICES = 8;
export const MAX_MOVES = 128;

function vertexCount(vertices) {
  if (!Number.isInteger(vertices) || vertices < MIN_VERTICES || vertices > MAX_VERTICES) {
    throw new RangeError(`Use ${MIN_VERTICES} to ${MAX_VERTICES} vertices.`);
  }
  return vertices;
}

/** A labelled, simple undirected graph. Returned edges are sorted and detached. */
export function validateGraph(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RangeError('Expected a graph.');
  const vertices = vertexCount(input.vertices);
  if (!Array.isArray(input.edges) || input.edges.length > vertices * (vertices - 1) / 2) {
    throw new RangeError('Expected a list of edges.');
  }
  const seen = new Set(), edges = [];
  for (const edge of input.edges) {
    if (!Array.isArray(edge) || edge.length !== 2 || !Number.isInteger(edge[0]) || !Number.isInteger(edge[1]) ||
        edge[0] < 0 || edge[0] >= vertices || edge[1] < 0 || edge[1] >= vertices || edge[0] === edge[1]) {
      throw new RangeError('Each edge must join two different vertices.');
    }
    const [u, v] = edge[0] < edge[1] ? edge : [edge[1], edge[0]], key = `${u}:${v}`;
    if (seen.has(key)) throw new RangeError('An edge occurs more than once.');
    seen.add(key);
    edges.push([u, v]);
  }
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { vertices, edges };
}

export function pathGraph(vertices) {
  vertexCount(vertices);
  return { vertices, edges: Array.from({ length: vertices - 1 }, (_, v) => [v, v + 1]) };
}

// At most 28 bits: compact keys avoid arrays and graph clones during orbit search.
function edgeBit(vertices, u, v) {
  if (u > v) [u, v] = [v, u];
  return 1 << (u * (2 * vertices - u - 1) / 2 + v - u - 1);
}

function graphMask(graph) {
  let mask = 0;
  for (const [u, v] of graph.edges) mask |= edgeBit(graph.vertices, u, v);
  return mask;
}

function fromMask(vertices, mask) {
  const edges = [];
  for (let u = 0; u < vertices; u++) for (let v = u + 1; v < vertices; v++) {
    if (mask & edgeBit(vertices, u, v)) edges.push([u, v]);
  }
  return { vertices, edges };
}

function localComplement(vertices, mask, vertex) {
  const neighbours = [];
  for (let v = 0; v < vertices; v++) if (v !== vertex && (mask & edgeBit(vertices, vertex, v))) neighbours.push(v);
  for (let a = 0; a < neighbours.length; a++) for (let b = a + 1; b < neighbours.length; b++) {
    mask ^= edgeBit(vertices, neighbours[a], neighbours[b]);
  }
  return mask;
}

function moveVertices(graph, move) {
  if (!move || typeof move !== 'object' || Array.isArray(move) || Object.keys(move).length !== 1) {
    throw new RangeError('Choose a vertex or an existing edge.');
  }
  if (Object.hasOwn(move, 'vertex') && Number.isInteger(move.vertex) && move.vertex >= 0 && move.vertex < graph.vertices) {
    return [move.vertex];
  }
  if (Object.hasOwn(move, 'edge') && Array.isArray(move.edge) && move.edge.length === 2) {
    const [u, v] = move.edge;
    if (Number.isInteger(u) && Number.isInteger(v) && u !== v && graph.edges.some(([a, b]) => a === Math.min(u, v) && b === Math.max(u, v))) {
      return [u, v, u];
    }
  }
  throw new RangeError('Choose a vertex or an existing edge.');
}

/** Edge pivot means LC(u), LC(v), LC(u), without swapping vertex labels. */
export function applyMove(input, move) {
  const graph = validateGraph(input), vertices = moveVertices(graph, move);
  let mask = graphMask(graph);
  for (const vertex of vertices) mask = localComplement(graph.vertices, mask, vertex);
  return fromMask(graph.vertices, mask);
}

/** Count local complementations in an already validated replay. */
export function sequenceCost(sequence) {
  return sequence.reduce((shots, move) => shots + (Object.hasOwn(move, 'edge') ? 3 : 1), 0);
}

/** U_v = exp(-iπX_v/4) ∏ exp(+iπZ_u/4), up to a global phase.
 * H S H implements the vertex rotation; S† acts on its current neighbours.
 * Pivot corrections use the updated neighbourhood at each of its three LCs.
 * Local-complementation identity: https://ir.cwi.nl/pub/30374/30374.pdf, Eq. (15).
 */
export function correctionColumns(input, move) {
  const graph = validateGraph(input), vertices = moveVertices(graph, move), columns = [];
  let mask = graphMask(graph);
  for (const vertex of vertices) {
    const middle = [{ gate: 'S', wires: [vertex] }];
    for (let v = 0; v < graph.vertices; v++) {
      if (v !== vertex && (mask & edgeBit(graph.vertices, vertex, v))) middle.push({ gate: 'SDG', wires: [v] });
    }
    columns.push([{ gate: 'H', wires: [vertex] }], middle, [{ gate: 'H', wires: [vertex] }]);
    mask = localComplement(graph.vertices, mask, vertex);
  }
  return columns;
}

export function isSolved(input) {
  const graph = validateGraph(input);
  return graphMask(graph) === graphMask(pathGraph(graph.vertices));
}

const orbits = new Map();
function pathOrbit(vertices) {
  if (orbits.has(vertices)) return orbits.get(vertices);
  const start = graphMask(pathGraph(vertices)), records = new Map([[start, { distance: 0 }]]), queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const mask = queue[cursor], distance = records.get(mask).distance + 1;
    const visit = (next, move) => {
      if (records.has(next)) return;
      records.set(next, { distance, parent: mask, move });
      queue.push(next);
    };
    for (let v = 0; v < vertices; v++) visit(localComplement(vertices, mask, v), { vertex: v });
    for (let u = 0; u < vertices; u++) for (let v = u + 1; v < vertices; v++) if (mask & edgeBit(vertices, u, v)) {
      let next = localComplement(vertices, mask, u);
      next = localComplement(vertices, next, v);
      visit(localComplement(vertices, next, u), { edge: [u, v] });
    }
  }
  orbits.set(vertices, records);
  return records;
}

/** Imported puzzles must belong to the labelled chain's local-Clifford orbit. */
export function puzzleData(input) {
  const graph = validateGraph(input);
  if (!pathOrbit(graph.vertices).has(graphMask(graph))) throw new RangeError('This graph cannot be turned into the target chain.');
  return graph;
}

/** Exact shot count: a pivot costs three LCs, so it cannot shorten an LC-only path. */
export function optimalShots(input) {
  const graph = puzzleData(input), records = pathOrbit(graph.vertices), start = graphMask(pathGraph(graph.vertices));
  if (records.get(start).shotDistance === undefined) {
    records.get(start).shotDistance = 0;
    const queue = [start];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const mask = queue[cursor], distance = records.get(mask).shotDistance + 1;
      for (let vertex = 0; vertex < graph.vertices; vertex++) {
        const next = localComplement(graph.vertices, mask, vertex), record = records.get(next);
        if (record.shotDistance !== undefined) continue;
        record.shotDistance = distance;
        queue.push(next);
      }
    }
  }
  return records.get(graphMask(graph)).shotDistance;
}

export function solutionForGraph(input) {
  const graph = puzzleData(input), records = pathOrbit(graph.vertices), sequence = [];
  let record = records.get(graphMask(graph));
  while (record.move) {
    sequence.push(structuredClone(record.move));
    record = records.get(record.parent);
  }
  return sequence;
}

/** Stable mask ordering makes generated puzzles independent of Map traversal. */
export function graphsAtDistance(vertices, distance) {
  vertexCount(vertices);
  return [...pathOrbit(vertices)].filter(([, record]) => record.distance === distance)
    .sort(([a], [b]) => a - b).map(([mask]) => fromMask(vertices, mask));
}
