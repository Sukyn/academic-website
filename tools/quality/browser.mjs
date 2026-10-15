// Audit the built website, including hidden pages, without production score writes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBrowserApi } from '../circuit-reduction/browser-api.mjs';

const requireFrom = directory => createRequire(resolve(directory, 'package.json'));
const qualityRequire = requireFrom(process.env.QUALITY_MODULE_DIR ?? 'tmp/quality-tools/node_modules');
const { chromium } = (process.env.PLAYWRIGHT_MODULE_DIR
  ? requireFrom(process.env.PLAYWRIGHT_MODULE_DIR) : qualityRequire)('playwright');
const axeSource = await readFile(qualityRequire.resolve('axe-core/axe.min.js'), 'utf8');
const base = new URL(process.env.SITE_BASE_URL ?? 'http://127.0.0.1:4323');
const output = resolve('tmp/quality-report');
const resilienceOnly = process.argv.includes('--resilience-only');
await mkdir(output, { recursive: true });
const routes = (await readdir('dist', { recursive: true })).filter(file => file.endsWith('.html'));
assert.ok(routes.length > 0, 'Build the website before auditing it.');
const fixture = createBrowserApi();
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {}) });
const results = [], failures = [], resilience = [], links = new Map();

async function accessibility(page, label) {
  // DevTools evaluation installs the test engine without weakening the page CSP.
  await page.evaluate(axeSource);
  const report = await page.evaluate(async () => window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] },
  }));
  const violations = report.violations.map(({ id, impact, help, nodes }) => ({
    id, impact, help, targets: nodes.map(node => node.target),
  }));
  if (violations.length) failures.push({ label, violations });
  return { passedRules: report.passes.length, violations };
}

try {
  for (const [profile, options] of resilienceOnly ? [] : [
    ['desktop', { viewport: { width: 1440, height: 1000 } }],
    ['tablet', { viewport: { width: 768, height: 1024 }, hasTouch: true }],
    ['mobile', { viewport: { width: 320, height: 780 }, isMobile: true, hasTouch: true }],
  ]) {
    const context = await browser.newContext({ ...options, reducedMotion: 'reduce' });
    for (const file of routes) {
      const html = await readFile(resolve('dist', file), 'utf8');
      const pathname = file.replaceAll('\\', '/').replace(/index\.html$/, '');
      const archive = pathname.startsWith('outreach/');
      const page = await context.newPage(), errors = [], resources = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => {
        const url = new URL(response.url());
        if (url.origin === base.origin && !response.request().isNavigationRequest() && !url.pathname.startsWith('/api/')) {
          // Fixed clocks hide Resource Timing entries; keep HTTP header sizes instead.
          const size = response.headers()['content-length'];
          resources.push({ path: url.pathname, resourceType: response.request().resourceType(), contentLength: size ? Number(size) : null });
        }
        if (url.origin === base.origin && response.status() >= 400
          && !(pathname === '404.html' && response.request().isNavigationRequest())) {
          errors.push(`HTTP ${response.status()}: ${new URL(response.url()).pathname}`);
        }
      });
      page.on('requestfailed', request => {
        if (new URL(request.url()).origin === base.origin
          && ['script', 'stylesheet', 'font', 'image'].includes(request.resourceType())) {
          errors.push(`${request.failure()?.errorText}: ${new URL(request.url()).pathname}`);
        }
      });
      page.on('console', message => {
        if (message.type() === 'error' && /Content Security Policy|Refused to (execute|load|apply|connect|create)/i.test(message.text())) {
          errors.push(message.text().replace(/data:[^\s'"]+/g, 'data:…'));
        }
      });
      try {
        await fixture.install(page);
        if (archive) await page.route('https://iww.inria.fr/**', route => route.abort());
        await page.clock.setFixedTime(new Date('2026-10-14T10:00:00Z'));
        const response = await page.goto(new URL(pathname === '404.html' ? '__quality-missing__/' : pathname, base).href);
        if (/http-equiv=["']refresh["']/i.test(html)) {
          await page.waitForURL('**/games/quantum-golf/');
          results.push({ profile, pathname, redirect: page.url() });
          continue;
        }
        assert.equal(response.status(), pathname === '404.html' ? 404 : 200, pathname);
        await page.locator('main').waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('.skip-link').evaluate(link => link === document.activeElement), true, `${pathname}: skip link is first in keyboard order`);
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('main').evaluate(main => main === document.activeElement), true, `${pathname}: skip link focuses content`);
        if (pathname === '') {
          assert.equal(await page.locator('.highlights > li').count(), 2, 'Home highlights two proceedings papers');
          assert.match(await page.locator('.highlights').innerText(), /MFCS 2026.*Best Student Paper/);
          for (const filename of ['colin-blake-cv.pdf', 'research-overview.pdf']) {
            const pending = page.waitForEvent('download');
            await page.locator(`.home-links a[href="/profile/${filename}"]`).click();
            const download = await pending;
            assert.equal(download.suggestedFilename(), filename);
            const bytes = await readFile(await download.path());
            assert.equal(bytes.toString('ascii', 0, 5), '%PDF-', 'Profile downloads contain actual PDF data');
          }
        }
        if (pathname === 'circuits/') {
          await page.locator('#circuit-preview[aria-busy="false"] .circuit-row').first().waitFor();
          const extension = await page.locator('#dimension').evaluate(select =>
            [...select.options].map(option => option.value).find(value => Number.isInteger(Math.sqrt(Number(value)))));
          assert.ok(extension, 'An extension field is available');
          await page.locator('#dimension').selectOption(extension);
          await page.locator('#field-basis:not([hidden])').waitFor();
          await page.locator('#toggle-layout').click();
          assert.equal(await page.locator('#toggle-layout').getAttribute('aria-pressed'), 'true');
          await page.locator('#toggle-layout').click();
          await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
            value: { writeText: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) } }));
          await page.locator('#copy-tikz').click();
          await page.locator('#copy-fallback:not([hidden])').waitFor();
          assert.match(await page.locator('#tikz-code').inputValue(), /\\begin\{tikzpicture\}/);
        }
        const structure = await page.evaluate(() => {
          const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
          return { main: document.querySelectorAll('main').length, h1: document.querySelectorAll('h1').length,
            title: document.title, description: document.querySelector('meta[name="description"]')?.content,
            duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
            overflow: document.documentElement.scrollWidth - innerWidth,
            links: [...document.querySelectorAll('a[href]')].map(anchor => anchor.href),
            brokenReferences: [...document.querySelectorAll('[aria-labelledby], [aria-controls]')].flatMap(element =>
              ['aria-labelledby', 'aria-controls'].flatMap(attribute => (element.getAttribute(attribute) ?? '').split(/\s+/)
                .filter(id => id && !document.getElementById(id)))),
            csp: document.querySelector('meta[http-equiv="Content-Security-Policy" i]')?.content,
          };
        });
        assert.equal(structure.main, 1, `${pathname}: one main landmark`);
        assert.equal(structure.h1, 1, `${pathname}: one page heading`);
        assert.ok(structure.title && structure.description, `${pathname}: page metadata`);
        assert.deepEqual(structure.duplicateIds, [], `${pathname}: unique IDs`);
        assert.deepEqual(structure.brokenReferences, [], `${pathname}: valid ARIA references`);
        assert.ok(structure.overflow <= 1, `${pathname}: no viewport overflow (${structure.overflow}px)`);
        assert.match(structure.csp ?? '', archive ? /script-src[^;]*'none'/ : /script-src[^;]*sha256-/, `${pathname}: executable scripts are restricted`);
        assert.ok(!/script-src[^;]*'unsafe-inline'/.test(structure.csp), `${pathname}: injected scripts are blocked`);
        for (const link of structure.links) {
          const url = new URL(link);
          assert.ok(['http:', 'https:', 'mailto:'].includes(url.protocol), `${pathname}: safe link ${url.protocol}`);
          if (url.origin === base.origin && url.pathname !== '/__quality-missing__/') links.set(url.href, url);
        }
        const audit = await accessibility(page, `${profile}:${pathname}`);
        for (const trigger of ['[data-cite-modal-trigger]', '[data-offer-modal-trigger]']) {
          const button = page.locator(trigger).first();
          if (!await button.count()) continue;
          await button.click();
          const dialog = page.locator('dialog[open]');
          await dialog.waitFor();
          assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true, 'Focus enters dialog');
          await accessibility(page, `${profile}:${pathname}:dialog`);
          await page.keyboard.press('Escape');
          assert.equal(await button.evaluate(element => element === document.activeElement), true, 'Focus returns to trigger');
        }
        assert.deepEqual(errors, [], `${pathname}: browser errors`);
        const metrics = await page.evaluate(() => ({
          domElements: document.querySelectorAll('*').length,
          scriptElements: document.querySelectorAll('script').length,
        }));
        results.push({ profile, pathname, ...audit, ...metrics, resources });
        if (pathname === '' || pathname === 'offers/' || pathname === 'circuits/' || archive) {
          // Viewport captures keep long documents affordable on low-memory hosts.
          await page.evaluate(() => scrollTo(0, 0));
          await page.screenshot({ path: resolve(output, `${profile}-${pathname.replaceAll('/', '') || 'home'}.png`) });
        }
        console.log(`${profile}: /${pathname} — ${audit.passedRules} accessibility rules checked`);
      } catch (error) {
        failures.push({ label: `${profile}:${pathname}`, error: error.message });
        console.error(`${profile}: /${pathname} — ${error.message}`);
      } finally {
        await page.close();
      }
    }
    // Internal destinations and fragments are checked once, without external crawling.
    if (profile === 'desktop') for (const url of links.values()) {
      try {
        const response = await context.request.head(url.href);
        assert.ok(response.ok(), `Broken internal destination ${url.pathname}: ${response.status()}`);
        if (url.hash && response.headers()['content-type']?.includes('text/html')) {
          const linkedPage = await context.newPage();
          try {
            await fixture.install(linkedPage);
            await linkedPage.goto(url.href);
            assert.ok(await linkedPage.evaluate(hash => Boolean(document.getElementById(decodeURIComponent(hash.slice(1)))), url.hash), `Missing fragment ${url.href}`);
          } finally {
            await linkedPage.close();
          }
        }
      } catch (error) {
        failures.push({ label: `link:${url.href}`, error: error.message });
      }
    }
    await context.close();
  }
  // Public research content and navigation remain available without scripts.
  const noScript = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 780 } });
  try {
    const page = await noScript.newPage();
    for (const pathname of ['', 'about/', 'publications/', 'games/', 'contact/', 'offers/']) {
      assert.equal((await page.goto(new URL(pathname, base).href)).status(), 200);
      await page.locator('main h1').waitFor();
      assert.equal(await page.locator('.site-nav a').count(), 4);
      assert.ok((await page.locator('main').innerText()).trim().length > 50, `${pathname}: useful content without JavaScript`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${pathname}: no-script mobile layout`);
    }
    await page.locator('.brand').click();
    await page.waitForURL(base.href);
    assert.equal(await page.locator('.home-links a[href$=".pdf"]').count(), 2);
    resilience.push('Public content, mobile navigation and profile downloads work without JavaScript.');
  } finally {
    await noScript.close();
  }
  // A failed worker asset must give a usable error and allow a later retry.
  const recovery = await browser.newContext({ reducedMotion: 'reduce' });
  try {
    const page = await recovery.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const workerAsset = /\/_astro\/circuit-worker[-.][^/]+\.js$/;
    let blockedWorkers = 0;
    await page.route(workerAsset, route => { blockedWorkers += 1; return route.abort('connectionfailed'); });
    await page.goto(new URL('circuits/?unexpected=%00#%E0%A4%A', base).href);
    await page.locator('#circuit-status[data-error]').waitFor();
    assert.equal(blockedWorkers, 1, 'The worker HTTP failure was exercised');
    assert.equal(await page.locator('#circuit-preview').getAttribute('aria-busy'), 'false');
    assert.equal(await page.locator('#copy-tikz').isDisabled(), true);
    assert.match(await page.locator('#circuit-status').innerText(), /could not|couldn't|failed/i);
    await page.unroute(workerAsset);
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) } }));
    await page.locator('#controls').selectOption('2');
    await page.locator('#copy-tikz:enabled').waitFor();
    await page.locator('#copy-tikz').click();
    await page.locator('#copy-fallback:not([hidden])').waitFor();
    const expectedTikz = await page.locator('#tikz-code').inputValue();
    assert.match(expectedTikz, /\\begin\{tikzpicture\}/);
    // Rapid edits cancel obsolete work; only the final configuration may be drawn/exported.
    for (const [selector, value] of [['#controls', '32'], ['#algorithm', 'simple_polarization'],
      ['#dimension', '7'], ['#controls', '1'], ['#dimension', '5'],
      ['#algorithm', 'borrow-and-conquer'], ['#controls', '2']]) {
      await page.locator(selector).selectOption(value);
    }
    await page.locator('#copy-tikz:enabled').waitFor();
    await page.locator('#copy-tikz').click();
    await page.locator('#copy-fallback:not([hidden])').waitFor();
    assert.equal(await page.locator('#tikz-code').inputValue(), expectedTikz, 'The final circuit/export matches the latest inputs');
    assert.deepEqual(errors, [], 'Worker failures and malformed URL fragments do not escape as uncaught errors');
    resilience.push('Circuit worker HTTP failure recovers; malformed URL fragments and rapid input changes remain safe.');
  } finally {
    await recovery.close();
  }
  // Server outages and denied browser storage must not prevent local play.
  for (const game of ['quantum-golf', 'circuit-reduction']) {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    try {
      await context.addInitScript(() => {
        for (const method of ['getItem', 'setItem', 'removeItem', 'clear']) {
          Storage.prototype[method] = () => { throw new DOMException('Storage denied', 'SecurityError'); };
        }
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.setFixedTime(new Date('2026-10-14T10:00:00Z'));
      await page.route('**/api/**', route => route.fulfill({ status: 503,
        contentType: 'application/json', body: '{"error":"Service unavailable"}' }));
      await page.goto(new URL(`games/${game}/?unexpected=%00#%E0%A4%A`, base).href);
      await page.locator('#leaderboard-status').filter({ hasText: 'Scores temporarily unavailable.' }).waitFor();
      if (game === 'quantum-golf') await page.locator('#gate-t').click();
      else {
        await page.locator('[data-cell="0:1"]').click();
        await page.locator('[data-cell="0:2"]').click();
        await page.locator('[data-rule="cancel-x"]').click();
      }
      await page.locator('#win-dialog[open]').waitFor();
      await page.locator('#player-name').fill('Quality test');
      await page.locator('#submit-score').click();
      await page.locator('#score-status').filter({ hasText: 'Scores temporarily unavailable.' }).waitFor();
      assert.equal(await page.locator('#submit-score').isEnabled(), true, 'A failed save permits retry');
      await page.locator('#close-win').click();
      await page.locator('#mode-daily').click();
      await page.locator('#daily-status').filter({ hasText: /Offline practice|Daily puzzle unavailable/ }).waitFor();
      if (game === 'circuit-reduction') {
        assert.equal(await page.locator('#mode-daily').getAttribute('aria-pressed'), 'true');
        assert.match(await page.locator('#daily-note').innerText(), /Practice/);
      }
      await page.locator('#mode-campaign').click();
      await page.locator('#restart').click();
      assert.equal(await page.locator('#mode-campaign').getAttribute('aria-pressed'), 'true');
      assert.deepEqual(errors, [], `${game}: outages, blocked storage and malformed fragments do not cause uncaught errors`);
      resilience.push(`${game}: campaign playable with API503/blocked storage; failed scores stay retryable; daily failure is explained.`);
    } finally {
      await context.close();
    }
  }
  // Prove that the production policy blocks an injected executable script.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(base.href);
  await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.injectedQualityProbe = true';
    document.body.appendChild(script);
  });
  assert.equal(await page.evaluate(() => window.injectedQualityProbe), undefined, 'CSP blocks script injection');
  await context.close();
  assert.deepEqual(failures, [], 'Browser checks failed: see tmp/quality-report/browser*.json');
  console.log(`${results.length} page/profile checks; ${links.size} internal links; ${resilience.length} resilience checks; script injection blocked.`);
} catch (error) {
  failures.push({ label: 'audit', error: error.message.split('\n')[0] });
  throw error;
} finally {
  await writeFile(resolve(output, resilienceOnly ? 'browser-resilience.json' : 'browser.json'),
    JSON.stringify({ results, resilience, failures, checkedLinks: links.size }, null, 2));
  await browser.close();
}
