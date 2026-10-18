const root = document.querySelector('[data-circuit-game]');
const requested = new URLSearchParams(location.search).get('category');
const category = requested === 'prop' || requested === 'controlled' ? requested : 'pro';
const template = root.querySelector('[data-categorical-template]');

if (category === 'pro') template.remove();
else root.replaceChildren(template.content.cloneNode(true));

const select = root.querySelector('#circuit-category');
select.value = category;
window.addEventListener('pageshow', () => { select.value = category; });
select.addEventListener('change', () => {
  const next = select.value;
  select.value = category;
  const url = new URL(location.href);
  url.search = next === 'pro' ? '' : new URLSearchParams({ category: next }).toString();
  url.hash = '';
  location.assign(url);
});

root.inert = true;
const controller = category !== 'pro' ? import('./categorical-circuits.js') :
  root.dataset.circuitGame === 'signals' ? import('./quantum-signals.js') : import('./circuit-reduction.js');
void controller.catch(() => {
  root.querySelector('#status').textContent = 'Game unavailable. Reload to try again.';
}).finally(() => { root.inert = false; });
