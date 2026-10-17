// Regenerate menu illustrations with the gameplay renderers and a running dev server.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBrowserApi } from '../circuit-reduction/browser-api.mjs';

const require = createRequire(resolve(process.env.PLAYWRIGHT_MODULE_DIR ?? 'tmp/quality-tools/node_modules', 'package.json'));
const { chromium } = require('playwright');
const base = process.env.GAME_BASE_URL ?? 'http://localhost:4321';
const output = resolve('public/images/games');
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {}) });
try {
  await mkdir(output, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 360, height: 270 }, reducedMotion: 'reduce' });
  await createBrowserApi().install(context);
  for (const name of ['quantum-golf', 'circuit-simplification', 'quantum-signals', 'graph-states']) {
    const page = await context.newPage();
    await page.goto(`${base}/games/${name === 'circuit-simplification' ? 'circuit-reduction' : name}/`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async name => {
      await document.fonts.ready;
      document.body.replaceChildren();
      const style = document.createElement('style');
      style.textContent = 'html,body{width:360px;height:270px;min-height:0;margin:0;overflow:hidden;background:transparent!important}body::before,body::after,astro-dev-toolbar{display:none!important}#thumbnail{width:360px;height:270px;display:grid;place-items:center}';
      document.head.appendChild(style);
      const stage = document.createElement('div'); stage.id = 'thumbnail'; stage.className = 'graph-game';
      document.body.appendChild(stage);
      const canvas = () => {
        const node = document.createElement('canvas'); node.width = 360; node.height = 270;
        stage.appendChild(node); return node;
      };
      if (name === 'quantum-golf') {
        const { BlochSphere } = await import('/src/lib/quantum-golf/sphere.js');
        const { applyGate, START_STATE } = await import('/src/lib/quantum-golf/quantum.js');
        const sequence = 'THTHTH', state = [...sequence].reduce(applyGate, START_STATE), target = applyGate(state, 'T');
        const sphere = new BlochSphere(canvas(), { interactive: false });
        sphere.setState({ state, target, epsilon: .14, sequence,
          showLabels: false, showPreviews: false, showTrace: true });
        sphere.focus(target);
      } else if (name === 'circuit-simplification') {
        const { drawCircuit } = await import('/src/lib/circuit-reduction/rendering.js');
        const { LEVELS } = await import('/src/lib/circuit-reduction/puzzles.js');
        drawCircuit(canvas().getContext('2d'), LEVELS[7].circuit,
          { left: 12, top: 91, spacing: 56, rowSpacing: 88, radius: 18 });
      } else if (name === 'quantum-signals') {
        const { renderFlow } = await import('/src/lib/quantum-signals/rendering.js');
        const { LEVELS } = await import('/src/lib/quantum-signals/puzzles.js');
        const { simulate, stateEqual } = await import('/src/lib/quantum-signals/engine.js');
        const placements = { a: 'CX' };
        if (!stateEqual(simulate(LEVELS[6], placements).state, [Math.SQRT1_2, 0, 0, Math.SQRT1_2])) {
          throw new Error('The Bell-pair illustration must populate 00 and 11.');
        }
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const target = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const diagram = document.createElement('div'); diagram.style.display = 'flex';
        diagram.append(svg, target); stage.appendChild(diagram); renderFlow(svg, target, LEVELS[6], placements);
        svg.querySelectorAll('.signal-flow-heading,.signal-flow-gutter').forEach(node => node.remove());
        target.querySelector('.signal-flow-heading').remove();
        svg.setAttribute('viewBox', '28 24 216 140'); svg.setAttribute('width', '270'); svg.setAttribute('height', '175');
        target.setAttribute('viewBox', '0 24 52 140'); target.setAttribute('width', '65'); target.setAttribute('height', '175');
      } else {
        const { renderGraph } = await import('/src/lib/graph-states/rendering.js');
        const { LEVELS } = await import('/src/lib/graph-states/puzzles.js');
        const graph = document.createElement('div'); graph.style.width = '270px';
        stage.appendChild(graph); renderGraph(graph, LEVELS[6], { interactive: false });
      }
    }, name);
    const png = await page.screenshot({ omitBackground: true });
    const data = await page.evaluate(async png => {
      const image = new Image(); image.src = 'data:image/png;base64,' + png; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = 360; canvas.height = 270;
      canvas.getContext('2d').drawImage(image, 0, 0);
      return canvas.toDataURL('image/webp', .92).split(',')[1];
    }, png.toString('base64'));
    const bytes = Buffer.from(data, 'base64');
    await writeFile(resolve(output, `${name}.webp`), bytes);
    console.log(`${name}: ${bytes.length} bytes`);
    await page.close();
  }
} finally { await browser.close(); }
