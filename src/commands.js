// Document commands. Each edits the document through a Tx and has no DOM dependency, so Node tests,
// the agent face and the NakliOS common rail run exactly what the UI runs.
import { register } from './registry.js';
import { makeNode, topmost, isSelfOrAncestor, cloneSubtree, uid, hasLayout, isContainer, descendants, TYPES } from './doc.js';
import { worldMatrix, inv, apply, mul, localMatrix, corners, boxOfPoints, IDENT, worldBox, round2 } from './geom.js';
import { setGeometry, DEFAULT_LAYOUT } from './layout.js';
import { writeOverride, ROOT_KEYS, variantSetOf, findVariant, parseVariantName, remapOverrides } from './components.js';
import { TEXT_KEYS } from './styles.js';
import { shiftRuns, styleRange } from './text.js';

const GEOM = new Set(['x', 'y', 'w', 'h', 'rotation']);
const sel = (tx, p, env) => (p.ids ?? env.selection ?? []).filter((id) => tx.get(id));
const ids$ = { type: 'array', desc: 'Node ids; defaults to the current selection' };
const pm = (tx, pid) => (pid ? worldMatrix(tx.doc, pid) : IDENT);
const centerWorld = (tx, id) => { const n = tx.get(id); return apply(worldMatrix(tx.doc, id), { x: n.w / 2, y: n.h / 2 }); };
const editable = (tx, id) => { const n = tx.get(id); return n && !n.src && !n.locked; };

const angleOf = (m) => (Math.atan2(m[1], m[0]) * 180) / Math.PI;
function placeCentered(tx, id, pid, worldC, index) {
  const n = tx.get(id);
  const lc = apply(inv(pm(tx, pid)), worldC);
  // Keep the angle on screen: add the old parent's rotation, subtract the new one's.
  const turn = pid !== n.parent ? angleOf(pm(tx, n.parent)) - angleOf(pm(tx, pid)) : 0;
  if (pid !== n.parent || index != null) tx.place(id, pid, index);
  const patch = { x: round2(lc.x - n.w / 2), y: round2(lc.y - n.h / 2) };
  if (Math.abs(turn) > 1e-6) patch.rotation = round2((((n.rotation || 0) + turn + 180) % 360 + 360) % 360 - 180);
  tx.set(id, patch);
}

// Write non-geometry properties on any layer: inside an instance they become overrides; on an
// instance root, properties the main owns go to its $root overrides so the next sync keeps them.
export function writeProps(tx, id, patch) {
  const n = tx.get(id);
  if (n.src) return writeOverride(tx, id, patch);
  if (n.type === 'instance') {
    const rootOv = { ...((n.overrides || {}).$root || {}) };
    const direct = {};
    for (const [k, v] of Object.entries(patch)) {
      if (ROOT_KEYS.includes(k)) { if (v === undefined) delete rootOv[k]; else rootOv[k] = v; } else direct[k] = v;
    }
    return tx.set(id, { ...direct, overrides: { ...(n.overrides || {}), $root: rootOv } });
  }
  return tx.set(id, patch);
}

// Insertion index in an auto-layout parent from a parent-local point along the main axis.
function flowIndex(tx, pid, id, lc) {
  const p = tx.get(pid);
  const row = p.layout.mode === 'row';
  const sibs = p.children.filter((c) => c !== id);
  let i = 0;
  for (const c of sibs) {
    const s = tx.get(c);
    const mid = row ? s.x + s.w / 2 : s.y + s.h / 2;
    if ((row ? lc.x : lc.y) > mid) i = sibs.indexOf(c) + 1;
  }
  return i;
}

function validTarget(tx, id, target) {
  if (target == null) return true;
  const t = tx.get(target);
  return !!t && t.type === 'frame' && !t.src && !isSelfOrAncestor(tx.doc, id, target);
}

// Parent-local axis-aligned box of a node (accounts for its rotation).
function localBox(n) { return boxOfPoints(corners(n).map((p) => apply(localMatrix(n), p))); }

function wrapInFrame(tx, ids, props = {}) {
  const parent = tx.get(ids[0]).parent;
  for (const id of ids.slice(1)) if (tx.get(id).parent !== parent) placeCentered(tx, id, parent, centerWorld(tx, id));
  const list = tx.childIds(parent);
  const index = Math.max(...ids.map((id) => list.indexOf(id))) - ids.length + 1;
  const b = boxOfPoints(ids.flatMap((id) => { const r = localBox(tx.get(id)); return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h }]; }));
  const f = makeNode('frame', { x: round2(b.x), y: round2(b.y), w: round2(b.w), h: round2(b.h), fill: null, ...props });
  const ordered = list.filter((c) => ids.includes(c));
  for (const id of ordered) tx.detach(id);
  tx.add(f, parent, Math.max(0, index));
  for (const id of ordered) {
    const n = tx.get(id);
    tx.add(tx.mut(id), f.id);
    tx.set(id, { x: round2(n.x - b.x), y: round2(n.y - b.y) });
  }
  return f.id;
}

register(
  {
    id: 'node.create', label: 'Create layer', group: 'Insert', hidden: true,
    description: 'Create a layer (frame, rect, ellipse, line, text or instance) at a position inside a parent frame or on the canvas.',
    params: {
      type: { type: 'string', required: true, enum: TYPES.filter((t) => t !== 'instance') },
      parent: { type: 'string', nullable: true, desc: 'Parent frame id; null or omitted for the canvas' },
      x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' },
      props: { type: 'object', desc: 'Any other layer properties (fill, text, name, ...)' },
      id: { type: 'string', desc: 'Optional id for the new layer' },
    },
    doc(tx, p) {
      const parent = p.parent ?? null;
      if (parent && !validTarget(tx, '', parent)) throw new Error('Parent must be a frame');
      const n = makeNode(p.type, { ...(p.props || {}), ...(p.id ? { id: p.id } : {}) });
      for (const k of ['x', 'y', 'w', 'h']) if (Number.isFinite(p[k])) n[k] = round2(p[k]);
      if (n.type === 'line') n.h = 0;
      if (p.type === 'text' && Number.isFinite(p.w) && p.w > 1 && !(p.props && p.props.autoSize)) n.autoSize = 'height';
      tx.add(n, parent);
      return { select: [n.id], value: n.id };
    },
  },
  {
    id: 'node.set', label: 'Set layer properties', group: 'Edit', hidden: true,
    description: 'Set properties on layers: geometry (x, y, w, h, rotation), fill, stroke, strokeWidth, radius, opacity, text and font properties, name, clip.',
    params: { ids: ids$, props: { type: 'object', required: true } },
    doc(tx, p, env) {
      const ids = sel(tx, p, env);
      if (!ids.length) return false;
      for (const id of ids) {
        const n = tx.get(id);
        const geom = {}, rest = {};
        for (const [k, v] of Object.entries(p.props)) (GEOM.has(k) ? geom : rest)[k] = v;
        if (n.src) { writeOverride(tx, id, rest); continue; }
        // Setting a bound property directly detaches it from its variable.
        if (n.bind && Object.keys(p.props).some((k) => k in n.bind)) {
          const b = Object.fromEntries(Object.entries(n.bind).filter(([k]) => !(k in p.props)));
          tx.set(id, { bind: Object.keys(b).length ? b : undefined });
        }
        if (Object.keys(geom).length) setGeometry(tx, id, geom);
        if (Object.keys(rest).length) writeProps(tx, id, rest);
      }
    },
  },
  {
    id: 'node.move', label: 'Move layers', group: 'Edit', hidden: true,
    description: 'Move layers by (dx, dy) in canvas units, optionally into another frame (parent) or onto the canvas (parent null). In an auto-layout frame the move reorders.',
    params: { ids: ids$, dx: { type: 'number' }, dy: { type: 'number' }, parent: { type: 'string', nullable: true } },
    doc(tx, p, env) {
      const ids = topmost(tx.doc, sel(tx, p, env)).filter((id) => editable(tx, id));
      if (!ids.length) return false;
      for (const id of ids) {
        const n = tx.get(id);
        const c = centerWorld(tx, id);
        c.x += p.dx || 0; c.y += p.dy || 0;
        let target = p.parent === undefined ? n.parent : p.parent;
        if (!validTarget(tx, id, target)) target = n.parent;
        const tp = target && tx.get(target);
        if (tp && hasLayout(tp)) {
          const lc = apply(inv(pm(tx, target)), c);
          tx.place(id, target, flowIndex(tx, target, id, lc));
          if (target !== n.parent) tx.set(id, { x: round2(lc.x - n.w / 2), y: round2(lc.y - n.h / 2) });
        } else placeCentered(tx, id, target, c, target !== n.parent ? undefined : null);
      }
    },
  },
  {
    id: 'node.nudge', label: 'Nudge selection', group: 'Edit', hidden: true,
    params: { dx: { type: 'number' }, dy: { type: 'number' } },
    keys: [], // arrows are bound in the key handler
    doc(tx, p, env) {
      const ids = topmost(tx.doc, sel(tx, {}, env)).filter((id) => editable(tx, id));
      if (!ids.length) return false;
      for (const id of ids) {
        const n = tx.get(id);
        const par = n.parent && tx.get(n.parent);
        if (par && hasLayout(par)) {
          const list = par.children, i = list.indexOf(id);
          const step = (par.layout.mode === 'row' ? p.dx : p.dy) || 0;
          const j = Math.max(0, Math.min(list.length - 1, i + Math.sign(step)));
          if (j !== i) tx.place(id, n.parent, j);
        } else tx.set(id, { x: round2(n.x + (p.dx || 0)), y: round2(n.y + (p.dy || 0)) });
      }
    },
  },
  {
    id: 'node.reparent', label: 'Move layers into', group: 'Edit', hidden: true,
    description: 'Put layers into a frame (or the canvas) at a child index, keeping their position on screen.',
    params: { ids: ids$, parent: { type: 'string', nullable: true, required: false }, index: { type: 'number' } },
    doc(tx, p, env) {
      const target = p.parent ?? null;
      const ids = topmost(tx.doc, sel(tx, p, env)).filter((id) => editable(tx, id) && validTarget(tx, id, target));
      if (!ids.length) return false;
      let index = p.index;
      for (const id of ids) {
        const n = tx.get(id);
        const c = centerWorld(tx, id);
        if (index != null && n.parent === target) {
          const old = tx.childIds(target).indexOf(id);
          if (old < index) index--;
        }
        placeCentered(tx, id, target, c, index ?? undefined);
        if (index != null) index++;
      }
    },
  },
  {
    id: 'node.rename', label: 'Rename layer', group: 'Edit', hidden: true,
    params: { id: { type: 'string', required: true }, name: { type: 'string', required: true } },
    doc(tx, p) {
      if (!tx.get(p.id) || tx.get(p.id).src) return false;
      tx.set(p.id, { name: p.name.trim() || tx.get(p.id).name });
      const n = tx.get(p.id);
      const set = n.component && variantSetOf(tx.doc, p.id);
      if (set) { const v = parseVariantName(n.name); if (v) tx.set(p.id, { variant: v }); }
    },
  },
  {
    id: 'edit.delete', label: 'Delete', group: 'Edit', keys: ['Backspace', 'Delete'], scope: 'destructive',
    description: 'Delete layers and everything inside them.',
    params: { ids: ids$ },
    doc(tx, p, env) {
      const ids = topmost(tx.doc, sel(tx, p, env)).filter((id) => !tx.get(id).src);
      if (!ids.length) return false;
      for (const id of ids) tx.remove(id);
      return { select: [] };
    },
  },
  {
    id: 'edit.duplicate', label: 'Duplicate', group: 'Edit', keys: ['Mod+D'],
    params: { ids: ids$ },
    doc(tx, p, env) {
      const ids = topmost(tx.doc, sel(tx, p, env)).filter((id) => !tx.get(id).src);
      if (!ids.length) return false;
      const out = [];
      for (const id of ids) {
        const n = tx.get(id);
        const { rootId, nodes } = cloneSubtree(tx.doc, id);
        for (const c of nodes) tx.doc.nodes[c.id] = c, tx.own.add(c.id);
        const list = tx.childIds(n.parent);
        tx.doc.nodes[rootId].parent = null;
        tx.add(tx.doc.nodes[rootId], n.parent, list.indexOf(id) + 1);
        const par = n.parent && tx.get(n.parent);
        if (!(par && hasLayout(par))) tx.set(rootId, { x: n.x + 10, y: n.y + 10 });
        out.push(rootId);
      }
      return { select: out, value: out };
    },
  },
  {
    id: 'node.insertTree', label: 'Insert layers', group: 'Edit', hidden: true,
    description: 'Insert copied layer trees ({rootIds, nodes}) into a frame or the canvas, offset by (dx, dy).',
    params: { tree: { type: 'object', required: true }, parent: { type: 'string', nullable: true }, dx: { type: 'number' }, dy: { type: 'number' } },
    doc(tx, p) {
      const { rootIds, nodes, styles } = p.tree;
      if (!Array.isArray(rootIds) || !nodes) throw new Error('tree needs rootIds and nodes');
      const map = new Map(Object.keys(nodes).map((id) => [id, uid()]));
      for (const [sid, st] of Object.entries(styles || {})) if (!tx.doc.styles[sid]) tx.setStyle(sid, st);
      for (const [oid, n] of Object.entries(nodes)) {
        const c = { ...n, id: map.get(oid), parent: n.parent && map.get(n.parent) };
        if (c.children) c.children = n.children.map((x) => map.get(x)).filter(Boolean);
        if (c.type === 'instance') c.children = [];
        tx.doc.nodes[c.id] = c; tx.own.add(c.id);
      }
      const target = p.parent && validTarget(tx, '', p.parent) ? p.parent : null;
      const out = [];
      for (const r of rootIds) {
        const id = map.get(r);
        const c = tx.get(id);
        c.parent = null;
        tx.add(c, target);
        tx.set(id, { x: round2(c.x + (p.dx || 0)), y: round2(c.y + (p.dy || 0)) });
        out.push(id);
      }
      return { select: out, value: out };
    },
  },
  {
    id: 'node.setVisible', label: 'Show or hide layers', group: 'Edit', keys: ['Shift+Mod+H'],
    params: { ids: ids$, value: { type: 'boolean', desc: 'Omit to toggle' } },
    doc(tx, p, env) {
      const ids = sel(tx, p, env);
      if (!ids.length) return false;
      const v = p.value ?? !ids.every((id) => tx.get(id).visible !== false);
      for (const id of ids) writeProps(tx, id, { visible: v });
    },
  },
  {
    id: 'node.setLocked', label: 'Lock or unlock layers', group: 'Edit', keys: ['Shift+Mod+L'],
    params: { ids: ids$, value: { type: 'boolean', desc: 'Omit to toggle' } },
    doc(tx, p, env) {
      const ids = sel(tx, p, env).filter((id) => !tx.get(id).src);
      if (!ids.length) return false;
      const v = p.value ?? !ids.every((id) => tx.get(id).locked);
      for (const id of ids) tx.set(id, { locked: v });
      return v ? { select: [] } : undefined;
    },
  },
  {
    id: 'node.order', label: 'Arrange layers', group: 'Arrange', hidden: true,
    params: { ids: ids$, to: { type: 'string', required: true, enum: ['front', 'back', 'forward', 'backward'] } },
    doc(tx, p, env) {
      const ids = topmost(tx.doc, sel(tx, p, env)).filter((id) => !tx.get(id).src);
      if (!ids.length) return false;
      for (const id of p.to === 'front' || p.to === 'backward' ? ids : ids.slice().reverse()) {
        const n = tx.get(id);
        const list = tx.childIds(n.parent);
        const i = list.indexOf(id);
        const j = { front: list.length, back: 0, forward: i + 2, backward: i - 1 }[p.to];
        if (p.to === 'forward') { if (i < list.length - 1) tx.place(id, n.parent, i + 1); }
        else tx.place(id, n.parent, Math.max(0, j));
      }
    },
  },
  { id: 'arrange.front', label: 'Bring to front', group: 'Arrange', keys: ['Mod+Alt+]', ']'], doc: (tx, p, env) => cmdOrder(tx, env, 'front') },
  { id: 'arrange.back', label: 'Send to back', group: 'Arrange', keys: ['Mod+Alt+[', '['], doc: (tx, p, env) => cmdOrder(tx, env, 'back') },
  { id: 'arrange.forward', label: 'Bring forward', group: 'Arrange', keys: ['Mod+]'], doc: (tx, p, env) => cmdOrder(tx, env, 'forward') },
  { id: 'arrange.backward', label: 'Send backward', group: 'Arrange', keys: ['Mod+['], doc: (tx, p, env) => cmdOrder(tx, env, 'backward') },
  {
    id: 'node.frameSelection', label: 'Frame selection', group: 'Arrange', keys: ['Mod+Alt+G', 'Mod+G'],
    description: 'Wrap the selected layers in a new frame.',
    params: { ids: ids$ },
    doc(tx, p, env) {
      const ids = topmost(tx.doc, sel(tx, p, env)).filter((id) => editable(tx, id));
      if (!ids.length) return false;
      const f = wrapInFrame(tx, ids);
      return { select: [f], value: f };
    },
  },
  {
    id: 'node.ungroup', label: 'Remove frame (keep contents)', group: 'Arrange', keys: ['Shift+Mod+G'],
    params: { ids: ids$ },
    doc(tx, p, env) {
      const ids = sel(tx, p, env).filter((id) => { const n = tx.get(id); return n.type === 'frame' && !n.src && !n.component; });
      if (!ids.length) return false;
      const out = [];
      for (const id of ids) {
        const f = tx.get(id);
        const list = tx.childIds(f.parent);
        let index = list.indexOf(id);
        for (const c of f.children.slice()) {
          const wc = centerWorld(tx, c);
          placeCentered(tx, c, f.parent, wc, index++);
          out.push(c);
        }
        tx.remove(id);
      }
      return { select: out };
    },
  },
  {
    id: 'layout.add', label: 'Add auto layout', group: 'Layout', keys: ['Shift+A'],
    description: 'Give a frame auto layout, or wrap the selected layers in a new auto-layout frame.',
    params: { ids: ids$, mode: { type: 'string', enum: ['row', 'column'] } },
    doc(tx, p, env) {
      let ids = topmost(tx.doc, sel(tx, p, env)).filter((id) => editable(tx, id));
      if (!ids.length) return false;
      const single = ids.length === 1 && tx.get(ids[0]).type === 'frame' && !hasLayout(tx.get(ids[0]));
      let fid;
      if (single) fid = ids[0];
      else {
        if (ids.length === 1 && tx.get(ids[0]).type === 'frame') return false;
        fid = wrapInFrame(tx, ids, { fill: '#FFFFFF' });
      }
      const f = tx.get(fid);
      const kids = f.children.map((c) => tx.get(c));
      let mode = p.mode;
      if (!mode) {
        const spanX = Math.max(0, ...kids.map((k) => k.x + k.w)) - Math.min(0, ...kids.map((k) => k.x));
        const spanY = Math.max(0, ...kids.map((k) => k.y + k.h)) - Math.min(0, ...kids.map((k) => k.y));
        mode = spanX >= spanY ? 'row' : 'column';
      }
      const order = kids.slice().sort((a, b) => (mode === 'row' ? a.x - b.x : a.y - b.y)).map((k) => k.id);
      tx.set(fid, { layout: { ...DEFAULT_LAYOUT, mode }, sizing: { h: 'hug', v: 'hug' }, children: order });
      return { select: [fid] };
    },
  },
  {
    id: 'layout.remove', label: 'Remove auto layout', group: 'Layout', keys: ['Alt+Shift+A'],
    params: { ids: ids$ },
    doc(tx, p, env) {
      const ids = sel(tx, p, env).filter((id) => hasLayout(tx.get(id)) && !tx.get(id).src);
      if (!ids.length) return false;
      for (const id of ids) writeProps(tx, id, tx.get(id).type === 'instance' ? { layout: null } : { layout: undefined, sizing: undefined });
    },
  },
  {
    id: 'layout.set', label: 'Set auto layout', group: 'Layout', hidden: true,
    description: 'Change auto layout settings: mode (row, column, none), wrap, gap, pad [top, right, bottom, left], align (start, center, end, stretch), justify (start, center, end, between).',
    params: { ids: ids$, layout: { type: 'object', required: true } },
    doc(tx, p, env) {
      const ids = sel(tx, p, env).filter((id) => isContainer(tx.get(id)));
      if (!ids.length) return false;
      for (const id of ids) {
        const n = tx.get(id);
        const L = { ...(n.layout || DEFAULT_LAYOUT), ...p.layout };
        if (n.src) continue;
        if (L.mode === 'none') { tx.set(id, { layout: undefined }); continue; }
        if (n.type === 'instance') writeProps(tx, id, { layout: L });
        else tx.set(id, { layout: L, sizing: n.sizing || { h: 'hug', v: 'hug' } });
      }
    },
  },
  {
    id: 'node.setSizing', label: 'Set resizing (hug, fill, fixed)', group: 'Layout', hidden: true,
    params: { ids: ids$, h: { type: 'string', enum: ['fixed', 'hug', 'fill'] }, v: { type: 'string', enum: ['fixed', 'hug', 'fill'] } },
    doc(tx, p, env) {
      const ids = sel(tx, p, env).filter((id) => !tx.get(id).src);
      if (!ids.length) return false;
      for (const id of ids) {
        const n = tx.get(id);
        const s = { ...(n.sizing || { h: 'fixed', v: 'fixed' }) };
        if (p.h) s.h = p.h;
        if (p.v) s.v = p.v;
        const patch = { sizing: s };
        if (n.type === 'text') patch.autoSize = s.h === 'hug' ? 'width' : s.v === 'hug' ? 'height' : 'fixed';
        tx.set(id, patch);
      }
    },
  },
  {
    id: 'node.setConstraints', label: 'Set constraints', group: 'Layout', hidden: true,
    params: { ids: ids$, h: { type: 'string', enum: ['left', 'right', 'leftright', 'center', 'scale'] }, v: { type: 'string', enum: ['top', 'bottom', 'topbottom', 'center', 'scale'] } },
    doc(tx, p, env) {
      const ids = sel(tx, p, env).filter((id) => !tx.get(id).src);
      if (!ids.length) return false;
      for (const id of ids) {
        const c = { h: 'left', v: 'top', ...(tx.get(id).constraints || {}) };
        if (p.h) c.h = p.h;
        if (p.v) c.v = p.v;
        tx.set(id, { constraints: c });
      }
    },
  },
  {
    id: 'text.set', label: 'Set text', group: 'Text', hidden: true,
    params: { id: { type: 'string', required: true }, text: { type: 'string', required: true } },
    doc(tx, p) {
      const n = tx.get(p.id);
      if (!n || n.type !== 'text') return false;
      const runs = n.runs ? shiftRuns(n.runs, String(n.text), p.text) : undefined;
      if (n.src) { writeOverride(tx, p.id, { text: p.text, ...(n.runs ? { runs } : {}) }); return; }
      if (!p.text.trim()) { tx.remove(p.id); return { select: [] }; }
      const named = n.name === String(n.text).slice(0, 40);
      tx.set(p.id, { text: p.text, ...(n.runs ? { runs: runs.length ? runs : undefined } : {}), ...(named ? { name: p.text.split('\n')[0].slice(0, 40) } : {}) });
    },
  },
  {
    id: 'text.styleRange', label: 'Style part of a text', group: 'Text', hidden: true,
    description: 'Style characters [start, end) of a text layer: fontWeight, fontSize, italic, fill (#hex), decoration (underline, strike); null removes a key.',
    params: { id: { type: 'string', required: true }, start: { type: 'number', required: true }, end: { type: 'number', required: true }, style: { type: 'object', required: true } },
    doc(tx, p) {
      const n = tx.get(p.id);
      if (!n || n.type !== 'text') return false;
      const len = String(n.text).length;
      const a = Math.max(0, Math.min(len, Math.floor(p.start))), b = Math.max(a, Math.min(len, Math.floor(p.end)));
      if (a === b) return false;
      const allowed = ['fontWeight', 'fontSize', 'italic', 'fill', 'decoration'];
      const patch = Object.fromEntries(Object.entries(p.style).filter(([k]) => allowed.includes(k)));
      if (patch.fill != null && !/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(patch.fill)) throw new Error('fill must be #RRGGBB');
      const runs = styleRange(n.runs, a, b, patch);
      if (n.src) writeOverride(tx, p.id, { runs }); else tx.set(p.id, { runs: runs.length ? runs : undefined });
    },
  },
  {
    id: 'doc.rename', label: 'Rename document', group: 'File', hidden: true,
    params: { name: { type: 'string', required: true } },
    doc(tx, p) { tx.doc.name = p.name.trim() || 'Untitled'; },
  },
);

function cmdOrder(tx, env, to) {
  const ids = topmost(tx.doc, env.selection || []).filter((id) => !tx.get(id).src);
  if (!ids.length) return false;
  for (const id of to === 'front' || to === 'backward' ? ids : ids.slice().reverse()) {
    const n = tx.get(id);
    const list = tx.childIds(n.parent);
    const i = list.indexOf(id);
    if (to === 'front') tx.place(id, n.parent, list.length);
    else if (to === 'back') tx.place(id, n.parent, 0);
    else if (to === 'forward') { if (i < list.length - 1) tx.place(id, n.parent, i + 1); }
    else if (i > 0) tx.place(id, n.parent, i - 1);
  }
}

// Components, variants and styles.
register(
  {
    id: 'component.create', label: 'Create component', group: 'Components', keys: ['Mod+Alt+K'],
    description: 'Turn the selected frame into a main component (wrapping other layers in a frame first).',
    params: { ids: ids$ },
    doc(tx, p, env) {
      const ids = topmost(tx.doc, sel(tx, p, env)).filter((id) => editable(tx, id) && !tx.get(id).component);
      if (!ids.length) return false;
      const out = [];
      if (ids.length === 1 && tx.get(ids[0]).type === 'frame' && !tx.get(ids[0]).variantSet) out.push(ids[0]);
      else if (ids.every((id) => tx.get(id).type === 'frame' && !tx.get(id).variantSet)) out.push(...ids);
      else out.push(wrapInFrame(tx, ids, { fill: '#FFFFFF' }));
      for (const id of out) {
        const anc = [tx.get(id).parent];
        if (anc[0] && descendants(tx.doc, id).some((d) => tx.get(d).component)) { /* nested mains allowed */ }
        tx.set(id, { component: true, fill: tx.get(id).fill });
      }
      return { select: out };
    },
  },
  {
    id: 'component.instance', label: 'Create instance', group: 'Components', keys: ['Mod+Alt+I'],
    description: 'Place an instance of a main component (the selected one by default) beside it, or at (x, y) in a parent.',
    params: { mainId: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, parent: { type: 'string', nullable: true }, id: { type: 'string' } },
    doc(tx, p, env) {
      let mainId = p.mainId;
      if (!mainId) {
        const s = (env.selection || []).map((id) => tx.get(id)).find((n) => n && (n.component || (n.type === 'instance' && !n.src)));
        mainId = s && (s.component ? s.id : s.mainId);
      }
      const main = mainId && tx.get(mainId);
      if (!main || !main.component) throw new Error('Select a main component first');
      const parent = p.parent && validTarget(tx, '', p.parent) ? p.parent : null;
      let x = p.x, y = p.y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        const b = worldBox(tx.doc, mainId);
        const set = variantSetOf(tx.doc, mainId);
        const sb = set ? worldBox(tx.doc, set.id) : b;
        x = sb.x + sb.w + 40; y = b.y;
      }
      const inst = makeNode('instance', { ...(p.id ? { id: p.id } : {}), mainId, name: main.name, x: round2(x), y: round2(y), w: main.w, h: main.h, overrides: {} });
      tx.add(inst, parent);
      return { select: [inst.id], value: inst.id };
    },
  },
  {
    id: 'component.detach', label: 'Detach instance', group: 'Components', keys: ['Mod+Alt+B'],
    params: { ids: ids$ },
    doc(tx, p, env) {
      const ids = sel(tx, p, env).filter((id) => tx.get(id).type === 'instance' && !tx.get(id).src);
      if (!ids.length) return false;
      for (const id of ids) {
        for (const d of descendants(tx.doc, id)) {
          const n = tx.get(d);
          if (n.root === id || (n.src && !tx.get(n.root)?.src)) tx.set(d, { src: undefined, root: undefined });
        }
        tx.set(id, { type: 'frame', mainId: undefined, overrides: undefined });
      }
    },
  },
  {
    id: 'component.combineVariants', label: 'Combine as variants', group: 'Components',
    description: 'Put the selected main components into one component set; names like "Size=Large, State=Hover" become variant properties.',
    params: { ids: ids$ },
    doc(tx, p, env) {
      const ids = topmost(tx.doc, sel(tx, p, env)).filter((id) => tx.get(id).component && !variantSetOf(tx.doc, id));
      if (ids.length < 2) throw new Error('Select two or more main components');
      const names = ids.map((id) => tx.get(id).name);
      const set = wrapInFrame(tx, ids, {
        name: names[0].split(/[=,/]/)[0].trim() || 'Component set', variantSet: true, fill: null,
        stroke: '#9747FF', strokeWidth: 1, dashed: true, radius: 5,
        layout: { mode: 'row', wrap: false, gap: 20, pad: [20, 20, 20, 20], align: 'start', justify: 'start' },
        sizing: { h: 'hug', v: 'hug' },
      });
      ids.forEach((id, i) => {
        const v = parseVariantName(tx.get(id).name) || { 'Property 1': i === 0 ? 'Default' : `Variant${i + 1}` };
        tx.set(id, { variant: v, name: Object.entries(v).map(([k, val]) => `${k}=${val}`).join(', ') });
      });
      return { select: [set], value: set };
    },
  },
  {
    id: 'instance.setVariant', label: 'Set variant property', group: 'Components', hidden: true,
    params: { id: { type: 'string', required: true }, prop: { type: 'string', required: true }, value: { type: 'string', required: true } },
    doc(tx, p) {
      const inst = tx.get(p.id);
      if (!inst || inst.type !== 'instance') return false;
      const set = variantSetOf(tx.doc, inst.mainId);
      if (!set) throw new Error('This instance has no variants');
      const want = { ...(tx.get(inst.mainId).variant || {}), [p.prop]: p.value };
      const target = findVariant(tx.doc, set, want);
      if (!target || target === inst.mainId) return false;
      swap(tx, p.id, target);
    },
  },
  {
    id: 'instance.swap', label: 'Swap instance', group: 'Components', hidden: true,
    params: { id: { type: 'string', required: true }, mainId: { type: 'string', required: true } },
    doc(tx, p) {
      const inst = tx.get(p.id), main = tx.get(p.mainId);
      if (!inst || inst.type !== 'instance' || !main || !main.component) throw new Error('Swap needs an instance and a main component');
      swap(tx, p.id, p.mainId);
    },
  },
  {
    id: 'instance.reset', label: 'Reset all overrides', group: 'Components',
    params: { ids: ids$ },
    doc(tx, p, env) {
      const ids = sel(tx, p, env).filter((id) => tx.get(id).type === 'instance' && !tx.get(id).src);
      if (!ids.length) return false;
      for (const id of ids) tx.set(id, { overrides: {} });
    },
  },
  {
    id: 'style.create', label: 'Create style', group: 'Styles', hidden: true,
    description: 'Create a shared style: {type:"color", name, value:"#RRGGBB"} or {type:"text", name, fontSize, fontFamily, fontWeight, lineHeight}.',
    params: { type: { type: 'string', required: true, enum: ['color', 'text', 'effect'] }, name: { type: 'string', required: true }, value: { type: 'any' }, fontSize: { type: 'number' }, fontFamily: { type: 'string' }, fontWeight: { type: 'number' }, lineHeight: { type: 'number' }, effects: { type: 'array' }, id: { type: 'string' } },
    doc(tx, p) {
      const id = p.id || 's' + uid();
      if (p.type === 'color') tx.setStyle(id, { type: 'color', name: p.name, value: p.value || '#000000' });
      else if (p.type === 'effect') tx.setStyle(id, { type: 'effect', name: p.name, effects: p.effects || [{ type: 'drop', x: 0, y: 4, blur: 8, spread: 0, color: '#00000040' }] });
      else tx.setStyle(id, { type: 'text', name: p.name, fontSize: p.fontSize || 16, fontFamily: p.fontFamily || 'Inter', fontWeight: p.fontWeight || 400, lineHeight: p.lineHeight || 1.25 });
      return { value: id };
    },
  },
  {
    id: 'style.fromSelection', label: 'Create style from selection', group: 'Styles',
    description: 'Make a shared style from the first selected layer\'s fill, stroke or text properties and apply it to the selection.',
    params: { kind: { type: 'string', enum: ['fill', 'stroke', 'text', 'effect'] }, name: { type: 'string' } },
    doc(tx, p, env) {
      const ids = sel(tx, {}, env);
      const n = ids.length && tx.get(ids[0]);
      if (!n) return false;
      const kind = p.kind || (n.type === 'text' ? 'text' : 'fill');
      const id = 's' + uid();
      const count = Object.values(tx.doc.styles).filter((s) => s.type === (kind === 'text' ? 'text' : kind === 'effect' ? 'effect' : 'color')).length + 1;
      if (kind === 'effect') {
        if (!n.effects || !n.effects.length) return false;
        tx.setStyle(id, { type: 'effect', name: p.name || `Effect ${count}`, effects: n.effects });
      } else if (kind === 'text') {
        if (n.type !== 'text') return false;
        const st = { type: 'text', name: p.name || `Text ${count}` };
        for (const k of TEXT_KEYS) st[k] = n[k];
        tx.setStyle(id, st);
      } else {
        const value = n[kind];
        if (!value) return false;
        tx.setStyle(id, { type: 'color', name: p.name || `Color ${count}`, value });
      }
      const key = { fill: 'fillStyle', stroke: 'strokeStyle', text: 'textStyle', effect: 'effectStyle' }[kind];
      for (const sid of ids) if (kind !== 'text' || tx.get(sid).type === 'text') writeProps(tx, sid, { [key]: id });
      return { value: id };
    },
  },
  {
    id: 'style.update', label: 'Edit style', group: 'Styles', hidden: true,
    params: { id: { type: 'string', required: true }, patch: { type: 'object', required: true } },
    doc(tx, p) {
      const s = tx.doc.styles[p.id];
      if (!s) throw new Error(`No style ${p.id}`);
      const patch = { ...p.patch };
      delete patch.type;
      tx.setStyle(p.id, { ...s, ...patch });
    },
  },
  {
    id: 'style.delete', label: 'Delete style', group: 'Styles', hidden: true, scope: 'destructive',
    description: 'Delete a shared style; layers that used it keep its current values.',
    params: { id: { type: 'string', required: true } },
    doc(tx, p) {
      const s = tx.doc.styles[p.id];
      if (!s) return false;
      for (const [id, n] of Object.entries(tx.doc.nodes)) {
        if (n.src) continue;
        const patch = {};
        if (n.fillStyle === p.id) { patch.fillStyle = undefined; patch.fill = s.value; }
        if (n.strokeStyle === p.id) { patch.strokeStyle = undefined; patch.stroke = s.value; }
        if (n.textStyle === p.id) { patch.textStyle = undefined; for (const k of TEXT_KEYS) patch[k] = s[k]; }
        if (n.effectStyle === p.id) { patch.effectStyle = undefined; patch.effects = s.effects; }
        if (Object.keys(patch).length) tx.set(id, patch);
      }
      tx.setStyle(p.id, undefined);
    },
  },
  {
    id: 'node.applyStyle', label: 'Apply style', group: 'Styles', hidden: true,
    description: 'Apply a shared style to layers (kind fill, stroke or text), or detach it with styleId null (the layer keeps the values).',
    params: { ids: ids$, kind: { type: 'string', required: true, enum: ['fill', 'stroke', 'text', 'effect'] }, styleId: { type: 'string', nullable: true, required: true } },
    doc(tx, p, env) {
      const ids = sel(tx, p, env);
      if (!ids.length) return false;
      const key = { fill: 'fillStyle', stroke: 'strokeStyle', text: 'textStyle', effect: 'effectStyle' }[p.kind];
      const old = (id) => tx.doc.styles[tx.get(id)[key]];
      for (const id of ids) {
        const n = tx.get(id);
        if (p.kind === 'text' && n.type !== 'text') continue;
        let patch = { [key]: p.styleId || null };
        if (!p.styleId && old(id)) {
          const s = old(id);
          if (p.kind === 'text') for (const k of TEXT_KEYS) patch[k] = s[k];
          else if (p.kind === 'effect') patch.effects = s.effects;
          else patch[p.kind] = s.value;
        }
        writeProps(tx, id, patch);
      }
    },
  },
);

function swap(tx, instId, mainId) {
  const inst = tx.get(instId);
  const main = tx.get(mainId);
  const overrides = remapOverrides(tx.doc, inst.overrides, inst.mainId, mainId);
  tx.set(instId, { mainId, overrides, w: main.w, h: main.h, name: main.name });
}

export { wrapInFrame };
