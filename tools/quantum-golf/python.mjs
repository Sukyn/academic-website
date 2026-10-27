import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function pythonCommands(override = process.env.QUANTUM_GOLF_PYTHON) {
  return override
    ? [[override]]
    : process.platform === 'win32' ? [['py', '-3'], ['python']] : [['python3']];
}

export function runPython(args, options = {}) {
  for (const [command, ...prefix] of pythonCommands()) {
    const result = spawnSync(command, [...prefix, ...args], { encoding: 'utf8', ...options });
    if (result.error?.code !== 'ENOENT') return result;
  }
  return { status: 1, stderr: 'Install Python 3 or set QUANTUM_GOLF_PYTHON to its executable.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runPython(process.argv.slice(2), { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.stderr) console.error(result.stderr);
  process.exitCode = result.status ?? 1;
}
