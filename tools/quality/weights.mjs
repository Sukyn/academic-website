// Per-file growth limits using raw size and estimated gzip; report PDFs separately.
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const KiB = 1024;
const budgets = {
  '.js': { bytes: 128 * KiB, gzip: 32 * KiB }, '.css': { bytes: 96 * KiB, gzip: 16 * KiB },
  '.html': { bytes: 512 * KiB, gzip: 48 * KiB }, '.json': { bytes: 32 * KiB, gzip: 32 * KiB },
};
const assets = [], downloads = [];
const files = await readdir('dist', { recursive: true });
assert.ok(files.some(file => file.endsWith('.html')), 'Build the website before checking its size.');

async function measure(path, limit) {
  const data = await readFile(path), gzip = gzipSync(data).length;
  assets.push({ path: path.replaceAll('\\', '/'), bytes: data.length, gzip, limit });
}

for (const file of files) {
  const extension = extname(file), path = join('dist', file);
  if (budgets[extension]) {
    await measure(path, budgets[extension]);
  } else if (extension === '.pdf') {
    downloads.push({ path: file.replaceAll('\\', '/'), bytes: (await stat(path)).size });
  }
}
for (const file of await readdir('src/lib', { recursive: true })) {
  if (file.endsWith('.json')) await measure(join('src/lib', file), budgets['.json']);
}
assets.sort((a, b) => b.gzip - a.gzip);
downloads.sort((a, b) => b.bytes - a.bytes);
const failures = assets.filter(asset => asset.bytes > asset.limit.bytes || asset.gzip > asset.limit.gzip);
await mkdir('tmp/quality-report', { recursive: true });
await writeFile('tmp/quality-report/weights.json', JSON.stringify({ budgets, assets, downloads }, null, 2));
assert.deepEqual(failures.map(({ path, bytes, gzip, limit }) => ({ path, bytes, gzip, limit })), [], 'Asset growth exceeded its size budget.');
console.log(`${assets.length} HTML, script, style and JSON files fit their raw and estimated gzip budgets.`);
console.log(`Largest: ${assets[0].path} (${(assets[0].gzip / KiB).toFixed(1)} KiB estimated gzip). Optional PDF downloads: ${downloads.length}.`);
