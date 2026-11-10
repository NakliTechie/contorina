// Components and instances, after FigCraft's design: an instance keeps its main's id plus per-layer
// overrides, and its children are materialised copies (`<instanceId>~<mainLayerId>`) rebuilt on every
// resolve, so a change to the main reaches every instance.
import { applyConstraints } from './layout.js';
import { hasLayout } from './doc.js';

// Visual properties an instance root takes from its main unless it overrides them.
export const ROOT_KEYS = ['fill', 'fillStyle', 'stroke', 'strokeStyle', 'strokeWidth', 'strokeAlign', 'strokeCap', 'strokeJoin', 'dash', 'dashed', 'radius', 'clip', 'layout', 'opacity', 'effects', 'effectStyle', 'blendMode', 'grids', 'gridStyle'];
// Properties a materialised layer may never override (structure and geometry belong to the main).
export const LOCKED_KEYS = new Set(['id', 'type', 'parent', 'children', 'x', 'y', 'w', 'h', 'rotation', 'src', 'root', 'mainId', 'component', 'variant', 'constraints', 'sizing']);

export function syncInstances(tx) {
  const nodes = tx.doc.nodes;
  for (const id of Object.keys(nodes)) {
    const n = nodes[id];
    if (n && n.type === 'instance' && !n.src) materialize(tx, id, 0);
  }
}

function collect(tx, id, out) {
  const n = tx.get(id);
  if (n && n.children) for (const c of n.children) { out.add(c); collect(tx, c, out); }
  return out;
}

export function materialize(tx, instId, depth) {
  const inst = tx.get(instId);
  const main = tx.get(inst.mainId);
  if (!main || !main.component || depth > 8) return;
  const stale = collect(tx, instId, new Set());
  const ov = inst.overrides || {};
  const nested = [];
  const copy = (srcId, parentId) => {
    const s = tx.get(srcId);
    const id = instId + '~' + srcId;
    const o = ov[srcId] || {};
    const n = { ...s };
    delete n.component; delete n.variant; delete n.overrides; delete n.props;
    for (const k in o) if (!LOCKED_KEYS.has(k) && k !== 'overrides') n[k] = o[k];
    n.id = id; n.parent = parentId; n.src = srcId; n.root = instId;
    if (s.type === 'instance') {
      n.overrides = { ...(s.overrides || {}), ...(o.overrides || {}) };
      n.children = [];
      nested.push(id);
    } else if (s.children) n.children = s.children.map((c) => copy(c, id));
    tx.doc.nodes[id] = n;
    tx.own.add(id);
    stale.delete(id);
    return id;
  };
  const kids = main.children.map((c) => copy(c, instId));
  // Component properties: text, boolean (visibility) and instance swap, set per instance.
  for (const [name, def] of Object.entries(main.props || {})) {
    const target = tx.doc.nodes[instId + '~' + def.target];
    if (!target) continue;
    const v = (inst.propValues || {})[name] ?? def.default;
    if (def.type === 'text' && target.type === 'text' && typeof v === 'string') target.text = v;
    else if (def.type === 'boolean') target.visible = v !== false;
    else if (def.type === 'swap' && target.type === 'instance' && tx.doc.nodes[v] && tx.doc.nodes[v].component) target.mainId = v;
  }
  for (const id of stale) delete tx.doc.nodes[id];
  const rootPatch = { children: kids };
  const rootOv = ov.$root || {};
  for (const k of ROOT_KEYS) rootPatch[k] = k in rootOv ? rootOv[k] : main[k];
  if (!inst.sizing && main.sizing) rootPatch.sizing = main.sizing;
  tx.set(instId, rootPatch);
  for (const id of nested) materialize(tx, id, depth + 1);
  const cur = tx.get(instId);
  // Children sit where the main has them; move them by their constraints to the instance size.
  if (!hasLayout(cur) && (cur.w !== main.w || cur.h !== main.h)) applyConstraints(tx, instId, main.w, main.h);
}

// The top-level instance that owns a materialised layer, and the key path into its overrides.
export function overridePath(doc, id) {
  let n = doc.nodes[id];
  if (!n || !n.src) return null;
  const keys = [n.src];
  let r = doc.nodes[n.root];
  while (r && r.src) { keys.unshift(r.src); r = doc.nodes[r.root]; }
  return r ? { instanceId: r.id, keys } : null;
}

export function writeOverride(tx, id, patch) {
  const p = overridePath(tx.doc, id);
  if (!p) return false;
  const inst = tx.get(p.instanceId);
  const root = structuredClone(inst.overrides || {});
  let cur = root;
  p.keys.forEach((k, i) => {
    cur[k] = cur[k] || {};
    if (i < p.keys.length - 1) { cur[k].overrides = cur[k].overrides || {}; cur = cur[k].overrides; } else cur = cur[k];
  });
  for (const k in patch) if (!LOCKED_KEYS.has(k)) { if (patch[k] === undefined) delete cur[k]; else cur[k] = patch[k]; }
  tx.set(p.instanceId, { overrides: root });
  return true;
}

// Variant helpers. A component set is a frame with `variantSet: true` whose children are mains with `variant` maps.
export function variantSetOf(doc, mainId) {
  const m = doc.nodes[mainId];
  const p = m && m.parent && doc.nodes[m.parent];
  return p && p.variantSet ? p : null;
}
export function variantProps(doc, set) {
  const props = {};
  for (const cid of set.children) {
    const v = doc.nodes[cid].variant || {};
    for (const k in v) (props[k] = props[k] || new Set()).add(v[k]);
  }
  return Object.fromEntries(Object.entries(props).map(([k, s]) => [k, [...s]]));
}
export function findVariant(doc, set, want) {
  const ids = set.children.filter((c) => doc.nodes[c].component);
  const exact = ids.find((c) => Object.entries(want).every(([k, v]) => (doc.nodes[c].variant || {})[k] === v));
  if (exact) return exact;
  // Fall back to the variant matching the most properties, preferring the changed one.
  let best = null, score = -1;
  for (const c of ids) {
    const v = doc.nodes[c].variant || {};
    const s = Object.entries(want).filter(([k, val]) => v[k] === val).length;
    if (s > score) { best = c; score = s; }
  }
  return best;
}
export function parseVariantName(name) {
  const out = {};
  for (const part of String(name).split(',')) {
    const m = part.match(/^\s*([^=]+?)\s*=\s*(.+?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return Object.keys(out).length ? out : null;
}

// Map main-layer ids to name paths, so overrides survive a swap to a sibling variant.
function namePaths(doc, rootId) {
  const out = new Map();
  const walk = (id, prefix) => {
    const n = doc.nodes[id];
    for (const c of n.children || []) {
      const p = prefix + '/' + doc.nodes[c].name;
      out.set(c, p);
      if (doc.nodes[c].type !== 'instance') walk(c, p);
    }
  };
  walk(rootId, '');
  return out;
}
export function remapOverrides(doc, overrides, fromMain, toMain) {
  if (!overrides) return overrides;
  const from = namePaths(doc, fromMain);
  const toByPath = new Map([...namePaths(doc, toMain)].map(([id, p]) => [p, id]));
  const out = {};
  for (const k in overrides) {
    if (k === '$root') { out.$root = overrides.$root; continue; }
    const target = toByPath.get(from.get(k));
    if (target) out[target] = overrides[k];
  }
  return out;
}
