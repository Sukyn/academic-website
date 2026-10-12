import { circuitTikz, layoutCircuit, panelSvg, type Panel } from '../lib/circuits/circuit-drawing';
import type { Circuit } from '../lib/circuits/circuit-engine';

const form = document.querySelector<HTMLFormElement>('#circuit-form')!;
const dimension = document.querySelector<HTMLSelectElement>('#dimension')!;
const controls = document.querySelector<HTMLSelectElement>('#controls')!;
const algorithm = document.querySelector<HTMLSelectElement>('#algorithm')!;
const depth = document.querySelector<HTMLInputElement>('#depth')!;
const depthValue = document.querySelector<HTMLOutputElement>('#depth-value')!;
const copy = document.querySelector<HTMLButtonElement>('#copy-tikz')!;
const layoutToggle = document.querySelector<HTMLButtonElement>('#toggle-layout')!;
const preview = document.querySelector<HTMLElement>('#circuit-preview')!;
const status = document.querySelector<HTMLElement>('#circuit-status')!;
const basis = document.querySelector<HTMLElement>('#field-basis')!;
const fallback = document.querySelector<HTMLDetailsElement>('#copy-fallback')!;
const code = document.querySelector<HTMLTextAreaElement>('#tikz-code')!;
let worker: Worker | undefined;
let busy = false;
let request = 0;
let timer: ReturnType<typeof setTimeout>;
let circuit: Circuit | undefined;
let characteristic = 5;
let panels: Panel[] = [];
let drawnCircuit: Circuit | undefined;
let drawnWidth = 0;
let continuous = false;
const wrappedWidth = () => Math.max(240, Math.min(preview.clientWidth - 18, 1200));

function message(text = '', error = false) {
  status.textContent = text;
  status.toggleAttribute('data-error', error);
}

function draw() {
  if (!circuit) return;
  const width = continuous ? Infinity : wrappedWidth();
  if (circuit === drawnCircuit && width === drawnWidth) return;
  drawnCircuit = circuit;
  drawnWidth = width;
  panels = layoutCircuit(circuit, characteristic, width);
  preview.innerHTML = panels.map((panel, i) => `<div class="circuit-row" style="contain-intrinsic-size:auto ${panel.height}px">${panelSvg(panel, i, panels.length)}</div>`).join('');
  copy.textContent = 'Copy TikZ';
  if (!fallback.hidden) message();
  fallback.hidden = true;
}

function fail(text: string) {
  circuit = undefined;
  drawnCircuit = undefined;
  panels = [];
  preview.replaceChildren();
  preview.setAttribute('aria-busy', 'false');
  basis.hidden = true;
  copy.disabled = true;
  message(text, true);
}

function construct(resetDepth = false) {
  if (!form.checkValidity()) {
    fail('Choose a field size and 1–32 controls.');
    return;
  }
  if (resetDepth) {
    depth.max = String(Math.max(1, Number(controls.value) - 1));
    depth.value = '1';
  }
  depthValue.value = depth.value;
  preview.setAttribute('aria-busy', 'true');
  message('Constructing…');
  const activeWorker = worker ??= new Worker(new URL('./circuit-worker.ts', import.meta.url), { type: 'module' });
  busy = true;
  const id = request;
  activeWorker.onmessage = ({ data }) => {
    if (data.id !== request) return;
    busy = false;
    if (data.error) return fail(data.error);
    circuit = data.circuit;
    characteristic = data.p;
    const full = circuit!.operations.every(g => g.op !== 'add' || g.controls.length === 1);
    depth.max = String(data.maxDepth);
    depth.value = String(data.depth);
    depthValue.value = `${depth.value}${full ? ' · full' : ''}`;
    depth.setAttribute('aria-valuetext', full ? `${depth.value}, fully expanded` : depth.value);
    basis.hidden = !circuit!.modulus;
    if (circuit!.modulus) {
      basis.textContent = `F${circuit!.q}: α is a root of ${circuit!.modulus.map((c, i, a) => c ? (i === a.length - 1 ? c : `${c === 1 ? '' : c}α${a.length - i - 1 > 1 ? '⁰¹²³⁴⁵⁶⁷⁸⁹'[a.length - i - 1] : ''}`) : '').filter(Boolean).join(' + ')} over F${characteristic} (Conway polynomial).`;
    }
    draw();
    preview.setAttribute('aria-busy', 'false');
    copy.disabled = false;
    message();
  };
  activeWorker.onerror = () => {
    if (id !== request) return;
    activeWorker.terminate();
    worker = undefined;
    busy = false;
    fail('The circuit could not be constructed. Please reload and try again.');
  };
  activeWorker.postMessage({ id, q: Number(dimension.value), k: Number(controls.value), algorithm: algorithm.value, depth: Number(depth.value) });
}

function schedule(resetDepth = false, delay = 100) {
  clearTimeout(timer);
  request++;
  // Reuse completed work; terminate only an unfinished, obsolete request.
  if (busy) { worker?.terminate(); worker = undefined; busy = false; }
  copy.disabled = true;
  copy.textContent = 'Copy TikZ';
  fallback.hidden = true;
  depthValue.value = depth.value;
  timer = setTimeout(() => construct(resetDepth), delay);
}

form.addEventListener('submit', event => { event.preventDefault(); schedule(false, 0); });
for (const input of [dimension, controls, algorithm, depth]) {
  input.addEventListener('input', () => schedule(input !== depth, input === depth ? 100 : 250));
}
layoutToggle.addEventListener('click', () => {
  continuous = !continuous;
  layoutToggle.textContent = continuous ? '↕' : '↔';
  layoutToggle.setAttribute('aria-pressed', String(continuous));
  layoutToggle.title = continuous ? 'Wrap into rows' : 'Show in one horizontal row';
  copy.title = continuous ? 'Copy TikZ with wrapped rows' : 'Copy TikZ';
  preview.toggleAttribute('data-continuous', continuous);
  preview.scrollLeft = 0;
  draw();
});
copy.addEventListener('click', async () => {
  if (!circuit || copy.disabled) return;
  const id = request, copiedPanels = panels;
  // Keep exported rows within TeX's dimension limits, even in continuous view.
  const exportPanels = continuous ? layoutCircuit(circuit, characteristic, wrappedWidth()) : panels;
  const tikz = circuitTikz(exportPanels, circuit, characteristic);
  try {
    await navigator.clipboard.writeText(tikz);
    if (id === request && panels === copiedPanels) copy.textContent = 'Copied';
  } catch {
    if (id !== request || panels !== copiedPanels) return;
    fallback.hidden = false;
    fallback.open = true;
    code.value = tikz;
    code.focus();
    code.select();
    message('Select and copy the TikZ below.');
  }
});
new ResizeObserver(draw).observe(preview);
schedule(false, 0);
