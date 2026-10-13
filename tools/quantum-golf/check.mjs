import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { websiteFile } from './website.mjs';

const files = [
  'src/scripts/quantum-golf.js',
  'src/scripts/quantum-golf-worker.js',
  ...['quantum', 'sphere', 'solver', 'daily'].map((name) => `src/lib/quantum-golf/${name}.js`),
];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', fileURLToPath(websiteFile(file))], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`Syntax checks passed for ${files.length} game modules.`);
