// Canvas2D renderer. One function draws a document into any context, so the canvas, PNG export and
// the renderer spike share the same pixels.
import { localMatrix, mul, apply, boxOfPoints, corners, intersects, IDENT } from './geom.js';
import { fillOf, strokeOf, textOf } from './styles.js';
import { textLayout } from './text.js';

function shapePath(ctx, n) {
  ctx.beginPath();
  if (n.type === 'ellipse') ctx.ellipse(n.w / 2, n.h / 2, Math.max(0, n.w / 2), Math.max(0, n.h / 2), 0, 0, Math.PI * 2);
  else if (n.type === 'line') { ctx.moveTo(0, 0); ctx.lineTo(n.w, 0); }
  else if (n.radius > 0 && ctx.roundRect) ctx.roundRect(0, 0, n.w, n.h, Math.min(n.radius, n.w / 2, n.h / 2));
  else ctx.rect(0, 0, n.w, n.h);
}

// opts: { cull: world box or null, skip: Set of ids not to draw (text being edited) }
export function drawNodes(ctx, doc, ids, opts = {}, parentM = IDENT, alpha = 1) {
  for (const id of ids) drawNode(ctx, doc, id, opts, parentM, alpha);
}

function drawNode(ctx, doc, id, opts, parentM, alpha) {
  const n = doc.nodes[id];
  if (!n || n.visible === false) return;
  const lm = localMatrix(n);
  const m = mul(parentM, lm);
  if (opts.cull) {
    const b = boxOfPoints(corners(n).map((p) => apply(m, p)));
    const pad = (n.strokeWidth || 0) + 2;
    if (!intersects({ x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad }, opts.cull)) return;
  }
  const a = alpha * (n.opacity ?? 1);
  ctx.save();
  ctx.transform(lm[0], lm[1], lm[2], lm[3], lm[4], lm[5]);
  ctx.globalAlpha = a;
  const styles = doc.styles;
  const fill = fillOf(n, styles);
  const stroke = strokeOf(n, styles);
  if (n.type === 'text') {
    if (!(opts.skip && opts.skip.has(id))) {
      const t = textOf(n, styles);
      const L = textLayout(n, styles);
      ctx.font = L.font;
      ctx.fillStyle = fill || '#000';
      ctx.textBaseline = 'middle';
      ctx.textAlign = t.align === 'center' ? 'center' : t.align === 'right' ? 'right' : 'left';
      const x = t.align === 'center' ? n.w / 2 : t.align === 'right' ? n.w : 0;
      L.lines.forEach((line, i) => ctx.fillText(line, x, i * L.lh + L.lh / 2));
    }
  } else {
    shapePath(ctx, n);
    if (fill && n.type !== 'line') { ctx.fillStyle = fill; ctx.fill(); }
    if (n.children && n.children.length) {
      ctx.save();
      if (n.clip !== false) { shapePath(ctx, n); ctx.clip(); }
      drawNodes(ctx, doc, n.children, opts, m, a);
      ctx.restore();
    }
    if (stroke && n.strokeWidth > 0) {
      shapePath(ctx, n);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = n.strokeWidth;
      ctx.lineCap = 'round';
      if (n.dashed) ctx.setLineDash([6, 4]);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// The canvas view: clear, set the view transform, draw.
export function drawView(ctx, doc, view, size, dpr, opts = {}) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = opts.background || '#F5F5F5';
  ctx.fillRect(0, 0, size.w * dpr, size.h * dpr);
  ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.x, dpr * view.y);
  const cull = { x: -view.x / view.zoom, y: -view.y / view.zoom, w: size.w / view.zoom, h: size.h / view.zoom };
  drawNodes(ctx, doc, doc.children, { ...opts, cull });
}
