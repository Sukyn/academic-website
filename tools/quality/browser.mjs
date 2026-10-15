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
await mkdir(output, { recursive: true });
const routes = (await readdir('dist', { recursive: true })).filter(file => file.endsWith('.html'));
assert.ok(routes.length > 0, 'Build the website before auditing it.');
const fixture = createBrowserApi();
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {}) });
const results = [], failures = [], links = new Map();

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
  for (const [profile, options] of [
    ['desktop', { viewport: { width: 1440, height: 1000 } }],
    ['mobile', { viewport: { width: 320, height: 780 }, isMobile: true, hasTouch: true }],
  ]) {
    const context = await browser.newContext({ ...options, reducedMotion: 'reduce' });
    for (const file of routes) {
      const html = await readFile(resolve('dist', file), 'utf8');
      const pathname = file.replaceAll('\\', '/').replace(/index\.html$/, '');
      const archive = pathname.startsWith('outreach/');
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
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
          resources: performance.getEntriesByType('resource').map(({ name, transferSize, decodedBodySize }) => ({
            path: new URL(name).pathname, transferSize, decodedBodySize,
          })),
          domElements: document.querySelectorAll('*').length,
        }));
        results.push({ profile, pathname, ...audit, ...metrics });
        if (pathname === '' || pathname === 'offers/' || pathname === 'circuits/' || archive) {
          await page.screenshot({ path: resolve(output, `${profile}-${pathname.replaceAll('/', '') || 'home'}.png`), fullPage: true });
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
  await writeFile(resolve(output, 'browser.json'), JSON.stringify({ results, failures, checkedLinks: links.size }, null, 2));
  assert.deepEqual(failures, [], 'Accessibility violations: see tmp/quality-report/browser.json');
  console.log(`${results.length} page/profile checks; ${links.size} internal links; script injection blocked.`);
} finally {
  await browser.close();
}
