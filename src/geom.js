// 2D affine matrices as [a, b, c, d, e, f] (same order as CanvasRenderingContext2D.transform).
export const rad = (d) => (d * Math.PI) / 180;
export const deg = (r) => (r * 180) / Math.PI;
export const IDENT = Object.freeze([1, 0, 0, 1, 0, 0]);

export function mul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function inv(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return [1, 0, 0, 1, -m[4], -m[5]];
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

export const apply = (m, p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
export const applyVec = (m, p) => ({ x: m[0] * p.x + m[2] * p.y, y: m[1] * p.x + m[3] * p.y });

// Node-local matrix: translate to (x, y), rotate about the node's centre.
export function localMatrix(n) {
  const r = rad(n.rotation || 0);
  if (!r) return [1, 0, 0, 1, n.x, n.y];
  const c = Math.cos(r), s = Math.sin(r), cx = n.w / 2, cy = n.h / 2;
  return [c, s, -s, c, n.x + cx - c * cx + s * cy, n.y + cy - s * cx - c * cy];
}

export function worldMatrix(doc, id) {
  let m = IDENT;
  const chain = [];
  for (let n = doc.nodes[id]; n; n = n.parent ? doc.nodes[n.parent] : null) chain.push(n);
  for (let i = chain.length - 1; i >= 0; i--) m = mul(m, localMatrix(chain[i]));
  return m;
}

export function parentMatrix(doc, id) {
  const n = doc.nodes[id];
  return n && n.parent ? worldMatrix(doc, n.parent) : IDENT;
}

export function boxOfPoints(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function corners(n) {
  return [{ x: 0, y: 0 }, { x: n.w, y: 0 }, { x: n.w, y: n.h }, { x: 0, y: n.h }];
}

export function worldBox(doc, id) {
  const n = doc.nodes[id];
  const m = worldMatrix(doc, id);
  return boxOfPoints(corners(n).map((p) => apply(m, p)));
}

export function unionBoxes(boxes) {
  if (!boxes.length) return null;
  const pts = [];
  for (const b of boxes) pts.push({ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h });
  return boxOfPoints(pts);
}

export const intersects = (a, b) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
export const contains = (a, b) => b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;
export const round2 = (v) => Math.round(v * 100) / 100;
