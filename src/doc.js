// Document model. A document is plain JSON: { version, name, children: [ids], nodes: {id: node}, styles: {id: style} }.
// Every edit runs on a Tx, which copies the node map once and each touched node once (copy on write),
// so an undo snapshot is the previous document object.

export const FORMAT_VERSION = 1;
let seq = 0;
export function uid() {
  seq = (seq + 1) % 46656;
  return Math.random().toString(36).slice(2, 8) + seq.toString(36).padStart(3, '0');
}

export function emptyDoc(name = 'Untitled') {
  return { version: FORMAT_VERSION, name, children: [], nodes: {}, styles: {}, assets: {} };
}

const BASE = {
  name: '', x: 0, y: 0, w: 100, h: 100, rotation: 0, opacity: 1, visible: true, locked: false,
  fill: '#D9D9D9', stroke: null, strokeWidth: 1, radius: 0,
};
const TYPE_DEFAULTS = {
  frame: { fill: '#FFFFFF', clip: true },
  rect: {},
  ellipse: {},
  line: { fill: null, stroke: '#1E1E1E', strokeWidth: 2, h: 0 },
  text: { fill: '#1E1E1E', text: 'Text', fontSize: 16, fontFamily: 'Inter', fontWeight: 400, lineHeight: 1.25, align: 'left', autoSize: 'width' },
  instance: { fill: null, clip: true },
  vector: { fill: '#D9D9D9', d: 'M0 0 L100 0 L100 100 Z', vw: 100, vh: 100, fillRule: 'nonzero' },
  polygon: { sides: 3 },
  star: { points: 5, inner: 0.38 },
  boolean: { op: 'union', d: '', vw: 100, vh: 100, fillRule: 'evenodd', clip: false },
};
export const TYPES = Object.keys(TYPE_DEFAULTS);
const NAMES = { boolean: 'Boolean', frame: 'Frame', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', text: 'Text', instance: 'Instance', vector: 'Vector', polygon: 'Polygon', star: 'Star' };

export function makeNode(type, props = {}) {
  if (!TYPE_DEFAULTS[type]) throw new Error(`Unknown node type "${type}"`);
  const n = { ...BASE, ...TYPE_DEFAULTS[type], ...props, id: props.id || uid(), type };
  delete n.src; delete n.root;
  if (type !== 'frame' && type !== 'instance' && type !== 'boolean') delete n.children;
  if (!n.name) n.name = type === 'text' ? String(n.text).slice(0, 40) : NAMES[type];
  if (type === 'frame' || type === 'instance' || type === 'boolean') n.children = n.children ? n.children.slice() : [];
  return n;
}

export const isContainer = (n) => !!n && (n.type === 'frame' || n.type === 'instance');
export const hasLayout = (n) => !!(n && n.layout && n.layout.mode && n.layout.mode !== 'none');

export class Tx {
  constructor(doc) {
    this.doc = { ...doc, nodes: { ...doc.nodes }, children: doc.children.slice(), styles: { ...doc.styles }, assets: { ...(doc.assets || {}) } };
    this.own = new Set();
  }
  get(id) { return this.doc.nodes[id]; }
  mut(id) {
    if (!this.own.has(id)) {
      const n = this.doc.nodes[id];
      if (!n) throw new Error(`No node ${id}`);
      const c = { ...n };
      if (n.children) c.children = n.children.slice();
      this.doc.nodes[id] = c;
      this.own.add(id);
    }
    return this.doc.nodes[id];
  }
  set(id, patch) {
    const n = this.mut(id);
    for (const k in patch) {
      if (patch[k] === undefined) delete n[k];
      else n[k] = patch[k];
    }
    return n;
  }
  childIds(pid) { return pid ? this.get(pid).children : this.doc.children; }
  kids(pid) { return pid ? this.mut(pid).children : this.doc.children; }
  add(node, pid = null, index) {
    node.parent = pid;
    this.doc.nodes[node.id] = node;
    this.own.add(node.id);
    const list = this.kids(pid);
    if (index == null || index > list.length) list.push(node.id);
    else list.splice(Math.max(0, index), 0, node.id);
    return node;
  }
  detach(id) {
    const n = this.get(id);
    const list = this.kids(n.parent);
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    return i;
  }
  remove(id) {
    if (!this.get(id)) return;
    this.detach(id);
    this.drop(id);
  }
  drop(id) {
    const n = this.get(id);
    if (!n) return;
    if (n.children) for (const c of n.children) this.drop(c);
    delete this.doc.nodes[id];
  }
  place(id, pid, index) {
    this.detach(id);
    this.set(id, { parent: pid });
    const list = this.kids(pid);
    if (index == null || index > list.length) list.push(id);
    else list.splice(Math.max(0, index), 0, id);
  }
  setStyle(id, style) {
    if (style === undefined) delete this.doc.styles[id];
    else this.doc.styles[id] = style;
  }
}

export function ancestors(doc, id) {
  const out = [];
  for (let n = doc.nodes[id]; n && n.parent; n = doc.nodes[n.parent]) out.push(n.parent);
  return out;
}
export function isSelfOrAncestor(doc, maybeAncestor, id) {
  if (maybeAncestor === id) return true;
  return ancestors(doc, id).includes(maybeAncestor);
}
export function descendants(doc, id, out = []) {
  const n = doc.nodes[id];
  if (n && n.children) for (const c of n.children) { out.push(c); descendants(doc, c, out); }
  return out;
}
// Drop ids whose ancestor is also in the list (moving a frame moves its children).
export function topmost(doc, ids) {
  const set = new Set(ids);
  return ids.filter((id) => doc.nodes[id] && !ancestors(doc, id).some((a) => set.has(a)));
}
export function siblingsOf(doc, id) {
  const n = doc.nodes[id];
  return n.parent ? doc.nodes[n.parent].children : doc.children;
}

// Deep copy of a subtree with fresh ids. Materialised instance children are dropped (the copy re-materialises).
export function cloneSubtree(doc, id, idMap = new Map()) {
  const out = [];
  const walk = (srcId, parent) => {
    const s = doc.nodes[srcId];
    const nid = uid();
    idMap.set(srcId, nid);
    const n = { ...s, id: nid, parent };
    delete n.src; delete n.root;
    if (s.component) delete n.component;
    if (s.children) n.children = s.type === 'instance' ? [] : s.children.map((c) => walk(c, nid));
    out.push(n);
    return nid;
  };
  const rootId = walk(id, null);
  return { rootId, nodes: out };
}

export function nodeCount(doc) { return Object.keys(doc.nodes).length; }

// Documents are untrusted (a .figger.json, a paste or an agent call can come from anywhere), so loading
// sanitises them: structure, ids, numbers, the keys variables may drive, image data and page lists.
export const IMAGE_MIME = /^image\/(png|jpeg|gif|webp|avif)$/; // no SVG images: they can carry script
export const isBase64 = (s) => typeof s === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(s);
const BIND_KEYS = new Set(['fill', 'stroke', 'w', 'h', 'opacity', 'radius', 'strokeWidth', 'fontSize', 'gap', 'padding', 'text', 'name', 'visible']);
const NUM_KEYS = ['x', 'y', 'w', 'h', 'rotation', 'opacity', 'strokeWidth', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'minW', 'maxW', 'minH', 'maxH', 'vw', 'vh', 'sides', 'points', 'inner'];
const finite = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function validateDoc(d) {
  if (!d || typeof d !== 'object') throw new Error('Not a Figger document');
  if (!Array.isArray(d.children) || !d.nodes || typeof d.nodes !== 'object') throw new Error('Document lacks children or nodes');
  if (d.version > FORMAT_VERSION) throw new Error(`Document format ${d.version} is newer than this Figger (${FORMAT_VERSION})`);
  for (const id of d.children) if (!d.nodes[id]) throw new Error(`Missing node ${id}`);
  const nodes = {};
  for (const [id, raw] of Object.entries(d.nodes)) {
    if (!raw || typeof raw !== 'object' || !TYPE_DEFAULTS[raw.type]) continue;
    const n = { ...raw, id };
    for (const k of NUM_KEYS) if (k in n && n[k] !== undefined && n[k] !== null) n[k] = finite(Number(n[k]), k === 'opacity' ? 1 : 0);
    if (n.fontWeight !== undefined) n.fontWeight = Math.max(1, Math.min(1000, Math.round(n.fontWeight || 400)));
    n.w = Math.max(0, n.w ?? 0); n.h = Math.max(0, n.h ?? 0);
    if (Array.isArray(n.radius)) n.radius = n.radius.slice(0, 4).map((v) => Math.max(0, finite(Number(v))));
    else if (n.radius !== undefined) n.radius = Math.max(0, finite(Number(n.radius)));
    if (n.dash !== undefined) n.dash = Array.isArray(n.dash) ? n.dash.map(Number).filter((v) => Number.isFinite(v) && v >= 0).slice(0, 16) : undefined;
    if (n.bind) n.bind = Object.fromEntries(Object.entries(n.bind).filter(([k, v]) => BIND_KEYS.has(k) && typeof v === 'string'));
    if (n.grids) n.grids = Array.isArray(n.grids) ? n.grids.slice(0, 8).map((g) => ({ ...g, count: Math.max(1, Math.min(200, Math.round(finite(g.count, 1)))), size: Math.max(2, finite(g.size, 8)), gutter: Math.max(0, finite(g.gutter)), margin: Math.max(0, finite(g.margin)) })) : undefined;
    if (n.children !== undefined) n.children = Array.isArray(n.children) ? n.children.filter((c) => typeof c === 'string') : [];
    if (typeof n.text !== 'undefined') n.text = String(n.text);
    nodes[id] = n;
  }
  // Drop child references to missing nodes, and parents that do not list their child.
  for (const n of Object.values(nodes)) if (n.children) n.children = n.children.filter((c) => nodes[c]);
  const assets = {};
  for (const [id, a] of Object.entries(d.assets || {})) if (a && IMAGE_MIME.test(a.mime) && isBase64(a.data)) assets[id] = { mime: a.mime, data: a.data, name: String(a.name || id), w: finite(a.w), h: finite(a.h) };
  const out = { version: FORMAT_VERSION, name: String(d.name || 'Untitled'), children: d.children.filter((c) => nodes[c]), nodes, styles: d.styles && typeof d.styles === 'object' ? d.styles : {}, assets };
  if (Array.isArray(d.pages) && d.pages.length) {
    out.pages = d.pages.filter((g) => g && typeof g.id === 'string').map((g) => ({ id: g.id, name: String(g.name || 'Page'), children: (Array.isArray(g.children) ? g.children : []).filter((c) => nodes[c]) }));
    // The open page must be one of the pages; its list is doc.children.
    const open = out.pages.find((g) => g.id === d.page);
    if (open) out.page = open.id;
    else if (out.pages.length) { out.page = out.pages[0].id; out.children = out.pages[0].children.slice(); }
    if (!out.pages.length) delete out.pages;
  }
  if (d.variables && typeof d.variables === 'object') out.variables = { collections: d.variables.collections || {}, vars: d.variables.vars || {} };
  if (typeof d.flowStart === 'string' && nodes[d.flowStart]) out.flowStart = d.flowStart;
  return out;
}
