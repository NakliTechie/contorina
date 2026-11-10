// Variables with collections and modes (scope layer 4). Pure.
// doc.variables = {
//   collections: { [cid]: { name, modes: [{ id, name }] } },
//   vars: { [vid]: { name, collection, type: 'color'|'number'|'string'|'boolean', values: { [modeId]: value | { alias: vid } } } },
// }
// A layer binds properties with node.bind = { [prop]: vid }; a frame or instance picks a mode per
// collection with node.modes = { [cid]: modeId }, inherited by everything inside it.
export const BINDABLE = {
  color: ['fill', 'stroke'],
  number: ['w', 'h', 'opacity', 'radius', 'strokeWidth', 'fontSize', 'gap', 'padding'],
  string: ['text', 'name'],
  boolean: ['visible'],
};
export const VAR_TYPES = Object.keys(BINDABLE);

const sameType = (type, val) => (type === 'color' ? typeof val === 'string' && /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(val) : type === 'number' ? typeof val === 'number' && Number.isFinite(val) : type === 'string' ? typeof val === 'string' : typeof val === 'boolean');

export function emptyVariables() { return { collections: {}, vars: {} }; }

// The value of a variable in a mode, following aliases (cycle-safe).
export function valueOf(V, vid, modeFor, depth = 0) {
  const v = V.vars[vid];
  if (!v || depth > 16) return undefined;
  const c = V.collections[v.collection];
  if (!c) return undefined;
  const mode = modeFor(v.collection) || c.modes[0]?.id;
  let val = v.values[mode];
  if (val === undefined) val = v.values[c.modes[0]?.id];
  if (val && typeof val === 'object' && val.alias) return valueOf(V, val.alias, modeFor, depth + 1);
  return val;
}

// Mode lookup for a layer: its own choice, else the nearest ancestor's.
function modeLookup(doc, id) {
  return (cid) => {
    for (let n = doc.nodes[id]; n; n = n.parent ? doc.nodes[n.parent] : null) if (n.modes && n.modes[cid]) return n.modes[cid];
    return null;
  };
}

// Resolve pass: write bound values into the layer properties they drive.
export function applyVariables(tx) {
  const V = tx.doc.variables;
  if (!V || !Object.keys(V.vars || {}).length) return;
  const nodes = tx.doc.nodes;
  for (const id in nodes) {
    const n = nodes[id];
    if (!n.bind) continue;
    const look = modeLookup(tx.doc, id);
    const patch = {};
    for (const [prop, vid] of Object.entries(n.bind)) {
      const v = V.vars[vid];
      if (!v || !BINDABLE[v.type] || !BINDABLE[v.type].includes(prop)) continue; // a variable drives only its own kind of property
      const val = valueOf(V, vid, look);
      if (!sameType(v.type, val)) continue;
      if (val === undefined) continue;
      if (prop === 'gap' || prop === 'padding') {
        if (!n.layout) continue;
        const L = { ...n.layout };
        if (prop === 'gap') L.gap = val; else L.pad = [val, val, val, val];
        if (JSON.stringify(L) !== JSON.stringify(n.layout)) patch.layout = L;
        continue;
      }
      if (prop === 'opacity' && typeof val === 'number' && val > 1) { if (n.opacity !== val / 100) patch.opacity = val / 100; continue; }
      if (n[prop] !== val) patch[prop] = val;
    }
    if (Object.keys(patch).length) tx.set(id, patch);
  }
}
