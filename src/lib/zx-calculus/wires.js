/** Degree-two Hadamards decorate a wire between spiders or boundaries. */
export function decoratedWires(diagram) {
  const kinds = new Map(diagram.nodes.map(node => [node.id, node.kind]));
  const legs = new Map(diagram.nodes.map(node => [node.id, []]));
  diagram.edges.forEach(([a, b], index) => {
    legs.get(a).push({ to: b, index }); legs.get(b).push({ to: a, index });
  });
  const visited = new Set(), wires = [];
  const raw = index => {
    const [a, b] = diagram.edges[index];
    return { ids: a < b ? [a, b] : [b, a], indices: [index] };
  };
  for (const node of diagram.nodes) if (node.kind !== 'h') {
    for (const first of legs.get(node.id)) {
      if (visited.has(first.index)) continue;
      const ids = [node.id], indices = [];
      let leg = first;
      while (leg && !visited.has(leg.index)) {
        visited.add(leg.index); indices.push(leg.index); ids.push(leg.to);
        if (kinds.get(leg.to) !== 'h') break;
        leg = legs.get(leg.to).find(next => next.index !== leg.index);
      }
      if (ids[0] === ids.at(-1) || kinds.get(ids.at(-1)) === 'h') {
        wires.push(...indices.map(raw));
      } else {
        if (ids[0] > ids.at(-1)) { ids.reverse(); indices.reverse(); }
        wires.push({ ids, indices });
      }
    }
  }
  // Remaining components contain only H boxes and have no spider endpoints.
  diagram.edges.forEach((edge, index) => { if (!visited.has(index)) wires.push(raw(index)); });
  return wires;
}

export function curvePoint({ a, b, control }, t) {
  const s = 1 - t;
  return { x: s * s * a.x + 2 * s * t * control.x + t * t * b.x,
    y: s * s * a.y + 2 * s * t * control.y + t * t * b.y };
}

/** Chord projection recovers the unclamped parameter on midpoint-normal routes. */
export function curveParameter({ a, b }, point) {
  const dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy;
  return lengthSquared > 0 ? ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared : 0;
}

/** A small shared polyline supplies routing distances and arc-length placement. */
export function curveMetrics(curve) {
  const segments = [];
  let start = curve.a, length = 0;
  for (let step = 1; step <= 16; step++) {
    const end = curvePoint(curve, step / 16), dx = end.x - start.x, dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy, segmentLength = Math.sqrt(lengthSquared);
    segments.push({ start, dx, dy, lengthSquared, length: segmentLength, offset: length });
    start = end; length += segmentLength;
  }
  return { segments, length };
}

export function curveDistance(point, { segments }) {
  let nearest = Infinity;
  for (const { start, dx, dy, lengthSquared } of segments) {
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (lengthSquared || 1)));
    nearest = Math.min(nearest, (point.x - start.x - t * dx) ** 2 + (point.y - start.y - t * dy) ** 2);
  }
  return Math.sqrt(nearest);
}

export function arcFraction(t, { segments, length }) {
  t = Math.max(0, Math.min(1, t));
  if (!length) return t;
  const index = Math.min(segments.length - 1, Math.floor(t * segments.length));
  const segment = segments[index];
  return (segment.offset + segment.length * (t * segments.length - index)) / length;
}

export function arcParameter(fraction, { segments, length }) {
  fraction = Math.max(0, Math.min(1, fraction));
  if (!length || fraction === 0 || fraction === 1) return fraction;
  const distance = fraction * length;
  const index = segments.findIndex(segment => segment.offset + segment.length >= distance);
  const segment = segments[index];
  return (index + (segment.length ? (distance - segment.offset) / segment.length : 0)) / segments.length;
}

/** Exact quadratic subdivision, including reversed and zero-length slices. */
export function curveSlice(curve, start, end) {
  const a = curvePoint(curve, start), b = curvePoint(curve, end), span = end - start;
  return { a, b, control: {
    x: a.x + span * ((1 - start) * (curve.control.x - curve.a.x) + start * (curve.b.x - curve.control.x)),
    y: a.y + span * ((1 - start) * (curve.control.y - curve.a.y) + start * (curve.b.y - curve.control.y)),
  } };
}

/** Chord projection recovers t on midpoint-normal curves; new boxes fill gaps. */
/** Shared separation for laying out and sliding H boxes along a wire. */
export function hadamardGap(count, minimumGap = 0) {
  return Math.min(1 / (count + 1), Math.max(Math.min(.04, .5 / (count + 1)), minimumGap));
}

export function hadamardSlots(ids, previousPositions, a, b, { minimumGap = 0, parameter = t => t } = {}) {
  const count = ids.length - 2;
  if (count <= 0) return [];
  const chord = { a, b }, hasLength = a.x !== b.x || a.y !== b.y;
  const gap = hadamardGap(count, minimumGap);
  const anchors = [{ index: -1, t: 0 }];
  for (let index = 0; index < count; index++) {
    const position = previousPositions instanceof Map ? previousPositions.get(ids[index + 1]) : previousPositions?.[ids[index + 1]];
    if (!hasLength || !Number.isFinite(position?.x) || !Number.isFinite(position?.y)) continue;
    const projected = parameter(curveParameter(chord, position));
    const previous = anchors.at(-1), minimum = previous.t + (index - previous.index) * gap;
    anchors.push({ index, t: Math.min(1 - (count - index) * gap, Math.max(minimum, projected)) });
  }
  anchors.push({ index: count, t: 1 });
  const slots = Array(count);
  for (let index = 1; index < anchors.length; index++) {
    const left = anchors[index - 1], right = anchors[index];
    for (let slot = left.index + 1; slot < right.index; slot++) {
      slots[slot] = left.t + (right.t - left.t) * (slot - left.index) / (right.index - left.index);
    }
    if (right.index < count) slots[right.index] = right.t;
  }
  return slots;
}
