import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('the direct-link Minimality preview opts out of search indexing', async () => {
  assert.match(await read('src/pages/minimality.astro'), /<BaseLayout\b[^>]*\bnoindex(?:=\{true\})?(?:\s|>)/);
});

test('the sitemap omits the preview without excluding unrelated pages', async () => {
  // Evaluate the configured predicate without starting Astro or its build hooks.
  const expression = (await read('astro.config.mjs')).match(/filter:\s*(\(page\)\s*=>[^\r\n]+)/)?.[1].replace(/,\s*$/, '');
  assert.ok(expression, 'The sitemap has an explicit page filter');
  const include = vm.runInNewContext(`(${expression})`, { URL }, { timeout: 1_000 });
  for (const path of ['/minimality', '/minimality/', '/minimality/example/']) {
    assert.equal(include('https://www.colin-blake.eu' + path), false, path);
  }
  for (const path of ['/', '/publications/', '/games/', '/minimality-tools/']) {
    assert.equal(include('https://www.colin-blake.eu' + path), true, path);
  }
});

test('public pages and navigation do not advertise the preview route', async () => {
  const route = /["'`](?:https:\/\/www\.colin-blake\.eu)?\/minimality(?:\/|["'`?#])/;
  for (const directory of ['src/pages/', 'src/components/', 'src/data/']) {
    const files = await readdir(new URL('../' + directory, import.meta.url), { recursive: true });
    for (const file of files.filter(file => /\.(astro|js|ts|json)$/.test(file))) {
      const path = directory + file.replaceAll('\\', '/');
      if (path === 'src/pages/minimality.astro') continue;
      assert.doesNotMatch(await read(path), route, path);
    }
  }
});
