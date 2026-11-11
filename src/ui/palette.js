// Command palette: fuzzy search over the registry, recent picks first.
import { h, clear } from './dom.js';
import { all, keyLabel } from '../registry.js';
import { rank } from '../fuzzy.js';

const KEY = 'contorina.recent';
const recent = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const remember = (id) => { try { localStorage.setItem(KEY, JSON.stringify([id, ...recent().filter((x) => x !== id)].slice(0, 12))); } catch {} };

export function openPalette(app) {
  if (document.querySelector('.palette')) return;
  const items = all().filter((c) => !c.hidden && c.id !== 'palette.open' && (!c.when || c.when()));
  const input = h('input', { type: 'text', placeholder: 'Search commands…', spellcheck: false, 'aria-label': 'Search commands' });
  const list = h('ul', { role: 'listbox' });
  let shown = [], active = 0;
  const close = () => { back.remove(); app.focusCanvas(); };
  const runIt = (c) => { close(); remember(c.id); app.run(c.id); };
  const render = () => {
    shown = rank(input.value, items, (c) => `${c.label} ${c.group}`, input.value ? recent() : []).slice(0, 40);
    if (!input.value) {
      const r = recent();
      shown = [...r.map((id) => items.find((c) => c.id === id)).filter(Boolean), ...items.filter((c) => !r.includes(c.id))].slice(0, 40);
    }
    active = Math.min(active, Math.max(0, shown.length - 1));
    clear(list);
    shown.forEach((c, i) => list.append(h('li' + (i === active ? '.active' : ''), { role: 'option', on: { click: () => runIt(c), pointermove: () => { if (active !== i) { active = i; render(); } } } },
      h('span.pl-label', c.label), h('span.pl-group', c.group), c.keys[0] ? h('kbd', keyLabel(c.keys[0])) : null)));
    if (!shown.length) list.append(h('li.empty', 'No command matches'));
  };
  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(shown.length - 1, active + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); render(); }
    else if (e.key === 'Enter' && shown[active]) runIt(shown[active]);
  });
  const back = h('div.palette-back', { on: { pointerdown: (e) => { if (e.target === back) close(); } } }, h('div.palette', input, list));
  document.body.appendChild(back);
  render();
  input.focus();
}
