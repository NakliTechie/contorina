// Properties-panel sections for scope layers 4 and 5: variables, bindings and modes, prototype
// interactions, layout grids and the inspect view.
import { h } from './dom.js';
import { numberField } from './numfield.js';
import { BINDABLE, VAR_TYPES, valueOf } from '../variables.js';
import { cssFor, cssText } from '../codegen.js';
import { worldBox } from '../geom.js';

const btn = (label, fn, title) => h('button.ps-btn', { type: 'button', title, on: { click: fn } }, label);
const sel = (value, options, onChange, label) => {
  const s = h('select', { 'aria-label': label, on: { change: () => onChange(s.value) } }, options.map(([v, l]) => h('option', { value: v }, l)));
  s.value = value ?? '';
  return s;
};
const section = (title, ...kids) => h('section.ps', h('h3', title), ...kids);
const stop = (e) => e.stopPropagation();

// Document-level variables table: one block per collection, one column per mode.
export function variablesSection(doc, app) {
  const V = doc.variables || { collections: {}, vars: {} };
  const blocks = Object.entries(V.collections).map(([cid, c]) => {
    const head = h('tr', h('th', ''), ...c.modes.map((m) => h('th', h('input.mode-name', { type: 'text', value: m.name, 'aria-label': 'Mode name', on: { keydown: stop, change: (e) => app.run('variable.renameMode', { collection: cid, mode: m.id, name: e.target.value }) } }))));
    const rows = Object.entries(V.vars).filter(([, v]) => v.collection === cid).map(([vid, v]) => h('tr',
      h('td', h('input', { type: 'text', value: v.name, 'aria-label': 'Variable name', on: { keydown: stop, change: (e) => app.run('variable.rename', { id: vid, name: e.target.value }) } }), h('span.ps-note', v.type)),
      ...c.modes.map((m) => h('td', valueEditor(v, v.values[m.id], (val) => app.run('variable.set', { id: vid, mode: m.id, value: val }), V, vid))),
      h('td', btn('×', async () => { if (await app.confirm(`Delete variable “${v.name}”?`, 'Bound layers keep their current values.', 'Delete', true)) app.run('variable.delete', { id: vid }); }, 'Delete variable'))));
    const typeSel = sel('color', VAR_TYPES.map((t) => [t, t]), () => {}, 'New variable type');
    const DEF = { color: '#0D99FF', number: 16, string: 'Text', boolean: true };
    return h('div.var-block', h('div.ps-row', h('strong', c.name), btn('+ Mode', () => app.run('variable.addMode', { collection: cid }), 'Add a mode')),
      h('div.var-scroll', h('table.vars', head, ...rows)),
      h('div.ps-row', typeSel, btn('+ Variable', () => app.run('variable.create', { collection: cid, name: `${typeSel.value} ${Object.keys(V.vars).length + 1}`, type: typeSel.value, value: DEF[typeSel.value] }))));
  });
  return section('Variables', ...blocks, h('div.ps-row', btn('+ Collection', () => app.run('variable.createCollection', {}))));
}

function valueEditor(v, val, set, V, vid) {
  if (val && typeof val === 'object' && val.alias) {
    const target = V.vars[val.alias];
    return h('span.alias', '→ ' + (target ? target.name : '?'));
  }
  if (v.type === 'color') {
    const c = h('input', { type: 'color', value: /^#[0-9a-f]{6}/i.test(val || '') ? val.slice(0, 7) : '#000000', 'aria-label': 'Colour value' });
    c.addEventListener('change', () => set(c.value.toUpperCase()));
    return c;
  }
  if (v.type === 'boolean') return h('input', { type: 'checkbox', checked: !!val, 'aria-label': 'Boolean value', on: { change: (e) => set(e.target.checked) } });
  return h('input.small', { type: v.type === 'number' ? 'number' : 'text', value: val ?? '', 'aria-label': 'Value', on: { keydown: stop, change: (e) => set(v.type === 'number' ? Number(e.target.value) : e.target.value) } });
}

// Bindings and modes for the selected layers.
export function bindingSection(doc, nodes, app) {
  const V = doc.variables;
  if (!V || !Object.keys(V.vars).length) return null;
  const one = nodes[0];
  const props = [...new Set(Object.values(BINDABLE).flat())].filter((p) => !(p === 'text' && one.type !== 'text') && !(p === 'fontSize' && one.type !== 'text') && !((p === 'gap' || p === 'padding') && !one.layout));
  const bound = one.bind || {};
  const rows = props.filter((p) => bound[p]).map((p) => h('div.ps-row', h('span.bind-prop', p), h('span.bind-var', '◆ ' + (V.vars[bound[p]]?.name || '?')),
    btn('×', () => app.run('node.bindVariable', { prop: p, variable: null }), 'Detach variable')));
  const propSel = sel(props[0], props.map((p) => [p, p]), () => {}, 'Property to bind');
  const varFor = () => Object.entries(V.vars).filter(([, v]) => BINDABLE[v.type].includes(propSel.value));
  const varSel = h('select', { 'aria-label': 'Variable' });
  const fill = () => { varSel.replaceChildren(...varFor().map(([id, v]) => h('option', { value: id }, v.name))); };
  propSel.addEventListener('change', fill);
  fill();
  const modes = (one.type === 'frame' || one.type === 'instance') ? Object.entries(V.collections).filter(([, c]) => c.modes.length > 1).map(([cid, c]) =>
    h('label.ps-field', h('span', c.name), sel(one.modes?.[cid] || '', [['', 'Inherit'], ...c.modes.map((m) => [m.id, m.name])], (m) => app.run('node.setMode', { collection: cid, mode: m || null }), `${c.name} mode`))) : [];
  return section('Variables', ...rows, h('div.ps-row', propSel, varSel, btn('Bind', () => varSel.value && app.run('node.bindVariable', { prop: propSel.value, variable: varSel.value }))), ...modes);
}

// Prototype interaction for one layer.
export function protoSection(doc, one, app) {
  const frames = doc.children.filter((id) => doc.nodes[id].type === 'frame' && id !== one.id);
  const pr = one.proto;
  const set = (patch) => app.run('proto.set', { proto: { ...(pr || {}), ...patch } });
  const kids = [];
  if (!pr) kids.push(h('div.ps-row', btn('+ Interaction', () => frames.length ? set({ action: 'navigate', target: frames[0] }) : app.run('proto.set', { proto: { action: 'back' } }), 'On click, navigate to a frame')));
  else {
    kids.push(h('div.ps-grid',
      sel(pr.trigger || 'click', [['click', 'On click'], ['hover', 'While hovering'], ['press', 'On press']], (v) => set({ trigger: v }), 'Trigger'),
      sel(pr.action || 'navigate', [['navigate', 'Navigate to'], ['overlay', 'Open overlay'], ['back', 'Back'], ['close', 'Close overlay'], ['url', 'Open link']], (v) => set({ action: v, ...(v === 'navigate' || v === 'overlay' ? { target: pr.target || frames[0] } : {}), ...(v === 'url' ? { url: pr.url || 'https://' } : {}) }), 'Action')));
    if (pr.action === 'navigate' || pr.action === 'overlay') kids.push(sel(pr.target, frames.map((id) => [id, doc.nodes[id].name]), (v) => set({ target: v }), 'Destination'));
    if (pr.action === 'url') kids.push(h('input', { type: 'text', value: pr.url || '', 'aria-label': 'Link', on: { keydown: stop, change: (e) => set({ url: e.target.value }) } }));
    if (pr.action === 'navigate') kids.push(h('div.ps-grid', sel(pr.transition || 'instant', [['instant', 'Instant'], ['dissolve', 'Dissolve'], ['slide-left', 'Slide in'], ['slide-right', 'Slide back']], (v) => set({ transition: v }), 'Transition'),
      h('input.small', { type: 'number', value: pr.duration ?? 300, min: 0, step: 50, 'aria-label': 'Duration (ms)', on: { keydown: stop, change: (e) => set({ duration: Number(e.target.value) || 0 }) } })));
    kids.push(h('div.ps-row', btn('Remove', () => app.run('proto.set', { proto: null }))));
  }
  const top = !one.parent && one.type === 'frame';
  if (top) kids.push(h('div.ps-row', btn(doc.flowStart === one.id ? '▶ Flow start' : 'Set as flow start', () => app.run('proto.setStart', { id: one.id })), btn('Present', () => app.run('present.start'), 'Alt+Mod+Enter')));
  return section('Prototype', ...kids);
}

// Layout grids on a frame (drawn on the canvas only).
export function gridsSection(one, app, fields) {
  const grids = one.grids || [];
  const set = (g) => app.run('layout.setGrids', { grids: g });
  const rows = grids.map((g, i) => {
    const upd = (patch) => { const l = grids.map((x) => ({ ...x })); l[i] = { ...l[i], ...patch }; set(l); };
    const nf = (label, key, def, title) => { const f = numberField({ label, title, min: 0, def, decimals: 0, get: () => ((app.liveNode(one.id)?.grids || [])[i] || {})[key] ?? def, apply: (v, ph) => ph === 'commit' && upd({ [key]: v }) }); fields.push(f); return f.el; };
    return h('div.paint', h('div.ps-row', sel(g.type, [['columns', 'Columns'], ['rows', 'Rows'], ['grid', 'Grid']], (v) => upd({ type: v }), 'Grid type'), btn('−', () => set(grids.filter((_, j) => j !== i)), 'Remove grid')),
      g.type === 'grid' ? h('div.ps-grid', nf('Size', 'size', 8, 'Cell size')) : h('div.ps-grid', nf('N', 'count', 12, 'Count'), nf('Gut', 'gutter', 20, 'Gutter'), nf('Mar', 'margin', 20, 'Margin')));
  });
  return section('Layout grid', ...rows, h('div.ps-row', btn('+ Grid', () => set([...grids, { type: 'columns', count: 12, gutter: 20, margin: 20, color: '#FF000019' }]))));
}

// Inspect: measurements and CSS of the selection (read-only).
export function inspectView(doc, nodes, app) {
  const n = nodes[0];
  const b = worldBox(doc, n.id);
  const css = cssText(cssFor(doc, n.id, { root: !n.parent }));
  const pre = h('pre.code.small', css || '/* no styles */');
  const vars = n.bind ? Object.entries(n.bind).map(([p, vid]) => h('div.ps-note', `${p} ← ${doc.variables?.vars[vid]?.name || vid}`)) : [];
  return h('div', section('Inspect', h('div.ps-note', `${n.name} · ${n.type}`), h('div.ps-grid', ...[['X', b.x], ['Y', b.y], ['W', n.w], ['H', n.h]].map(([k, v]) => h('div.kv', h('span', k), h('b', String(Math.round(v * 100) / 100)))))),
    section('CSS', pre, h('div.ps-row', btn('Copy CSS', async () => { try { await navigator.clipboard.writeText(css); } catch {} }), btn('All code…', () => app.run('code.show')))),
    vars.length ? section('Variables', ...vars) : null);
}

export { valueOf };
