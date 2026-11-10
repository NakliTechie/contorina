// Vector geometry. Paths are SVG path strings; internally every path is parsed to subpaths of absolute
// M / L / C / Z segments, which is enough for drawing, editing, flattening and booleans. Pure (no DOM).
import { localMatrix } from './geom.js';

const K = 0.5522847498; // cubic Bezier approximation of a quarter circle

// ---- shapes as unit-box path data --------------------------------------------------------------------
export function polygonD(sides) {
  const n = Math.max(3, Math.round(sides || 3));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    pts.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]);
  }
  return 'M' + pts.map((p) => p.map(r6).join(' ')).join(' L') + ' Z';
}
export function starD(points, inner) {
  const n = Math.max(3, Math.round(points || 5));
  const k = Math.min(1, Math.max(0.01, inner ?? 0.38));
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 ? 0.5 * k : 0.5;
    pts.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]);
  }
  return 'M' + pts.map((p) => p.map(r6).join(' ')).join(' L') + ' Z';
}
export function shapeD(n) {
  if (n.type === 'polygon') return polygonD(n.sides);
  if (n.type === 'boolean') return n.d || '';
  if (n.type === 'star') return starD(n.points, n.inner);
  return n.d || '';
}
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const r3 = (v) => Math.round(v * 1000) / 1000;

// The outline of any layer as path data in its own local units (for flatten and booleans).
export function outlineD(n) {
  const w = n.w, h = n.h;
  switch (n.type) {
    case 'ellipse': {
      const rx = w / 2, ry = h / 2, cx = rx, cy = ry;
      return `M${cx + rx} ${cy} C${cx + rx} ${cy + ry * K} ${cx + rx * K} ${cy + ry} ${cx} ${cy + ry} C${cx - rx * K} ${cy + ry} ${cx - rx} ${cy + ry * K} ${cx - rx} ${cy} C${cx - rx} ${cy - ry * K} ${cx - rx * K} ${cy - ry} ${cx} ${cy - ry} C${cx + rx * K} ${cy - ry} ${cx + rx} ${cy - ry * K} ${cx + rx} ${cy} Z`;
    }
    case 'line': return `M0 0 L${w} 0`;
    case 'vector': case 'boolean': return scaleD(n.d || '', w / (n.vw || w || 1), h / (n.vh || h || 1));
    case 'polygon': case 'star': return scaleD(shapeD(n), w, h);
    case 'text': return `M0 0 L${w} 0 L${w} ${h} L0 ${h} Z`;
    default: {
      const R = Array.isArray(n.radius) ? n.radius : [n.radius || 0, n.radius || 0, n.radius || 0, n.radius || 0];
      const [a, b, c, d] = R.map((r) => Math.max(0, Math.min(r || 0, w / 2, h / 2)));
      if (!(a || b || c || d)) return `M0 0 L${w} 0 L${w} ${h} L0 ${h} Z`;
      return `M${a} 0 L${w - b} 0 C${w - b + b * K} 0 ${w} ${b - b * K} ${w} ${b} L${w} ${h - c} C${w} ${h - c + c * K} ${w - c + c * K} ${h} ${w - c} ${h} L${d} ${h} C${d - d * K} ${h} 0 ${h - d + d * K} 0 ${h - d} L0 ${a} C0 ${a - a * K} ${a - a * K} 0 ${a} 0 Z`;
    }
  }
}

// ---- parsing -----------------------------------------------------------------------------------------
// Returns [{ closed, segs: [{ c: 'M'|'L'|'C', pts: [[x,y],...] }] }]; C has three points (c1, c2, end).
export function parsePath(d) {
  const toks = String(d).match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/g) || [];
  const subs = [];
  let i = 0, cmd = null, cx = 0, cy = 0, sx = 0, sy = 0, lastC = null, lastQ = null, cur = null;
  const num = () => parseFloat(toks[i++]);
  const isNum = () => i < toks.length && !/[A-Za-z]/.test(toks[i]);
  const start = (x, y) => { cur = { closed: false, segs: [{ c: 'M', pts: [[x, y]] }] }; subs.push(cur); sx = x; sy = y; };
  const line = (x, y) => { if (!cur) start(cx, cy); cur.segs.push({ c: 'L', pts: [[x, y]] }); };
  const cubic = (a, b, c, e, f, g) => { if (!cur) start(cx, cy); cur.segs.push({ c: 'C', pts: [[a, b], [c, e], [f, g]] }); };
  while (i < toks.length) {
    const at = i;
    if (!isNum()) cmd = toks[i++];
    else if (!cmd || cmd === 'Z' || cmd === 'z') { i++; continue; } // numbers with no command (or after Z) are skipped
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? cx : 0, oy = rel ? cy : 0;
    switch (cmd.toUpperCase()) {
      case 'M': { const x = num() + ox, y = num() + oy; start(x, y); cx = x; cy = y; cmd = rel ? 'l' : 'L'; lastC = lastQ = null; break; }
      case 'L': { const x = num() + ox, y = num() + oy; line(x, y); cx = x; cy = y; lastC = lastQ = null; break; }
      case 'H': { const x = num() + ox; line(x, cy); cx = x; lastC = lastQ = null; break; }
      case 'V': { const y = num() + oy; line(cx, y); cy = y; lastC = lastQ = null; break; }
      case 'C': { const a = num() + ox, b = num() + oy, c = num() + ox, e = num() + oy, f = num() + ox, g = num() + oy; cubic(a, b, c, e, f, g); lastC = [c, e]; lastQ = null; cx = f; cy = g; break; }
      case 'S': { const r = lastC ? [2 * cx - lastC[0], 2 * cy - lastC[1]] : [cx, cy]; const c = num() + ox, e = num() + oy, f = num() + ox, g = num() + oy; cubic(r[0], r[1], c, e, f, g); lastC = [c, e]; lastQ = null; cx = f; cy = g; break; }
      case 'Q': { const qx = num() + ox, qy = num() + oy, x = num() + ox, y = num() + oy; cubic(cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y); lastQ = [qx, qy]; lastC = null; cx = x; cy = y; break; }
      case 'T': { const q = lastQ ? [2 * cx - lastQ[0], 2 * cy - lastQ[1]] : [cx, cy]; const x = num() + ox, y = num() + oy; cubic(cx + (2 / 3) * (q[0] - cx), cy + (2 / 3) * (q[1] - cy), x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y), x, y); lastQ = q; lastC = null; cx = x; cy = y; break; }
      case 'A': {
        const rx = num(), ry = num(), rot = num(), large = num(), sweep = num(), x = num() + ox, y = num() + oy;
        for (const c of arcToCubics(cx, cy, rx, ry, rot, large, sweep, x, y)) cubic(...c);
        cx = x; cy = y; lastC = lastQ = null; break;
      }
      case 'Z': { if (cur) cur.closed = true; cx = sx; cy = sy; cur = null; lastC = lastQ = null; break; }
      default: i++;
    }
    if (i === at) i++; // every pass consumes at least one token
  }
  return subs;
}

function arcToCubics(x1, y1, rx, ry, phiDeg, fa, fs, x2, y2) {
  if (!rx || !ry) return [[x1, y1, x2, y2, x2, y2]];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  let lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const sign = fa === fs ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  let t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI;
  if (fs && dt < 0) dt += 2 * Math.PI;
  const segs = Math.ceil(Math.abs(dt) / (Math.PI / 2));
  const out = [];
  const step = dt / segs, k = (4 / 3) * Math.tan(step / 4);
  const pt = (t) => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const der = (t) => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  for (let s = 0; s < segs; s++) {
    const a = t1 + s * step, b = a + step;
    const p0 = pt(a), p3 = pt(b), d0 = der(a), d3 = der(b);
    out.push([p0[0] + k * d0[0], p0[1] + k * d0[1], p3[0] - k * d3[0], p3[1] - k * d3[1], p3[0], p3[1]]);
  }
  return out;
}

export function serialize(subs) {
  return subs.map((s) => s.segs.map((g) => g.c + g.pts.map((p) => `${r3(p[0])} ${r3(p[1])}`).join(' ')).join(' ') + (s.closed ? ' Z' : '')).join(' ');
}
export function mapPoints(subs, f) {
  return subs.map((s) => ({ closed: s.closed, segs: s.segs.map((g) => ({ c: g.c, pts: g.pts.map(f) })) }));
}
export const scaleD = (d, sx, sy) => serialize(mapPoints(parsePath(d), ([x, y]) => [x * sx, y * sy]));
export const transformD = (d, m) => serialize(mapPoints(parsePath(d), ([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]));

// Polylines approximating each subpath (closed rings repeat no end point).
export function flatten(subs, tol = 0.25) {
  const out = [];
  for (const s of subs) {
    const pts = [];
    let p = [0, 0];
    for (const g of s.segs) {
      if (g.c === 'M') { p = g.pts[0]; pts.push(p); }
      else if (g.c === 'L') { p = g.pts[0]; pts.push(p); }
      else {
        const [c1, c2, e] = g.pts;
        const len = Math.hypot(c1[0] - p[0], c1[1] - p[1]) + Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) + Math.hypot(e[0] - c2[0], e[1] - c2[1]);
        const n = Math.max(2, Math.min(64, Math.ceil(Math.sqrt(len / tol))));
        for (let i = 1; i <= n; i++) {
          const t = i / n, u = 1 - t;
          pts.push([u * u * u * p[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * e[0], u * u * u * p[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * e[1]]);
        }
        p = e;
      }
    }
    if (pts.length > 1 && s.closed) {
      const a = pts[0], b = pts[pts.length - 1];
      if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) pts.pop();
    }
    out.push({ closed: s.closed, pts });
  }
  return out;
}
export function boundsOf(subs) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of flatten(subs, 0.5)) for (const [x, y] of r.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return x0 === Infinity ? { x: 0, y: 0, w: 0, h: 0 } : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Path data in some coordinate frame -> a vector layer's fields: origin, size, and d relative to it.
export function fitVector(d) {
  const subs = parsePath(d);
  const b = boundsOf(subs);
  const w = Math.max(b.w, 0.01), h = Math.max(b.h, 0.01);
  const dd = serialize(mapPoints(subs, ([x, y]) => [x - b.x, y - b.y]));
  return { x: r3(b.x), y: r3(b.y), w: r3(w), h: r3(h), vw: r3(w), vh: r3(h), d: dd };
}

// A layer's outline in its parent's coordinates (applies its own rotation).
export function outlineInParent(n) {
  return transformD(outlineD(n), localMatrix(n));
}

// ---- anchors (path editing) ----------------------------------------------------------------------------
// [{ closed, nodes: [{ x, y, in: [x,y]|null, out: [x,y]|null }] }]
export function toAnchors(subs) {
  return subs.map((s) => {
    const nodes = [];
    for (const g of s.segs) {
      if (g.c === 'M' || g.c === 'L') nodes.push({ x: g.pts[0][0], y: g.pts[0][1], in: null, out: null });
      else {
        const prev = nodes[nodes.length - 1];
        if (prev) prev.out = g.pts[0];
        nodes.push({ x: g.pts[2][0], y: g.pts[2][1], in: g.pts[1], out: null });
      }
    }
    // A handle sitting on its own anchor is no handle (the pen writes those for corner points).
    for (const a of nodes) {
      if (a.in && Math.abs(a.in[0] - a.x) < 1e-6 && Math.abs(a.in[1] - a.y) < 1e-6) a.in = null;
      if (a.out && Math.abs(a.out[0] - a.x) < 1e-6 && Math.abs(a.out[1] - a.y) < 1e-6) a.out = null;
    }
    // A closed path whose last point repeats the first folds into it.
    if (s.closed && nodes.length > 1) {
      const a = nodes[0], b = nodes[nodes.length - 1];
      if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) { a.in = b.in; nodes.pop(); }
    }
    return { closed: s.closed, nodes };
  });
}
export function fromAnchors(paths) {
  const subs = [];
  for (const p of paths) {
    if (!p.nodes.length) continue;
    const segs = [{ c: 'M', pts: [[p.nodes[0].x, p.nodes[0].y]] }];
    const seg = (a, b) => (a.out || b.in
      ? { c: 'C', pts: [a.out || [a.x, a.y], b.in || [b.x, b.y], [b.x, b.y]] }
      : { c: 'L', pts: [[b.x, b.y]] });
    for (let i = 1; i < p.nodes.length; i++) segs.push(seg(p.nodes[i - 1], p.nodes[i]));
    if (p.closed && p.nodes.length > 2 && (p.nodes[p.nodes.length - 1].out || p.nodes[0].in)) segs.push(seg(p.nodes[p.nodes.length - 1], p.nodes[0]));
    subs.push({ closed: p.closed, segs });
  }
  return serialize(subs);
}

// Ramer-Douglas-Peucker, for the pencil tool.
export function simplify(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let max = 0, idx = 0;
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-9;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / L;
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [a, b];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}
