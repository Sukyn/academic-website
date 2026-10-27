import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findPython, readHealth, sourceFingerprint } from '../tools/minimality/dev.mjs';

const health = {
  service: 'minimality-dev', version: 1, sourceRoot: null,
  projectRoot: fileURLToPath(new URL('../', import.meta.url)), sourceFingerprint: sourceFingerprint(),
};

async function withService(body, check) {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await check(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('dev startup reuses only an identified API with the requested source', async () => {
  await withService(health, async (base) => {
    assert.equal((await readHealth(base, null, new AbortController().signal)).service, 'minimality-dev');
    await assert.rejects(readHealth(base, '/some/checkout', new AbortController().signal), /different source checkout/);
  });
});

test('dev startup detects old API code and gives restart guidance', async () => {
  for (const body of [
    { service: 'minimality-dev', version: 1, sourceRoot: null },
    { ...health, sourceFingerprint: 'old source' },
  ]) {
    await withService(body, async (base) => {
      await assert.rejects(readHealth(base, null, new AbortController().signal), /out of date.*Ctrl\+C.*npm run dev/);
      assert.equal((await fetch(base)).status, 200);
    });
  }
});

test('dev startup refuses an API from another website checkout', async () => {
  await withService({ ...health, projectRoot: '/another/website' }, async (base) => {
    await assert.rejects(readHealth(base, null, new AbortController().signal), /different website checkout/);
  });
});

test('dev startup refuses an unrelated service instead of stopping it', async () => {
  await withService({ message: 'another application' }, async (base) => {
    await assert.rejects(readHealth(base, null, new AbortController().signal), /occupied by another service/);
    const response = await fetch(base);
    assert.equal(response.status, 200);
  });
});

test('cancelling startup immediately cancels its health check', async () => {
  await withService(health, async base => {
    const controller = new AbortController(), reason = new Error('Startup cancelled');
    controller.abort(reason);
    await assert.rejects(readHealth(base, null, controller.signal), error => error === reason);
  });
});

test('an unavailable explicit Python interpreter produces actionable setup guidance', () => {
  assert.throws(() => findPython('/missing/minimality-python'), /Python 3\.11\+.*requirements\.txt.*MINIMALITY_PYTHON/);
});
