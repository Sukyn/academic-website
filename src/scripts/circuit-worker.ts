import { createConstruction, type Algorithm, type FieldMetadata } from '../lib/circuits/circuit-engine';
import fields from '../lib/circuits/fields.json';

let key = '';
let construction: ReturnType<typeof createConstruction>;

self.onmessage = ({ data }: MessageEvent<{ id: number; q: number; k: number; algorithm: Algorithm; depth: number }>) => {
  try {
    const metadata = (fields as Record<string, FieldMetadata>)[data.q];
    if (!metadata) throw new Error('Use a prime power ≤ 256 with characteristic ≥ 5.');
    const nextKey = `${data.q}/${data.k}/${data.algorithm}`;
    if (nextKey !== key) {
      construction = createConstruction(data.q, data.k, data.algorithm, metadata);
      key = nextKey;
    }
    const maxDepth = Math.max(1, construction.maxDepth);
    const depth = Math.min(data.depth, maxDepth);
    const circuit = construction.generate(depth);
    self.postMessage({ id: data.id, circuit, p: metadata.characteristic, maxDepth, depth });
  } catch (error) {
    self.postMessage({ id: data.id, error: error instanceof Error ? error.message : 'The circuit could not be constructed.' });
  }
};
