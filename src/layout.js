// Auto layout and constraints. `arrange` is a pure function of a frame and its children's sizes;
// `layoutNode` applies it through a Tx, children first so hug sizes are known.
import { hasLayout } from './doc.js';

export const DEFAULT_LAYOUT = { mode: 'row', wrap: false, gap: 10, pad: [10, 10, 10, 10], align: 'start', justify: 'start' };

function padOf(l) {
  const p = l.pad || [0, 0, 0, 0];
  return { t: p[0] || 0, r: p[1] || 0, b: p[2] || 0, l: p[3] || 0 };
}

// frame: {w, h, layout, sizing}; kids: [{id, w, h, sizing}] (visible, in flow).
// Returns {w, h, kids: [{id, x, y, w, h}]}.
export function arrange(frame, kids) {
  const L = frame.layout;
  const row = L.mode === 'row';
  const P = padOf(L);
  const gap = L.gap || 0;
  const sz = frame.sizing || {};
  const hugMain = (row ? sz.h : sz.v) === 'hug';
  const hugCross = (row ? sz.v : sz.h) === 'hug';
  const M = row ? 'w' : 'h', C = row ? 'h' : 'w';
  const kidMainSizing = (k) => (k.sizing || {})[row ? 'h' : 'v'] || 'fixed';
  const kidCrossSizing = (k) => (k.sizing || {})[row ? 'v' : 'h'] || 'fixed';
  const padMain = row ? P.l + P.r : P.t + P.b;
  const padCross = row ? P.t + P.b : P.l + P.r;
  const out = kids.map((k) => ({ id: k.id, w: k.w, h: k.h, x: 0, y: 0, sm: kidMainSizing(k), sc: kidCrossSizing(k) }));

  if (L.wrap && row && !hugMain) {
    const avail = frame.w - padMain;
    const lines = [];
    let line = [], used = 0;
    for (const k of out) {
      const add = (line.length ? gap : 0) + k.w;
      if (line.length && used + add > avail) { lines.push(line); line = []; used = 0; }
      used += (line.length ? gap : 0) + k.w;
      line.push(k);
    }
    if (line.length) lines.push(line);
    const crossGap = L.crossGap ?? gap;
    let y = P.t;
    for (const ln of lines) {
      const lh = Math.max(...ln.map((k) => k.h));
      let x = P.l;
      const total = ln.reduce((s, k) => s + k.w, 0) + gap * (ln.length - 1);
      if (L.justify === 'center') x += (avail - total) / 2;
      else if (L.justify === 'end') x += avail - total;
      for (const k of ln) {
        k.x = x;
        k.y = y + (L.align === 'center' ? (lh - k.h) / 2 : L.align === 'end' ? lh - k.h : 0);
        x += k.w + gap;
      }
      y += lh + crossGap;
    }
    const contentH = lines.length ? y - crossGap - P.t : 0;
    const h = hugCross ? contentH + P.t + P.b : frame.h;
    return { w: frame.w, h, kids: out.map(strip) };
  }

  // Cross size first (hug takes the largest non-fill child).
  let cross = frame[C];
  if (hugCross) cross = Math.max(0, ...out.filter((k) => k.sc !== 'fill').map((k) => k[C])) + padCross;
  const innerCross = cross - padCross;
  for (const k of out) if (k.sc === 'fill' || L.align === 'stretch') k[C] = Math.max(0, innerCross);

  // Main size: fill children share what fixed children leave (fill acts as fixed in a hug parent).
  const gaps = gap * Math.max(0, out.length - 1);
  let main = frame[M];
  const fills = hugMain ? [] : out.filter((k) => k.sm === 'fill');
  const fixedSum = out.filter((k) => !fills.includes(k)).reduce((s, k) => s + k[M], 0);
  if (hugMain) main = fixedSum + gaps + padMain;
  const innerMain = main - padMain;
  if (fills.length) {
    const each = Math.max(0, (innerMain - fixedSum - gaps) / fills.length);
    for (const k of fills) k[M] = each;
  }
  const total = out.reduce((s, k) => s + k[M], 0);
  let cursor = row ? P.l : P.t;
  let step = gap;
  const free = innerMain - total - gaps;
  if (!fills.length) {
    if (L.justify === 'center') cursor += free / 2;
    else if (L.justify === 'end') cursor += free;
    else if (L.justify === 'between' && out.length > 1) step = (innerMain - total) / (out.length - 1);
  }
  const crossStart = row ? P.t : P.l;
  for (const k of out) {
    const off = L.align === 'center' ? (innerCross - k[C]) / 2 : L.align === 'end' ? innerCross - k[C] : 0;
    if (row) { k.x = cursor; k.y = crossStart + off; } else { k.y = cursor; k.x = crossStart + off; }
    cursor += k[M] + step;
  }
  return { w: row ? main : cross, h: row ? cross : main, kids: out.map(strip) };
}
const strip = (k) => ({ id: k.id, x: round(k.x), y: round(k.y), w: round(k.w), h: round(k.h) });
const round = (v) => Math.round(v * 1000) / 1000;

export function layoutNode(tx, id) {
  const n = tx.get(id);
  if (!n || !n.children) return;
  for (const c of n.children) layoutNode(tx, c);
  if (!hasLayout(n)) return;
  const kids = n.children.map((c) => tx.get(c)).filter((k) => k && k.visible !== false && !k.absolute);
  const res = arrange(tx.get(id), kids);
  const cur = tx.get(id);
  if (res.w !== cur.w || res.h !== cur.h) tx.set(id, { w: res.w, h: res.h });
  for (const r of res.kids) {
    const k = tx.get(r.id);
    if (k.x === r.x && k.y === r.y && k.w === r.w && k.h === r.h) continue;
    const oldW = k.w, oldH = k.h;
    tx.set(r.id, { x: r.x, y: r.y, w: r.w, h: r.h });
    if ((oldW !== r.w || oldH !== r.h) && k.children) {
      if (hasLayout(k)) layoutNode(tx, r.id);
      else applyConstraints(tx, r.id, oldW, oldH);
    }
  }
}

export function layoutAll(tx) {
  for (const id of tx.doc.children) layoutNode(tx, id);
}

// After frame `id` changed size from (oldW, oldH) to its current size, move and size its
// children by their constraints. Auto-layout frames ignore constraints (layout owns positions).
export function applyConstraints(tx, id, oldW, oldH) {
  const f = tx.get(id);
  if (!f.children || hasLayout(f) || (oldW === f.w && oldH === f.h)) return;
  const dw = f.w - oldW, dh = f.h - oldH;
  const sx = oldW ? f.w / oldW : 1, sy = oldH ? f.h / oldH : 1;
  for (const cid of f.children) {
    const c = tx.get(cid);
    const con = c.constraints || {};
    const p = { x: c.x, y: c.y, w: c.w, h: c.h };
    switch (con.h || 'left') {
      case 'right': p.x += dw; break;
      case 'leftright': p.w = Math.max(0, p.w + dw); break;
      case 'center': p.x += dw / 2; break;
      case 'scale': p.x *= sx; p.w *= sx; break;
    }
    switch (con.v || 'top') {
      case 'bottom': p.y += dh; break;
      case 'topbottom': p.h = Math.max(0, p.h + dh); break;
      case 'center': p.y += dh / 2; break;
      case 'scale': p.y *= sy; p.h *= sy; break;
    }
    for (const k in p) p[k] = round(p[k]);
    if (p.x === c.x && p.y === c.y && p.w === c.w && p.h === c.h) continue;
    tx.set(cid, p);
    if (c.children && (p.w !== c.w || p.h !== c.h)) {
      if (hasLayout(c)) layoutNode(tx, cid);
      else applyConstraints(tx, cid, c.w, c.h);
    }
  }
}

// Set geometry on a node and keep the rest of the tree consistent.
export function setGeometry(tx, id, g) {
  const n = tx.get(id);
  const patch = {};
  for (const k of ['x', 'y', 'w', 'h', 'rotation']) if (g[k] != null && Number.isFinite(g[k])) patch[k] = k === 'w' || k === 'h' ? Math.max(n.type === 'line' && k === 'h' ? 0 : 1, g[k]) : g[k];
  if (n.type === 'line') patch.h = 0;
  const oldW = n.w, oldH = n.h;
  const parent = n.parent && tx.get(n.parent);
  // A child of an auto-layout frame that gets an explicit size stops hugging or filling on that axis.
  if (parent && hasLayout(parent) && (patch.w != null || patch.h != null)) {
    const s = { ...(n.sizing || {}) };
    if (patch.w != null && patch.w !== oldW) s.h = 'fixed';
    if (patch.h != null && patch.h !== oldH) s.v = 'fixed';
    patch.sizing = s;
  } else if (hasLayout(n) && (patch.w != null || patch.h != null)) {
    const s = { ...(n.sizing || {}) };
    if (patch.w != null && patch.w !== oldW) s.h = 'fixed';
    if (patch.h != null && patch.h !== oldH) s.v = 'fixed';
    patch.sizing = s;
  }
  if (n.type === 'text' && (patch.w != null && patch.w !== oldW)) patch.autoSize = patch.h != null && patch.h !== oldH ? 'fixed' : 'height';
  tx.set(id, patch);
  if (n.children && !hasLayout(n) && n.type !== 'instance') applyConstraints(tx, id, oldW, oldH);
}
