import { createConstruction, type Algorithm, type FieldMetadata } from '../lib/circuits/circuit-engine';
import fields from '../lib/circuits/fields.json';

let key = '';
let construction: ReturnType<typeof createConstruction>;

self.onmessage = ({ data }: MessageEvent<unknown>) => {
  const input = data as { id: number; q: number; k: number; algorithm: Algorithm; depth: number } | null;
  const id = input && Number.isSafeInteger(input.id) && input.id >= 0 ? input.id : undefined;
  try {
    if (!input || typeof input !== 'object' || id === undefined ||
        !Number.isInteger(input.q) || !Number.isInteger(input.k) || typeof input.algorithm !== 'string' ||
        !Number.isSafeInteger(input.depth) || input.depth < 0) {
      throw new Error('Choose a field size, control count, algorithm and nonnegative recursion depth.');
    }
    const metadata = Object.hasOwn(fields, input.q) ? (fields as Record<string, FieldMetadata>)[input.q] : undefined;
    if (!metadata) throw new Error('Use a prime power ≤ 256 with characteristic ≥ 5.');
    const nextKey = `${input.q}/${input.k}/${input.algorithm}`;
    if (nextKey !== key) {
      construction = createConstruction(input.q, input.k, input.algorithm, metadata);
      key = nextKey;
    }
    const maxDepth = Math.max(1, construction.maxDepth);
    const depth = Math.min(input.depth, maxDepth);
    const circuit = construction.generate(depth);
    self.postMessage({ id, circuit, p: metadata.characteristic, maxDepth, depth });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : 'The circuit could not be constructed.' });
  }
};
