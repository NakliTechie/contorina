// Layers panel: the document tree, front-most layer on top.
import { h, clear } from './dom.js';
import { sweepToggle } from './numfield.js';
import { state, subscribe, nextFrame } from '../store.js';
import { ancestors } from '../doc.js';

const ICON = { frame: '#', rect: '▢', ellipse: '○', line: '╱', text: 'T', instance: '◇' };
const MAX_ROWS = 600;

export function createLayers(root, app) {
  const expanded = new Set();
  const list = h('div.layers-list', { role: 'tree', 'aria-label': 'Layers' });
  const pagesEl = h('div.pages', { role: 'tablist', 'aria-label': 'Pages' });
  root.append(h('div.panel-head', h('span', 'Pages'), h('button.ly-toggle', { type: 'button', title: 'New page', 'aria-label': 'New page', on: { click: () => app.run('page.add', {}) } }, '+')), pagesEl, h('div.panel-head', 'Layers'), list);
  function renderPages() {
    const doc = state.doc;
    const pages = doc.pages || [{ id: 'page1', name: 'Page 1' }];
    clear(pagesEl);
    for (const g of pages) {
      const on = (doc.page || 'page1') === g.id;
      const row = h('div.page-row' + (on ? '.sel' : ''), { role: 'tab', 'aria-selected': on ? 'true' : 'false', on: {
        click: () => { if (!on) app.run('page.open', { id: g.id }); },
        dblclick: () => {
          const input = h('input.ly-rename', { type: 'text', value: g.name });
          row.replaceChildren(input); input.focus(); input.select();
          let done = false;
          const fin = (ok) => { if (done) return; done = true; if (ok && input.value.trim() && input.value !== g.name) app.run('page.rename', { id: g.id, name: input.value.trim() }); else renderPages(); };
          input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') fin(true); if (e.key === 'Escape') fin(false); });
          input.addEventListener('blur', () => fin(true));
        },
      } }, h('span.ly-name', g.name), pages.length > 1 ? h('button.ly-toggle', { type: 'button', title: 'Delete page', 'aria-label': 'Delete page', on: { click: async (e) => { e.stopPropagation(); if (await app.confirm(`Delete page “${g.name}”?`, 'Its layers are deleted too. Undo brings them back.', 'Delete', true)) app.run('page.delete', { id: g.id }); } } }, '×') : null);
      pagesEl.append(row);
    }
  }
  let dragIds = null;

  function icon(n) {
    if (n.component) return '❖';
    if (n.variantSet) return '◈';
    if (n.type === 'frame' && n.layout && n.layout.mode !== 'none') return n.layout.mode === 'row' ? '⇥' : '⤓';
    return ICON[n.type] || '?';
  }

  function render() {
    renderPages();
    const doc = state.doc;
    for (const id of state.selection) for (const a of ancestors(doc, id)) expanded.add(a);
    clear(list);
    let count = 0;
    const sel = new Set(state.selection);
    const walk = (ids, depth) => {
      for (let i = ids.length - 1; i >= 0; i--) {
        if (count >= MAX_ROWS) return;
        const n = doc.nodes[ids[i]];
        if (!n) continue;
        count++;
        const hasKids = n.children && n.children.length;
        const open = expanded.has(n.id);
        const comp = n.component || n.type === 'instance' || n.src || n.variantSet;
        const name = h('span.ly-name', n.name);
        const eye = h('button.ly-toggle' + (n.visible === false ? '.off' : ''), { type: 'button', title: n.visible === false ? 'Show' : 'Hide', 'aria-label': 'Visibility' }, n.visible === false ? '◌' : '●');
        const lock = h('button.ly-toggle' + (n.locked ? '.on' : '.off'), { type: 'button', title: n.locked ? 'Unlock' : 'Lock', 'aria-label': 'Lock', disabled: !!n.src }, n.locked ? '🔒' : '·');
        sweepToggle(eye, () => doc.nodes[n.id] && state.doc.nodes[n.id].visible !== false, (v) => app.run('node.setVisible', { ids: [n.id], value: v }));
        if (!n.src) sweepToggle(lock, () => !!state.doc.nodes[n.id]?.locked, (v) => app.run('node.setLocked', { ids: [n.id], value: v }));
        const row = h('div.ly-row' + (sel.has(n.id) ? '.sel' : '') + (comp ? '.comp' : '') + (n.visible === false ? '.hidden' : ''), {
          role: 'treeitem', 'aria-selected': sel.has(n.id) ? 'true' : 'false', 'aria-expanded': hasKids ? String(open) : null,
          draggable: !n.src, style: { paddingLeft: 6 + depth * 14 + 'px' },
          on: {
            pointerdown: (e) => {
              if (e.target.closest('button')) return;
              if (e.shiftKey || app.isMod(e)) {
                const next = sel.has(n.id) ? state.selection.filter((x) => x !== n.id) : [...state.selection, n.id];
                app.run('select.set', { ids: next });
              } else if (!sel.has(n.id)) app.run('select.set', { ids: [n.id] });
            },
            pointerenter: () => { state.hover = n.id; app.redraw(); },
            pointerleave: () => { if (state.hover === n.id) { state.hover = null; app.redraw(); } },
            dblclick: (e) => { if (!e.target.closest('button') && !n.src) rename(n, name); },
            dragstart: (e) => { dragIds = sel.has(n.id) ? state.selection.slice() : [n.id]; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', n.id); },
            dragover: (e) => { if (!dragIds) return; e.preventDefault(); row.dataset.drop = zone(e, row, n); },
            dragleave: () => { delete row.dataset.drop; },
            drop: (e) => { e.preventDefault(); delete row.dataset.drop; drop(zone(e, row, n), n); dragIds = null; },
          },
        },
        h('button.ly-twist', { type: 'button', 'aria-label': open ? 'Collapse' : 'Expand', style: { visibility: hasKids ? 'visible' : 'hidden' }, on: { click: () => { open ? expanded.delete(n.id) : expanded.add(n.id); render(); } } }, open ? '▾' : '▸'),
        h('span.ly-icon', icon(n)), name, h('span.ly-tools', eye, lock));
        list.append(row);
        if (hasKids && open) walk(n.children, depth + 1);
      }
    };
    walk(doc.children, 0);
    if (count >= MAX_ROWS) list.append(h('div.ly-more', `Showing the first ${MAX_ROWS} layers; select on the canvas to reveal others.`));
    if (!doc.children.length) list.append(h('div.ly-empty', 'No layers yet. Press F for a frame, R for a rectangle, T for text.'));
    const first = list.querySelector('.ly-row.sel');
    if (first && !list.matches(':hover')) first.scrollIntoView({ block: 'nearest' });
  }

  function zone(e, row, n) {
    const r = row.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    if (n.type === 'frame' && !n.src && y > 0.25 && y < 0.75) return 'inside';
    return y < 0.5 ? 'before' : 'after';
  }
  function drop(where, n) {
    if (!dragIds || dragIds.includes(n.id)) return;
    const doc = state.doc;
    if (where === 'inside') { app.run('node.reparent', { ids: dragIds, parent: n.id }); expanded.add(n.id); return; }
    const parent = n.parent ?? null;
    const list = parent ? doc.nodes[parent].children : doc.children;
    const i = list.indexOf(n.id);
    // The panel lists front-most first, so "before" (above) means a higher index.
    app.run('node.reparent', { ids: dragIds.slice().reverse(), parent, index: where === 'before' ? i + 1 : i });
  }
  function rename(n, span) {
    const input = h('input.ly-rename', { type: 'text', value: n.name });
    span.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (ok) => { if (done) return; done = true; if (ok && input.value !== n.name) app.run('node.rename', { id: n.id, name: input.value }); else render(); };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
    input.addEventListener('blur', () => finish(true));
  }

  let queued = false;
  subscribe((what) => {
    if (!(what.has('doc') || what.has('selection'))) return;
    if (what.has('preview') && !what.has('selection')) return; // skip mid-drag rebuilds
    if (queued) return;
    queued = true;
    nextFrame(() => { queued = false; if (!list.querySelector('.ly-rename')) render(); });
  });
  render();
  return { render };
}
