// Commands for paints, images, vectors and booleans (scope layer 3). DOM-free, like commands.js.
import polygonClipping from 'polygon-clipping';
import { register, get } from './registry.js';
import { makeNode, topmost, uid, IMAGE_MIME, isBase64 } from './doc.js';
import { worldMatrix, inv, IDENT, round2 } from './geom.js';
import { outlineD, outlineInParent, transformD, parsePath, flatten, fitVector, serialize, polygonD } from './vector.js';
import { firstColor } from './paint.js';

const ids$ = { type: 'array', desc: 'Node ids; defaults to the current selection' };
const sel = (tx, p, env) => (p.ids ?? env.selection ?? []).filter((id) => tx.get(id));
const pm = (tx, pid) => (pid ? worldMatrix(tx.doc, pid) : IDENT);

// Keep only layer properties that make sense on a vector made from another layer.
const KEEP = ['name', 'fill', 'fillStyle', 'stroke', 'strokeStyle', 'strokeWidth', 'strokeAlign', 'strokeCap', 'strokeJoin', 'dash', 'opacity', 'effects', 'blendMode', 'visible', 'constraints', 'sizing'];
const keep = (n) => Object.fromEntries(KEEP.filter((k) => n[k] !== undefined).map((k) => [k, n[k]]));

function replaceWith(tx, oldId, node) {
  const o = tx.get(oldId);
  const list = tx.childIds(o.parent);
  const index = list.indexOf(oldId);
  tx.remove(oldId);
  tx.add(node, o.parent, index);
  return node.id;
}

// World-space rings of a layer's outline, for polygon-clipping: [[[x, y], ...], ...].
function rings(tx, id) {
  const n = tx.get(id);
  const d = transformD(outlineD(n), worldMatrix(tx.doc, id));
  return flatten(parsePath(d), 0.2).filter((r) => r.pts.length > 2).map((r) => {
    const pts = r.pts.map(([x, y]) => [x, y]);
    pts.push(pts[0]);
    return pts;
  });
}
// Rings of one layer as a polygon-clipping MultiPolygon. Even-odd holes: polygon-clipping's xor of
// the rings gives the even-odd area, which matches how SVG draws evenodd and most simple shapes.
function geom(tx, id) {
  const rs = rings(tx, id);
  if (!rs.length) return [];
  return rs.slice(1).reduce((acc, r) => polygonClipping.xor(acc, [[r]]), [[rs[0]]]);
}

register(
  {
    id: 'asset.add', label: 'Add image asset', group: 'Insert', hidden: true,
    description: 'Store an image (base64 data, MIME type) in the document and return its asset id.',
    params: { mime: { type: 'string', required: true }, data: { type: 'string', required: true }, name: { type: 'string' }, w: { type: 'number' }, h: { type: 'number' }, id: { type: 'string' } },
    doc(tx, p) {
      if (!IMAGE_MIME.test(p.mime)) throw new Error(`Unsupported image type ${p.mime}`);
      if (!isBase64(p.data)) throw new Error('Image data must be base64');
      const id = p.id || 'img' + uid();
      tx.doc.assets[id] = { mime: p.mime, data: p.data, name: p.name || id, w: p.w, h: p.h };
      return { value: id };
    },
  },
  {
    id: 'image.place', label: 'Place image', group: 'Insert', hidden: true,
    description: 'Place a stored image asset as a rectangle with an image fill at (x, y), at its natural size unless w and h are given.',
    params: { asset: { type: 'string', required: true }, x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' }, parent: { type: 'string', nullable: true }, id: { type: 'string' } },
    doc(tx, p) {
      const a = tx.doc.assets[p.asset];
      if (!a) throw new Error(`No asset ${p.asset}`);
      let w = p.w || a.w || 200, h = p.h || a.h || 200;
      if (!p.w && w > 1200) { h = (h * 1200) / w; w = 1200; }
      const n = makeNode('rect', { ...(p.id ? { id: p.id } : {}), name: a.name || 'Image', x: round2(p.x || 0), y: round2(p.y || 0), w: round2(w), h: round2(h), fill: { type: 'image', asset: p.asset, mode: 'fill' } });
      tx.add(n, p.parent ?? null);
      return { select: [n.id], value: n.id };
    },
  },
  {
    id: 'vector.create', label: 'Create vector', group: 'Insert', hidden: true,
    description: 'Create a vector layer from SVG path data given in the parent frame\'s coordinates (or canvas coordinates with no parent).',
    params: { d: { type: 'string', required: true }, parent: { type: 'string', nullable: true }, props: { type: 'object' }, id: { type: 'string' } },
    doc(tx, p) {
      const f = fitVector(p.d);
      const closed = /z\s*$/i.test(p.d.trim());
      const n = makeNode('vector', { ...(p.id ? { id: p.id } : {}), ...f, fill: closed ? '#D9D9D9' : null, stroke: '#1E1E1E', strokeWidth: closed ? 0 : 2, ...(p.props || {}) });
      tx.add(n, p.parent ?? null);
      return { select: [n.id], value: n.id };
    },
  },
  {
    id: 'vector.setPath', label: 'Edit vector path', group: 'Edit', hidden: true,
    description: 'Replace a vector layer\'s path; d is in the layer\'s own units (0..w, 0..h before the edit). The layer box refits to the new path.',
    params: { id: { type: 'string', required: true }, d: { type: 'string', required: true } },
    doc(tx, p) {
      const n = tx.get(p.id);
      if (!n || n.type !== 'vector' || n.src) return false;
      const f = fitVector(p.d);
      // The path moved inside the box by (f.x, f.y) and the box changed size, so its centre moves by
      // R * (f + new half size - old half size); then every untouched point stays where it was on screen.
      const r = ((n.rotation || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
      const vx = f.x + f.w / 2 - n.w / 2, vy = f.y + f.h / 2 - n.h / 2;
      const cx = n.x + n.w / 2 + c * vx - s * vy, cy = n.y + n.h / 2 + s * vx + c * vy;
      tx.set(p.id, { x: round2(cx - f.w / 2), y: round2(cy - f.h / 2), w: f.w, h: f.h, vw: f.vw, vh: f.vh, d: f.d });
    },
  },
  {
    id: 'node.flatten', label: 'Flatten to vector', group: 'Arrange', keys: ['Mod+E'],
    description: 'Turn shapes into editable vector paths (rotation is baked into the path).',
    params: { ids: ids$ },
    doc(tx, p, env) {
      const ids = topmost(tx.doc, sel(tx, p, env)).filter((id) => { const n = tx.get(id); return !n.src && (!n.children || n.type === 'boolean') && n.type !== 'text' && n.type !== 'line'; });
      if (!ids.length) return false;
      const out = [];
      for (const id of ids) {
        const n = tx.get(id);
        const f = fitVector(outlineInParent(n));
        if (n.type === 'boolean') for (const c of n.children.slice()) tx.remove(c);
        out.push(replaceWith(tx, id, makeNode('vector', { ...keep(n), ...f, fillRule: 'evenodd' })));
      }
      return { select: out };
    },
  },
  {
    id: 'boolean.apply', label: 'Boolean operation', group: 'Arrange', hidden: true,
    description: 'Combine shapes into one vector: union, subtract (from the bottom-most), intersect or exclude.',
    params: { ids: ids$, op: { type: 'string', required: true, enum: ['union', 'subtract', 'intersect', 'exclude'] } },
    doc(tx, p, env) {
      const ids = topmost(tx.doc, sel(tx, p, env)).filter((id) => { const n = tx.get(id); return !n.src && n.type !== 'text'; });
      if (ids.length < 2) throw new Error('Select two or more shapes');
      const parent = tx.get(ids[0]).parent;
      const order = tx.childIds(parent);
      ids.sort((a, b) => order.indexOf(a) - order.indexOf(b)); // bottom-most first
      const gs = ids.map((id) => geom(tx, id));
      const fn = { union: polygonClipping.union, subtract: polygonClipping.difference, intersect: polygonClipping.intersection, exclude: polygonClipping.xor }[p.op];
      const res = fn(gs[0], ...gs.slice(1));
      const local = inv(pm(tx, parent));
      const d = serialize(res.flatMap((poly) => poly.map((ring) => ({
        closed: true,
        segs: ring.slice(0, -1).map((pt, i) => ({ c: i ? 'L' : 'M', pts: [[local[0] * pt[0] + local[2] * pt[1] + local[4], local[1] * pt[0] + local[3] * pt[1] + local[5]]] })),
      }))));
      if (!d) throw new Error('The result is empty');
      const base = tx.get(ids[0]);
      const index = order.indexOf(ids[ids.length - 1]) - ids.length + 1;
      const node = makeNode('vector', { ...keep(base), name: { union: 'Union', subtract: 'Subtract', intersect: 'Intersect', exclude: 'Exclude' }[p.op], ...fitVector(d), fillRule: 'evenodd' });
      if (!node.fill && !node.stroke) node.fill = '#D9D9D9';
      for (const id of ids) tx.remove(id);
      tx.add(node, parent, Math.max(0, index));
      return { select: [node.id], value: node.id };
    },
  },
  {
    id: 'boolean.group', label: 'Boolean group (live)', group: 'Arrange', hidden: true,
    description: 'Combine shapes into a live boolean group (union, subtract, intersect, exclude); the shapes stay editable inside it. Flatten bakes it into one path.',
    params: { ids: ids$, op: { type: 'string', required: true, enum: ['union', 'subtract', 'intersect', 'exclude'] } },
    doc(tx, p, env) {
      const ids = topmost(tx.doc, sel(tx, p, env)).filter((id) => { const n = tx.get(id); return !n.src && n.type !== 'text'; });
      if (ids.length < 2) throw new Error('Select two or more shapes');
      const parent = tx.get(ids[0]).parent;
      const order = tx.childIds(parent);
      ids.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      const base = tx.get(ids[0]);
      const index = order.indexOf(ids[ids.length - 1]) - ids.length + 1;
      const g = makeNode('boolean', { ...keep(base), name: { union: 'Union', subtract: 'Subtract', intersect: 'Intersect', exclude: 'Exclude' }[p.op], op: p.op, x: 0, y: 0, w: 1, h: 1 });
      if (!g.fill && !g.stroke) g.fill = '#D9D9D9';
      for (const id of ids) tx.detach(id);
      tx.add(g, parent, Math.max(0, index));
      // Children keep their parent coordinates; syncBooleans then moves the box onto the result.
      for (const id of ids) { tx.add(tx.mut(id), g.id); }
      return { select: [g.id], value: g.id };
    },
  },
  {
    id: 'boolean.setOp', label: 'Change boolean operation', group: 'Arrange', hidden: true,
    params: { ids: ids$, op: { type: 'string', required: true, enum: ['union', 'subtract', 'intersect', 'exclude'] } },
    doc(tx, p, env) {
      const ids = sel(tx, p, env).filter((id) => tx.get(id).type === 'boolean' && !tx.get(id).src);
      if (!ids.length) return false;
      for (const id of ids) tx.set(id, { op: p.op });
    },
  },
  ...['union', 'subtract', 'intersect', 'exclude'].map((op) => ({
    id: 'boolean.' + op, label: `Boolean: ${op[0].toUpperCase() + op.slice(1)}`, group: 'Arrange',
    keys: { union: ['Alt+Shift+U'], subtract: ['Alt+Shift+S'], intersect: ['Alt+Shift+I'], exclude: ['Alt+Shift+X'] }[op],
    doc(tx, p, env) { return get('boolean.group').doc(tx, { ids: p.ids, op }, env); },
  })),
);
// Live booleans: the layer's outline is the operation applied to its children, recomputed on every
// edit; children stay editable, and the box follows the result (children shift to stay in place).
export function syncBooleans(tx) {
  for (const id of Object.keys(tx.doc.nodes)) {
    const n = tx.get(id);
    if (!n || n.type !== 'boolean' || !n.children || !n.children.length) continue;
    const kids = n.children.filter((c) => tx.get(c) && tx.get(c).visible !== false);
    const gs = kids.map((c) => {
      const rs = flatten(parsePath(outlineInParent(tx.get(c))), 0.2).filter((r) => r.pts.length > 2).map((r) => [...r.pts.map(([x, y]) => [x, y]), r.pts[0]]);
      return rs.length ? rs.slice(1).reduce((acc, r) => polygonClipping.xor(acc, [[r]]), [[rs[0]]]) : [];
    });
    const fn = { union: polygonClipping.union, subtract: polygonClipping.difference, intersect: polygonClipping.intersection, exclude: polygonClipping.xor }[n.op] || polygonClipping.union;
    const res = gs.length ? fn(gs[0], ...gs.slice(1)) : [];
    const d = serialize(res.flatMap((poly) => poly.map((ring) => ({ closed: true, segs: ring.slice(0, -1).map((pt, i) => ({ c: i ? 'L' : 'M', pts: [pt] })) }))));
    if (!d) { if (n.d) tx.set(id, { d: '' }); continue; }
    const f = fitVector(d);
    if (Math.abs(f.x) > 1e-6 || Math.abs(f.y) > 1e-6) {
      for (const c of n.children) { const k = tx.get(c); if (k) tx.set(c, { x: round2(k.x - f.x), y: round2(k.y - f.y) }); }
      tx.set(id, { x: round2(n.x + f.x), y: round2(n.y + f.y), w: f.w, h: f.h, vw: f.vw, vh: f.vh, d: f.d });
    } else if (n.d !== f.d || n.w !== f.w || n.h !== f.h) tx.set(id, { w: f.w, h: f.h, vw: f.vw, vh: f.vh, d: f.d });
  }
}

export { polygonD };
