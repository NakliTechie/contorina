// Commands for variables, prototyping and pages (scope layers 4 and 5). DOM-free.
import { register } from './registry.js';
import { uid, topmost } from './doc.js';
import { BINDABLE, VAR_TYPES, emptyVariables } from './variables.js';

const ids$ = { type: 'array', desc: 'Node ids; defaults to the current selection' };
const sel = (tx, p, env) => (p.ids ?? env.selection ?? []).filter((id) => tx.get(id));
function vars(tx) {
  if (!tx.doc.variables) tx.doc.variables = emptyVariables();
  else tx.doc.variables = { collections: { ...tx.doc.variables.collections }, vars: { ...tx.doc.variables.vars } };
  return tx.doc.variables;
}
const checkValue = (type, v) => {
  if (v && typeof v === 'object' && v.alias) return v;
  if (type === 'color' && !(typeof v === 'string' && /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(v))) throw new Error('A colour variable takes #RRGGBB or #RRGGBBAA');
  if (type === 'number' && !(typeof v === 'number' && Number.isFinite(v))) throw new Error('A number variable takes a number');
  if (type === 'string' && typeof v !== 'string') throw new Error('A string variable takes text');
  if (type === 'boolean' && typeof v !== 'boolean') throw new Error('A boolean variable takes true or false');
  return v;
};

register(
  {
    id: 'variable.createCollection', label: 'New variable collection', group: 'Variables',
    params: { name: { type: 'string' }, id: { type: 'string' } },
    doc(tx, p) {
      const V = vars(tx);
      const id = p.id || 'c' + uid();
      V.collections[id] = { name: p.name || `Collection ${Object.keys(V.collections).length + 1}`, modes: [{ id: 'm' + uid(), name: 'Mode 1' }] };
      return { value: id };
    },
  },
  {
    id: 'variable.addMode', label: 'Add variable mode', group: 'Variables', hidden: true,
    description: 'Add a mode (for example Dark) to a collection; every variable copies its first mode\'s value.',
    params: { collection: { type: 'string', required: true }, name: { type: 'string' }, id: { type: 'string' } },
    doc(tx, p) {
      const V = vars(tx);
      const c = V.collections[p.collection];
      if (!c) throw new Error(`No collection ${p.collection}`);
      const id = p.id || 'm' + uid();
      V.collections[p.collection] = { ...c, modes: [...c.modes, { id, name: p.name || `Mode ${c.modes.length + 1}` }] };
      for (const [vid, v] of Object.entries(V.vars)) if (v.collection === p.collection) V.vars[vid] = { ...v, values: { ...v.values, [id]: v.values[c.modes[0].id] } };
      return { value: id };
    },
  },
  {
    id: 'variable.renameMode', label: 'Rename variable mode', group: 'Variables', hidden: true,
    params: { collection: { type: 'string', required: true }, mode: { type: 'string', required: true }, name: { type: 'string', required: true } },
    doc(tx, p) {
      const V = vars(tx);
      const c = V.collections[p.collection];
      if (!c) return false;
      V.collections[p.collection] = { ...c, modes: c.modes.map((m) => (m.id === p.mode ? { ...m, name: p.name } : m)) };
    },
  },
  {
    id: 'variable.create', label: 'Create variable', group: 'Variables', hidden: true,
    description: 'Create a variable (type color, number, string or boolean) in a collection with a value for its first mode.',
    params: { collection: { type: 'string', required: true }, name: { type: 'string', required: true }, type: { type: 'string', required: true, enum: VAR_TYPES }, value: { type: 'any', required: true }, id: { type: 'string' } },
    doc(tx, p) {
      const V = vars(tx);
      const c = V.collections[p.collection];
      if (!c) throw new Error(`No collection ${p.collection}`);
      const id = p.id || 'v' + uid();
      const val = checkValue(p.type, p.value);
      V.vars[id] = { name: p.name, collection: p.collection, type: p.type, values: Object.fromEntries(c.modes.map((m) => [m.id, val])) };
      return { value: id };
    },
  },
  {
    id: 'variable.set', label: 'Set variable value', group: 'Variables', hidden: true,
    description: 'Set a variable\'s value in one mode; value may be {alias: variableId}.',
    params: { id: { type: 'string', required: true }, mode: { type: 'string', required: true }, value: { type: 'any', required: true } },
    doc(tx, p) {
      const V = vars(tx);
      const v = V.vars[p.id];
      if (!v) throw new Error(`No variable ${p.id}`);
      if (p.value && p.value.alias === p.id) throw new Error('A variable cannot alias itself');
      V.vars[p.id] = { ...v, values: { ...v.values, [p.mode]: checkValue(v.type, p.value) } };
    },
  },
  {
    id: 'variable.rename', label: 'Rename variable', group: 'Variables', hidden: true,
    params: { id: { type: 'string', required: true }, name: { type: 'string', required: true } },
    doc(tx, p) { const V = vars(tx); if (!V.vars[p.id]) return false; V.vars[p.id] = { ...V.vars[p.id], name: p.name }; },
  },
  {
    id: 'variable.delete', label: 'Delete variable', group: 'Variables', hidden: true, scope: 'destructive',
    description: 'Delete a variable; layers bound to it keep their current values.',
    params: { id: { type: 'string', required: true } },
    doc(tx, p) {
      const V = vars(tx);
      if (!V.vars[p.id]) return false;
      delete V.vars[p.id];
      for (const [id, n] of Object.entries(tx.doc.nodes)) {
        if (!n.bind || n.src) continue;
        const b = Object.fromEntries(Object.entries(n.bind).filter(([, v]) => v !== p.id));
        if (Object.keys(b).length !== Object.keys(n.bind).length) tx.set(id, { bind: Object.keys(b).length ? b : undefined });
      }
    },
  },
  {
    id: 'node.bindVariable', label: 'Bind variable', group: 'Variables', hidden: true,
    description: 'Bind a layer property (fill, stroke, w, h, opacity, radius, strokeWidth, fontSize, gap, padding, text, name, visible) to a variable, or unbind with variable null.',
    params: { ids: ids$, prop: { type: 'string', required: true }, variable: { type: 'string', nullable: true, required: true } },
    doc(tx, p, env) {
      const ids = sel(tx, p, env).filter((id) => !tx.get(id).src);
      if (!ids.length) return false;
      if (p.variable) {
        const v = (tx.doc.variables || { vars: {} }).vars[p.variable];
        if (!v) throw new Error(`No variable ${p.variable}`);
        if (!BINDABLE[v.type].includes(p.prop)) throw new Error(`A ${v.type} variable cannot drive ${p.prop}`);
      }
      for (const id of ids) {
        const b = { ...(tx.get(id).bind || {}) };
        if (p.variable) b[p.prop] = p.variable; else delete b[p.prop];
        tx.set(id, { bind: Object.keys(b).length ? b : undefined });
      }
    },
  },
  {
    id: 'node.setMode', label: 'Set variable mode', group: 'Variables', hidden: true,
    description: 'Choose which mode of a collection a frame or instance (and everything inside it) uses; mode null inherits.',
    params: { ids: ids$, collection: { type: 'string', required: true }, mode: { type: 'string', nullable: true, required: true } },
    doc(tx, p, env) {
      const ids = sel(tx, p, env).filter((id) => !tx.get(id).src);
      if (!ids.length) return false;
      for (const id of ids) {
        const m = { ...(tx.get(id).modes || {}) };
        if (p.mode) m[p.collection] = p.mode; else delete m[p.collection];
        tx.set(id, { modes: Object.keys(m).length ? m : undefined });
      }
    },
  },
  {
    id: 'proto.set', label: 'Set prototype interaction', group: 'Prototype', hidden: true,
    description: 'Set what happens in present mode when a layer is clicked or hovered: navigate to a frame, open an overlay, go back, or open a URL. proto null removes it.',
    params: { ids: ids$, proto: { type: 'object', nullable: true, required: true } },
    doc(tx, p, env) {
      const ids = sel(tx, p, env).filter((id) => !tx.get(id).src);
      if (!ids.length) return false;
      let proto = p.proto;
      if (proto) {
        proto = { trigger: 'click', action: 'navigate', transition: 'instant', duration: 300, ...proto };
        if (!['click', 'hover', 'press'].includes(proto.trigger)) throw new Error('trigger must be click, hover or press');
        if (!['navigate', 'overlay', 'back', 'close', 'url'].includes(proto.action)) throw new Error('action must be navigate, overlay, back, close or url');
        if ((proto.action === 'navigate' || proto.action === 'overlay') && !tx.get(proto.target)) throw new Error('navigate and overlay need a target frame');
        if (proto.action === 'url' && !/^https?:\/\//.test(proto.url || '')) throw new Error('url must start with http:// or https://');
      }
      for (const id of ids) tx.set(id, { proto: proto || undefined });
    },
  },
  {
    id: 'proto.setStart', label: 'Set as prototype start', group: 'Prototype',
    params: { id: { type: 'string' } },
    doc(tx, p, env) {
      const id = p.id || (env.selection || [])[0];
      const n = id && tx.get(id);
      if (!n || n.parent || n.type !== 'frame') throw new Error('Choose a top-level frame');
      tx.doc.flowStart = id;
    },
  },
  {
    id: 'page.add', label: 'New page', group: 'Pages',
    params: { name: { type: 'string' }, id: { type: 'string' } },
    doc(tx, p) {
      ensurePages(tx);
      const id = p.id || 'p' + uid();
      savePage(tx);
      tx.doc.pages = [...tx.doc.pages, { id, name: p.name || `Page ${tx.doc.pages.length + 1}`, children: [] }];
      tx.doc.page = id;
      tx.doc.children = [];
      return { select: [], value: id };
    },
  },
  {
    id: 'page.open', label: 'Go to page', group: 'Pages', hidden: true,
    params: { id: { type: 'string', required: true } },
    doc(tx, p) {
      ensurePages(tx);
      if (p.id === tx.doc.page) return false;
      const target = tx.doc.pages.find((g) => g.id === p.id);
      if (!target) throw new Error(`No page ${p.id}`);
      savePage(tx);
      tx.doc.page = p.id;
      tx.doc.children = (tx.doc.pages.find((g) => g.id === p.id).children || []).slice();
      return { select: [] };
    },
  },
  {
    id: 'page.rename', label: 'Rename page', group: 'Pages', hidden: true,
    params: { id: { type: 'string', required: true }, name: { type: 'string', required: true } },
    doc(tx, p) { ensurePages(tx); tx.doc.pages = tx.doc.pages.map((g) => (g.id === p.id ? { ...g, name: p.name } : g)); },
  },
  {
    id: 'page.delete', label: 'Delete page', group: 'Pages', hidden: true, scope: 'destructive',
    params: { id: { type: 'string', required: true } },
    doc(tx, p) {
      ensurePages(tx);
      if (tx.doc.pages.length < 2) throw new Error('A document keeps at least one page');
      savePage(tx);
      const g = tx.doc.pages.find((x) => x.id === p.id);
      if (!g) return false;
      for (const id of g.children) tx.drop(id);
      tx.doc.pages = tx.doc.pages.filter((x) => x.id !== p.id);
      if (tx.doc.page === p.id) { tx.doc.page = tx.doc.pages[0].id; tx.doc.children = tx.doc.pages[0].children.slice(); }
      return { select: [] };
    },
  },
  {
    id: 'node.moveToPage', label: 'Move to page', group: 'Pages', hidden: true,
    params: { ids: ids$, page: { type: 'string', required: true } },
    doc(tx, p, env) {
      ensurePages(tx);
      if (p.page === tx.doc.page) return false;
      const ids = topmost(tx.doc, sel(tx, p, env)).filter((id) => !tx.get(id).parent);
      if (!ids.length) throw new Error('Move top-level layers between pages');
      savePage(tx);
      tx.doc.children = tx.doc.children.filter((id) => !ids.includes(id));
      tx.doc.pages = tx.doc.pages.map((g) => (g.id === p.page ? { ...g, children: [...g.children, ...ids] } : g.id === tx.doc.page ? { ...g, children: tx.doc.children.slice() } : g));
      return { select: [] };
    },
  },
  {
    id: 'layout.setGrids', label: 'Set layout grids', group: 'Layout', hidden: true,
    description: 'Set a frame\'s layout grids: [{type: columns|rows|grid, count, gutter, margin, size, color}]. Grids show on the canvas only.',
    params: { ids: ids$, grids: { type: 'array', nullable: true, required: true } },
    doc(tx, p, env) {
      const ids = sel(tx, p, env).filter((id) => tx.get(id).type === 'frame' && !tx.get(id).src);
      if (!ids.length) return false;
      for (const id of ids) tx.set(id, { grids: p.grids && p.grids.length ? p.grids : undefined });
    },
  },
);

// Pages: doc.children is always the open page; other pages keep their top-level ids in doc.pages.
export function ensurePages(tx) {
  if (!tx.doc.pages) { tx.doc.pages = [{ id: 'page1', name: 'Page 1', children: tx.doc.children.slice() }]; tx.doc.page = 'page1'; }
}
function savePage(tx) {
  tx.doc.pages = tx.doc.pages.map((g) => (g.id === tx.doc.page ? { ...g, children: tx.doc.children.slice() } : g));
}
