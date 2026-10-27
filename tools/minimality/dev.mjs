import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pythonCommands } from '../quantum-golf/python.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const healthPath = '/__minimality_health';

export function sourceFingerprint() {
  const hash = createHash('sha256');
  for (const path of ['api/minimality.py', 'tools/minimality/dev.py']) {
    hash.update(readFileSync(resolve(root, path))).update('\0');
  }
  return hash.digest('hex');
}

export function findPython(override) {
  let needsNumpy = false;
  const commands = override ? pythonCommands(override) : [
    [resolve(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python')],
    ...pythonCommands(),
  ];
  for (const [command, ...prefix] of commands) {
    const probe = spawnSync(command, [...prefix, '-c',
      'import json, sys; print(json.dumps({"executable": sys.executable, "version": list(sys.version_info[:2])})); import numpy',
    ], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    try {
      const { executable, version } = JSON.parse(probe.stdout.trim());
      if (version[0] !== 3 || version[1] < 11) continue;
      if (probe.status === 0) return executable;
      needsNumpy = true;
    } catch { /* Try the next installed interpreter, including past Windows Store aliases. */ }
  }
  throw new Error(needsNumpy
    ? 'The minimality API needs NumPy. Run python -m pip install -r requirements.txt, or set MINIMALITY_PYTHON to an interpreter with NumPy.'
    : 'The minimality API needs Python 3.11+. Install Python and run python -m pip install -r requirements.txt, or set MINIMALITY_PYTHON to its executable.');
}

export async function readHealth(base, sourceRoot, signal) {
  let response;
  try {
    response = await fetch(new URL(healthPath, base), {
      signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    if (error.cause?.code === 'ECONNREFUSED') return null;
    throw new Error(`Cannot verify the minimality API at ${base}. Choose another MINIMALITY_API_PORT.`, { cause: error });
  }
  const health = await response.json().catch(() => null);
  if (!response.ok || health?.service !== 'minimality-dev' || health?.version !== 1) {
    throw new Error(`Port ${new URL(base).port} is occupied by another service. Stop it or set MINIMALITY_API_PORT.`);
  }
  const normalize = (value) => typeof value === 'string' ? (process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value)) : null;
  if (health.projectRoot && normalize(health.projectRoot) !== normalize(root)) {
    throw new Error('The running minimality API uses a different website checkout. Stop it or choose another MINIMALITY_API_PORT.');
  }
  if (normalize(health.sourceRoot) !== normalize(sourceRoot)) {
    throw new Error('The running minimality API uses a different source checkout. Stop it or choose another MINIMALITY_API_PORT.');
  }
  if (!health.projectRoot || health.sourceFingerprint !== sourceFingerprint()) {
    throw new Error(`The minimality API at ${base} is out of date. Stop the old dev server with Ctrl+C, then run npm run dev again.`);
  }
  return health;
}

function start(command, args, env) {
  const child = spawn(command, args, {
    cwd: root, env, stdio: 'inherit', windowsHide: true, detached: process.platform !== 'win32',
  });
  const exited = new Promise((resolveExit) => {
    child.once('error', (error) => resolveExit({ code: 1, error }));
    child.once('exit', (code) => resolveExit({ code: code ?? 1 }));
  });
  return { child, exited };
}

async function stop({ child, exited }) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    // Only this supervisor's children and their search workers are terminated.
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    killer.once('error', () => child.kill());
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
  }
  await Promise.race([exited, delay(1500, undefined, { ref: false })]);
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform !== 'win32') {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    } else child.kill('SIGKILL');
  }
}

export async function dev(args = process.argv.slice(2), env = process.env) {
  if (args.some((argument) => argument === '--background' || argument.startsWith('--background='))) {
    throw new Error('npm run dev supervises both servers in the foreground. Run it without --background.');
  }
  const port = Number(env.MINIMALITY_API_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MINIMALITY_API_PORT must be a valid port number.');
  const sourceRoot = env.MINIMALITY_SOURCE_ROOT ? resolve(env.MINIMALITY_SOURCE_ROOT) : null;
  const base = `http://127.0.0.1:${port}`;
  const controller = new AbortController();
  const cancelled = once(controller.signal, 'abort').then(() => ({ code: 0 }));
  const children = [];
  const interrupt = () => controller.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    if (!await readHealth(base, sourceRoot, controller.signal)) {
      const python = findPython(env.MINIMALITY_PYTHON);
      const apiArgs = [resolve(root, 'tools/minimality/dev.py'), '--port', String(port)];
      if (sourceRoot) apiArgs.push('--source-root', sourceRoot);
      const api = start(python, apiArgs, env);
      children.push(api);
      const ready = (async () => {
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          if (await readHealth(base, sourceRoot, controller.signal)) return;
          await delay(100, undefined, { signal: controller.signal });
        }
        throw new Error('The minimality API did not become ready. Check the Python output above.');
      })();
      await Promise.race([ready, api.exited.then(({ error }) => { throw error ?? new Error('The minimality API exited during startup.'); })]);
      console.log(`Minimality API ready at ${base}/api/minimality`);
    } else console.log(`Reusing minimality API at ${base}/api/minimality`);

    // Own this foreground instance without replacing a server started elsewhere.
    const astroArgs = args.includes('--ignore-lock') || args.includes('--force') ? args : ['--ignore-lock', ...args];
    const astro = start(process.execPath, [resolve(root, 'node_modules/astro/bin/astro.mjs'), 'dev', ...astroArgs], {
      ...env, MINIMALITY_API_PORT: String(port),
    });
    children.push(astro);
    const result = await Promise.race([...children.map(({ exited }) => exited), cancelled]);
    if (result.error) throw result.error;
    return result.code;
  } catch (error) {
    if (controller.signal.aborted) return 0;
    throw error;
  } finally {
    controller.abort();
    await Promise.all(children.map(stop));
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  dev().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
