// Hit testing and the selection rule.
import { localMatrix, mul, inv, apply, IDENT, worldBox, intersects } from './geom.js';
import { pathOf } from './render.js';

let hitCtx;
function ctx2d() {
  if (hitCtx === undefined) { try { hitCtx = new OffscreenCanvas(1, 1).getContext('2d'); } catch { hitCtx = null; } }
  return hitCtx;
}

// Returns the chain of ids from a top-level node down to the front-most hit leaf, or [].
export function hitChain(doc, p, tol = 3, exclude = null) {
  for (let i = doc.children.length - 1; i >= 0; i--) {
    const c = hitNode(doc, doc.children[i], p, IDENT, tol, exclude);
    if (c) return c;
  }
  return [];
}

function hitNode(doc, id, p, parentM, tol, exclude) {
  const n = doc.nodes[id];
  if (!n || n.visible === false || (exclude && exclude.has(id))) return null;
  const m = mul(parentM, localMatrix(n));
  const q = apply(inv(m), p);
  const inside = q.x >= -tol && q.y >= -tol && q.x <= n.w + tol && q.y <= n.h + tol;
  if (n.children && n.children.length && (inside || n.clip === false)) {
    for (let i = n.children.length - 1; i >= 0; i--) {
      const c = hitNode(doc, n.children[i], p, m, tol, exclude);
      if (c) return n.locked ? null : [id, ...c];
    }
  }
  if (n.locked) return null;
  if (n.type === 'line') return Math.abs(q.y) <= tol + (n.strokeWidth || 0) / 2 && q.x >= -tol && q.x <= n.w + tol ? [id] : null;
  if (n.type === 'vector' || n.type === 'boolean' || n.type === 'polygon' || n.type === 'star') {
    const c = ctx2d();
    if (!c || !inside) return inside && !c ? [id] : null;
    const path = pathOf(n);
    if (n.fill && c.isPointInPath(path, q.x, q.y, n.fillRule === 'evenodd' ? 'evenodd' : 'nonzero')) return [id];
    c.lineWidth = Math.max(n.strokeWidth || 0, tol * 2);
    return c.isPointInStroke(path, q.x, q.y) ? [id] : null;
  }
  if (n.type === 'ellipse') {
    const rx = n.w / 2 + tol, ry = n.h / 2 + tol, dx = q.x - n.w / 2, dy = q.y - n.h / 2;
    return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1 ? [id] : null;
  }
  return inside ? [id] : null;
}

// Which node in the chain a click selects (Figma-like):
//  - deep (Cmd/Ctrl) picks the leaf;
//  - otherwise the node at the current selection's depth, else the child of a top-level frame, else the top;
//  - layers inside an instance select the instance unless deep.
export function pick(doc, chain, selection, { deep = false, drill = false } = {}) {
  if (!chain.length) return null;
  if (deep) return chain[chain.length - 1];
  let i = -1;
  const sel = new Set(selection);
  const k = chain.findIndex((id) => sel.has(id));
  if (k >= 0) i = drill ? Math.min(k + 1, chain.length - 1) : k;
  if (i < 0) {
    // Same depth as a selected sibling.
    for (const s of selection) {
      const sn = doc.nodes[s];
      if (!sn) continue;
      const j = sn.parent ? chain.indexOf(sn.parent) : -1;
      if (j >= 0 && j + 1 < chain.length) { i = j + 1; break; }
    }
  }
  if (i < 0) {
    const top = doc.nodes[chain[0]];
    i = top.type === 'frame' && !top.variantSet && chain.length > 1 ? 1 : 0;
    if (top.variantSet && chain.length > 1) i = 1;
  }
  while (i > 0 && doc.nodes[chain[i]].src && !drill) i--;
  return chain[i];
}

// Nodes in a scope (a frame's children or the page) that a marquee touches.
export function marqueeHits(doc, scopeId, rect) {
  const ids = scopeId ? doc.nodes[scopeId].children : doc.children;
  return ids.filter((id) => {
    const n = doc.nodes[id];
    return n.visible !== false && !n.locked && intersects(worldBox(doc, id), rect);
  });
}

// The deepest frame (not inside an instance) containing world point p, skipping `exclude` subtrees.
export function frameAt(doc, p, exclude) {
  const chain = hitChain(doc, p, 0, exclude);
  for (let i = chain.length - 1; i >= 0; i--) {
    const n = doc.nodes[chain[i]];
    if (n.type === 'frame' && !n.src && !n.variantSet) return chain[i];
    if (n.type === 'frame' && n.variantSet) return chain[i];
  }
  return null;
}
