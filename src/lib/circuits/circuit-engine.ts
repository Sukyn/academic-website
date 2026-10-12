/** Browser implementation of python_algorithms, using the same gate JSON. */
const ALGORITHMS = [
  'simple_polarization', 'divide-and-conquer', 'borrow', 'borrow-and-conquer',
] as const;
export type Algorithm = typeof ALGORITHMS[number];
type InternalAlgorithm = Algorithm | 'binary-borrowed-ladder';

export type Operation =
  | { op: 'add'; controls: number[]; target: number; coefficient: number }
  | { op: 'swap'; wire: number; a: number; b: number }
  | { op: 'scale'; wire: number; coefficient: number };

export interface Circuit {
  q: number;
  wire_count: number;
  operations: Operation[];
  modulus?: number[];
}

/** Metadata must use the same canonical basis and primitive element as galois. */
export interface FieldMetadata {
  characteristic: number;
  primitive: number;
  /** Monic irreducible polynomial, highest-degree coefficient first. */
  modulus?: number[];
}

const MAX_OPERATIONS = 12000;
const mod = (a: number, p: number) => ((a % p) + p) % p;

/** Elements are integers whose base-p digits are polynomial coefficients. */
export class Field {
  readonly p: number;
  readonly degree: number;
  private readonly digits: number[][];

  constructor(readonly q: number, readonly metadata: FieldMetadata) {
    this.p = metadata.characteristic;
    // Callers supply canonical metadata from the checked-in fields.json whitelist.
    this.degree = metadata.modulus ? metadata.modulus.length - 1 : 1;
    this.digits = Array.from({ length: q }, (_, label) =>
      Array.from({ length: this.degree }, (_, index) => Math.floor(label / this.p ** index) % this.p));
  }

  scalar(value: number): number { return mod(value, this.p); }
  private encode(coefficients: number[]): number {
    return coefficients.reduce((value, c, i) => value + mod(c, this.p) * this.p ** i, 0);
  }
  add(a: number, b: number): number {
    if (this.degree === 1) return (a + b) % this.p;
    return this.encode(this.digits[a].map((c, i) => c + this.digits[b][i]));
  }
  neg(a: number): number {
    if (this.degree === 1) return mod(-a, this.p);
    return this.encode(this.digits[a].map(c => -c));
  }
  sub(a: number, b: number): number { return this.add(a, this.neg(b)); }
  mul(a: number, b: number): number {
    if (this.degree === 1) return (a * b) % this.p;
    const coefficients = Array(2 * this.degree - 1).fill(0) as number[];
    for (let i = 0; i < this.degree; i++) {
      for (let j = 0; j < this.degree; j++) {
        coefficients[i + j] += this.digits[a][i] * this.digits[b][j];
      }
    }
    for (let power = coefficients.length - 1; power >= this.degree; power--) {
      const leading = mod(coefficients[power], this.p);
      for (let offset = 0; offset <= this.degree; offset++) {
        coefficients[power - this.degree + offset] -=
          leading * this.metadata.modulus![this.degree - offset];
      }
    }
    return this.encode(coefficients.slice(0, this.degree));
  }
  pow(value: number, exponent: number): number {
    let result = 1;
    while (exponent > 0) {
      if (exponent % 2) result = this.mul(result, value);
      value = this.mul(value, value);
      exponent = Math.floor(exponent / 2);
    }
    return result;
  }
  inv(value: number): number {
    if (!value) throw new Error('Cannot invert zero in a finite field.');
    return this.pow(value, this.q - 2);
  }
  div(a: number, b: number): number { return this.mul(a, this.inv(b)); }
}

type Entry = { cost: number; sizes: number[] };
interface Tables { divide: Entry[]; mixed?: Entry[][] }
const unreachable = (): Entry => ({ cost: Infinity, sizes: [] });
const maxDegree = (q: number, p: number) => Math.min(p - 1, q - 2);

function powerOrder(q: number, degree: number): number {
  for (let r = 2; r <= q - 1; r++) {
    if ((q - 1) % r === 0 && degree % r !== 0) return r;
  }
  throw new Error('This power has no admissible multiplier.');
}
function powerCost(q: number, degree: number): number {
  const r = powerOrder(q, degree);
  return 2 ** (degree - 1) * ((q - 1) / r) * (r - 1);
}
function lexicographicallyBefore(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return a.length < b.length;
}
function addGroup(previous: Entry[], costs: number[]): Entry[] {
  const result = [unreachable()];
  for (let total = 1; total < previous.length; total++) {
    let best: Entry | undefined;
    for (let size = 1; size <= total; size++) {
      const cost = previous[total - size].cost + costs[size];
      if (best && cost > best.cost) continue;
      const candidate = { cost, sizes: [...previous[total - size].sizes, size] };
      // Python min compares (cost, sizes), including unreachable entries.
      if (!best || candidate.cost < best.cost ||
          (candidate.cost === best.cost && lexicographicallyBefore(candidate.sizes, best.sizes))) {
        best = candidate;
      }
    }
    result.push(best!);
  }
  return result;
}

function countTables(q: number, maxD: number, borrowed: number, algorithm: InternalAlgorithm, p: number): Tables {
  function polarization(costs: number[]): Entry[] {
    const best = Array.from({ length: costs.length + 1 }, unreachable);
    let partitions = Array.from({ length: costs.length }, unreachable);
    partitions[0] = { cost: 0, sizes: [] };
    const limit = Math.min(maxDegree(q, p) - 1, costs.length - 1);
    for (let groups = 1; groups <= limit; groups++) {
      const weight = 2 + 2 ** (groups - 1);
      partitions = addGroup(partitions, costs.map(c => weight * c));
      const powers = powerCost(q, groups + 1);
      for (let d = groups + 1; d < best.length; d++) {
        const entry = partitions[d - 1];
        const cost = entry.cost + powers;
        if (cost < best[d].cost) best[d] = { cost, sizes: entry.sizes };
      }
    }
    return best;
  }

  const divide = [unreachable(), { cost: 0, sizes: [] }, { cost: powerCost(q, 2), sizes: [1] }];
  if (algorithm === 'divide-and-conquer') {
    for (let d = 3; d <= maxD; d++) divide.push(polarization(divide.map(entry => entry.cost))[d]);
  }
  const tables: Tables = { divide };
  if (algorithm === 'borrow-and-conquer') {
    let previous = [Infinity];
    const mixed: Entry[][] = [[]];
    for (let total = 1; total <= maxD + borrowed; total++) {
      const current = polarization(previous);
      current[1] = { cost: 0, sizes: [] };
      const prefixes: Entry[][] = [[], previous.map((c, s) => ({ cost: 2 * c, sizes: [s] }))];
      const middle = [...previous.slice(1).map(c => 4 * c), Infinity];
      for (let groups = 2; groups <= Math.floor((total - 1) / 2); groups++) {
        prefixes.push(addGroup(prefixes[prefixes.length - 1], middle));
      }
      for (let d = 3; d <= total; d++) {
        for (let groups = 1; groups <= Math.min(total - d, d - 1); groups++) {
          for (let used = Math.max(groups, 2); used < d; used++) {
            const prefix = prefixes[groups][used];
            const cost = prefix.cost + 2 * current[d - used + 1].cost;
            if (cost < current[d].cost) current[d] = { cost, sizes: [...prefix.sizes, d - used] };
          }
        }
      }
      mixed.push(current);
      previous = current.map(entry => entry.cost);
    }
    tables.mixed = mixed;
  }
  return tables;
}

function groupSizes(tables: Tables, d: number, borrowed: number, algorithm: InternalAlgorithm): number[] {
  if (d <= 2) return tables.divide[d].sizes;
  if (algorithm === 'simple_polarization') return Array(d - 1).fill(1);
  if (algorithm === 'binary-borrowed-ladder') return [2, ...Array(d - 2).fill(1)];
  if (algorithm === 'borrow') return [];
  return (algorithm === 'borrow-and-conquer' ? tables.mixed![d + borrowed][d] : tables.divide[d]).sizes;
}

/** Prepare one construction and reuse it for different recursion cutoffs. */
export function createConstruction(
  q: number, k: number, algorithm: Algorithm, metadata: FieldMetadata, borrowed = 0,
) {
  if (!Number.isInteger(k) || k < 1 || k > 32) throw new Error('Choose between 1 and 32 controls.');
  if (!Number.isInteger(borrowed) || borrowed < 0 || k + borrowed > 64) {
    throw new Error('Borrowed wires must be nonnegative, with at most 64 controls and borrowed wires in total.');
  }
  if (!ALGORITHMS.includes(algorithm)) throw new Error('Choose one of the four supported algorithms.');
  const K = new Field(q, metadata);
  const p = K.p;
  if (algorithm === 'simple_polarization' && k > maxDegree(q, p)) {
    throw new Error(`Simple polarization requires at most ${maxDegree(q, p)} controls in this field.`);
  }
  const tables = countTables(q, k, borrowed, algorithm, p);
  const powerCache = new Map<number, { scale: number; swaps: { a: number; b: number; coefficient: number }[] }>();
  const memo = new Map<string, number>();
  function visit(d: number, borrowed: number, family: InternalAlgorithm): number {
    if (d === 1) return 0;
    const key = `${d},${borrowed},${family}`;
    const saved = memo.get(key);
    if (saved !== undefined) return saved;
    const sizes = groupSizes(tables, d, borrowed, family);
    if (family === 'binary-borrowed-ladder') family = 'divide-and-conquer';
    let children: number[];
    if (family === 'borrow' && d > 2) {
      const f = Math.floor((d + 1) / 2);
      const h = Math.floor(d / 2);
      children = [visit(f, h - 1, 'binary-borrowed-ladder'),
        visit(h, f - 1, 'binary-borrowed-ladder'), visit(2, 0, 'divide-and-conquer')];
    } else if (sizes.reduce((sum, size) => sum + size, 0) === d) {
      children = sizes.map((size, index) => {
        const subcontrols = size + (index === 0 ? 0 : 1);
        const workspace = family === 'borrow-and-conquer'
          ? d + borrowed - subcontrols - (index === sizes.length - 1 ? 0 : 1) : 0;
        return visit(subcontrols, workspace, family);
      });
    } else {
      children = sizes.map(size => visit(size,
        family === 'borrow-and-conquer' ? d + borrowed - size - 1 : 0, family));
    }
    const result = 1 + Math.max(...children);
    memo.set(key, result);
    return result;
  }
  const maxDepth = visit(k, borrowed, algorithm);

  /** Build t += c_1 ... c_k, restoring all controls. null means full expansion. */
  function generate(maxRec: number | null): Circuit {
    if (maxRec !== null && (!Number.isInteger(maxRec) || maxRec < 0)) {
      throw new Error('Recursion depth must be a nonnegative integer.');
    }
    const operations: Operation[] = [];
    function append(gate: Operation): void {
      if (operations.length >= MAX_OPERATIONS) {
        throw new Error('This circuit exceeds 12,000 operations. Reduce the controls or recursion depth.');
      }
      operations.push(gate);
    }
    function add(controls: number[], target: number, coefficient: number): void {
      const previous = operations[operations.length - 1];
      if (coefficient && controls.length === 1 && previous?.op === 'add' && previous.target === target &&
          previous.controls.length === 1 && previous.controls[0] === controls[0]) {
        operations.pop();
        coefficient = K.add(coefficient, previous.coefficient);
      }
      if (coefficient) append({ op: 'add', controls: [...controls], target, coefficient });
    }
    function power(source: number, target: number, degree: number, coefficient: number): void {
      let plan = powerCache.get(degree);
      if (!plan) {
        const order = powerOrder(q, degree);
        const multiplier = K.pow(metadata.primitive, (q - 1) / order);
        const seen = new Set<number>();
        const swaps: { a: number; b: number; coefficient: number }[] = [];
        for (let a = 1; a < q; a++) {
          if (seen.has(a)) continue;
          seen.add(a);
          let previous = a;
          let prefix = 0;
          for (let b = K.mul(multiplier, a); b !== a; b = K.mul(multiplier, b)) {
            seen.add(b);
            prefix = K.add(prefix, K.pow(previous, degree));
            swaps.push({ a, b, coefficient: K.neg(K.div(prefix, K.sub(b, a))) });
            previous = b;
          }
        }
        plan = { scale: K.inv(multiplier), swaps };
        powerCache.set(degree, plan);
      }
      const scalar = K.scalar(coefficient);
      for (const swap of plan.swaps) {
        const transfer = K.mul(scalar, swap.coefficient);
        add([source], target, transfer);
        append({ op: 'swap', wire: source, a: swap.a, b: swap.b });
        add([source], target, K.neg(transfer));
      }
      append({ op: 'scale', wire: source, coefficient: plan.scale });
    }
    function split(wires: number[], sizes: number[]): number[][] {
      let offset = 0;
      return sizes.map(size => { const group = wires.slice(offset, offset + size); offset += size; return group; });
    }
    function product(controls: number[], target: number, borrowed: number[], family: InternalAlgorithm,
                     coefficient = 1, depth = 0): void {
      if (controls.length === 1 || (maxRec !== null && depth >= maxRec)) {
        add(controls, target, K.scalar(coefficient));
        return;
      }
      const sizes = groupSizes(tables, controls.length, borrowed.length, family);
      if (family === 'binary-borrowed-ladder') family = 'divide-and-conquer';
      if (family === 'borrow' && controls.length > 2) borrow(controls, target, coefficient, depth);
      else if (sizes.reduce((sum, size) => sum + size, 0) === controls.length) {
        ladder(controls, target, borrowed, sizes, family, coefficient, depth);
      } else polarization(controls, target, borrowed, sizes, family, coefficient, depth);
    }
    function subproduct(controls: number[], target: number, available: number[], family: InternalAlgorithm,
                        coefficient: number, depth: number): void {
      const workspace = family === 'borrow-and-conquer'
        ? available.filter(wire => wire !== target && !controls.includes(wire)) : [];
      product(controls, target, workspace, family, coefficient, depth + 1);
    }
    function polarization(controls: number[], target: number, borrowed: number[], sizes: number[],
                          family: InternalAlgorithm, coefficient: number, depth: number): void {
      const source = controls[0];
      const groups = split(controls.slice(1), sizes);
      const available = [...controls, ...borrowed];
      const degree = groups.length + 1;
      let denominator = 1;
      for (let i = 1; i <= degree; i++) denominator = denominator * i % p;
      for (let i = 1; i < degree; i++) denominator = denominator * 2 % p;
      const weights = K.scalar(coefficient * K.inv(denominator));
      const prepare = (index: number, scale: number) =>
        subproduct(groups[index], source, available, family, scale, depth);
      for (let i = 0; i < groups.length; i++) prepare(i, 1);
      let previous = 0;
      for (let index = 0; index < 2 ** groups.length; index++) {
        const gray = index ^ (index >>> 1);
        let parity = 0;
        for (let i = 0; i < groups.length; i++) {
          const shift = groups.length - i - 1;
          const before = (previous >>> shift) & 1;
          const after = (gray >>> shift) & 1;
          if (before !== after) prepare(i, after === 0 ? 2 : -2);
          parity += after;
        }
        power(source, target, degree, parity % 2 ? -weights : weights);
        previous = gray;
      }
      for (let i = 0; i < groups.length; i++) {
        prepare(i, ((previous >>> (groups.length - i - 1)) & 1) === 0 ? -1 : 1);
      }
    }
    function ladder(controls: number[], target: number, borrowed: number[], sizes: number[],
                    family: InternalAlgorithm, coefficient: number, depth: number): void {
      const groups = split(controls, sizes);
      const ladderWires = borrowed.slice(0, groups.length - 1);
      const available = [...controls, ...borrowed];
      const last = groups.length - 1;
      function update(index: number, scale: number): void {
        const subcontrols = index === 0 ? groups[index] : [ladderWires[index - 1], ...groups[index]];
        const subtarget = index === last ? target : ladderWires[index];
        subproduct(subcontrols, subtarget, available, family, scale, depth);
      }
      for (const [start, sign] of [[0, 1], [1, -1]]) {
        for (let i = start; i < last; i++) update(i, 1);
        update(last, sign * coefficient);
        for (let i = last - 1; i >= start; i--) update(i, -1);
      }
    }
    function borrow(controls: number[], target: number, coefficient: number, depth: number): void {
      const midpoint = Math.floor((controls.length + 1) / 2);
      const fControls = controls.slice(0, midpoint);
      const [y, ...hControls] = controls.slice(midpoint);
      const z = fControls[0];
      const quarter = K.scalar(coefficient * K.inv(4));
      const prepareF = (scale: number) =>
        product(fControls, y, hControls, 'binary-borrowed-ladder', scale, depth + 1);
      function square(scale: number): void {
        for (const sign of [1, -1]) {
          product([y, ...hControls], z, fControls.slice(1), 'binary-borrowed-ladder', sign, depth + 1);
          product([y, z], target, [], 'divide-and-conquer', sign * scale, depth + 1);
        }
      }
      prepareF(1);
      square(quarter);
      prepareF(-2);
      square(-quarter);
      prepareF(1);
    }
    const borrowedWires = Array.from({ length: borrowed }, (_, index) => k + 1 + index);
    product(Array.from({ length: k }, (_, index) => index), k, borrowedWires, algorithm);
    const circuit: Circuit = { q, wire_count: k + 1 + borrowed, operations };
    if (K.degree > 1) circuit.modulus = [...metadata.modulus!];
    return circuit;
  }
  return { maxDepth, generate };
}
