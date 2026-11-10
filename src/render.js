// Canvas2D renderer. One function draws a document into any context, so the canvas, PNG export and
// the renderer spike share the same pixels.
import { localMatrix, mul, apply, boxOfPoints, corners, intersects, IDENT } from './geom.js';
import { fillOf, strokeOf, textOf, effectsOf } from './styles.js';
import { textLayout } from './text.js';
import { fillPaints, paints, firstColor } from './paint.js';
import { shapeD } from './vector.js';

const pathCache = new Map();
function cachedPath(d) {
  let p = pathCache.get(d);
  if (!p) { p = new Path2D(d); if (pathCache.size > 4000) pathCache.clear(); pathCache.set(d, p); }
  return p;
}

export function radii(n) {
  const r = n.radius;
  if (Array.isArray(r)) return r.map((v) => Math.max(0, Math.min(v || 0, n.w / 2, n.h / 2)));
  return r > 0 ? Math.min(r, n.w / 2, n.h / 2) : 0;
}

// The layer's outline in local space as a Path2D.
export function pathOf(n) {
  const p = new Path2D();
  switch (n.type) {
    case 'ellipse': p.ellipse(n.w / 2, n.h / 2, Math.max(0, n.w / 2), Math.max(0, n.h / 2), 0, 0, Math.PI * 2); return p;
    case 'line': p.moveTo(0, 0); p.lineTo(n.w, 0); return p;
    case 'vector': case 'boolean': case 'polygon': case 'star': {
      const d = shapeD(n);
      if (!d) return p;
      const vw = n.type === 'vector' || n.type === 'boolean' ? n.vw || n.w || 1 : 1, vh = n.type === 'vector' || n.type === 'boolean' ? n.vh || n.h || 1 : 1;
      const sx = n.type === 'vector' || n.type === 'boolean' ? n.w / vw : n.w, sy = n.type === 'vector' || n.type === 'boolean' ? n.h / vh : n.h;
      p.addPath(cachedPath(d), new DOMMatrix([sx || 1e-6, 0, 0, sy || 1e-6, 0, 0]));
      return p;
    }
    default: {
      const r = radii(n);
      if ((Array.isArray(r) ? r.some((v) => v > 0) : r > 0) && p.roundRect) p.roundRect(0, 0, n.w, n.h, r);
      else p.rect(0, 0, n.w, n.h);
      return p;
    }
  }
}

// opts: { cull: world box or null, skip: Set of ids not to draw (text being edited) }
export function drawNodes(ctx, doc, ids, opts = {}, parentM = IDENT, alpha = 1) {
  for (const id of ids) drawNode(ctx, doc, id, opts, parentM, alpha);
}

function effectPad(n, styles) {
  let pad = (n.strokeWidth || 0) + 2;
  for (const e of effectsOf(n, styles || {})) if (e.visible !== false) pad += Math.abs(e.x || 0) + Math.abs(e.y || 0) + (e.blur || e.radius || 0) * 2 + (e.spread || 0);
  return pad;
}

function drawNode(ctx, doc, id, opts, parentM, alpha) {
  const n = doc.nodes[id];
  if (!n || n.visible === false) return;
  const lm = localMatrix(n);
  const m = mul(parentM, lm);
  if (opts.cull) {
    const b = boxOfPoints(corners(n).map((p) => apply(m, p)));
    const pad = effectPad(n, doc.styles);
    if (!intersects({ x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad }, opts.cull)) return;
  }
  const a = alpha * (n.opacity ?? 1);
  const effects = effectsOf(n, doc.styles).filter((e) => e.visible !== false);
  ctx.save();
  ctx.transform(lm[0], lm[1], lm[2], lm[3], lm[4], lm[5]);
  ctx.globalAlpha = a;
  if (n.blendMode && n.blendMode !== 'normal' && n.blendMode !== 'pass') ctx.globalCompositeOperation = n.blendMode;
  const blur = effects.find((e) => e.type === 'blur');
  if (blur && blur.radius > 0) ctx.filter = `blur(${blur.radius}px)`;
  const styles = doc.styles;
  const fill = fillOf(n, styles);
  const stroke = strokeOf(n, styles);

  if (n.type === 'text') {
    if (!(opts.skip && opts.skip.has(id))) drawText(ctx, n, styles, fill, effects, doc);
    ctx.restore();
    return;
  }
  const path = pathOf(n);
  const rule = n.fillRule === 'evenodd' ? 'evenodd' : 'nonzero';

  // Background blur: blur what is already drawn under the shape.
  const bg = effects.find((e) => e.type === 'bgblur' || e.type === 'glass');
  if (bg && bg.radius > 0 && ctx.canvas) {
    ctx.save();
    ctx.clip(path, rule);
    ctx.filter = `blur(${bg.radius}px)`;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const t = ctx.getTransform();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(ctx.canvas, 0, 0);
    ctx.setTransform(t);
    ctx.restore();
  }

  // Drop shadows: cast by the fill shape (or the stroke for a line).
  for (const e of effects.filter((x) => x.type === 'drop')) {
    ctx.save();
    const s = scaleOf(ctx);
    ctx.shadowColor = e.color || 'rgba(0,0,0,0.25)';
    ctx.shadowOffsetX = (e.x || 0) * s; ctx.shadowOffsetY = (e.y || 0) * s; ctx.shadowBlur = (e.blur || 0) * s;
    ctx.fillStyle = '#000';
    {
      // Draw the shadow only: move the shape far away in local space and offset its shadow back by the
      // same distance in device pixels (shadow offsets ignore the transform, so rotation is handled).
      const far = 100000;
      const t = ctx.getTransform();
      ctx.shadowOffsetX -= t.a * far;
      ctx.shadowOffsetY -= t.b * far;
      ctx.translate(far, 0);
      if (n.type === 'line') { ctx.strokeStyle = '#000'; ctx.lineWidth = (n.strokeWidth || 1) + (e.spread || 0) * 2; ctx.lineCap = n.strokeCap || 'round'; ctx.stroke(path); }
      else {
        if (e.spread) { ctx.lineWidth = e.spread * 2; ctx.strokeStyle = '#000'; ctx.stroke(path); }
        ctx.fill(path, rule);
      }
    }
    ctx.restore();
  }

  if (n.type !== 'line' && paints(fill).length) fillWith(ctx, fill, n, doc, path, rule);

  for (const e of effects.filter((x) => x.type === 'glass')) {
    ctx.save();
    ctx.clip(path, rule);
    ctx.fillStyle = `rgba(255,255,255,${e.tint ?? 0.15})`;
    ctx.fillRect(0, 0, n.w, n.h);
    const g = ctx.createLinearGradient(0, 0, 0, Math.max(1, n.h));
    g.addColorStop(0, `rgba(255,255,255,${e.highlight ?? 0.6})`);
    g.addColorStop(0.08, 'rgba(255,255,255,0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 2;
    ctx.stroke(path);
    ctx.restore();
  }
  for (const e of effects.filter((x) => x.type === 'noise')) {
    ctx.save();
    ctx.clip(path, rule);
    ctx.globalAlpha *= Math.max(0, Math.min(1, e.amount ?? 0.15));
    ctx.fillStyle = noisePattern(ctx, e.size || 1, e.mono !== false);
    ctx.fillRect(0, 0, n.w, n.h);
    ctx.restore();
  }
  for (const e of effects.filter((x) => x.type === 'inner')) {
    ctx.save();
    ctx.clip(path, rule);
    const s = scaleOf(ctx);
    ctx.shadowColor = e.color || 'rgba(0,0,0,0.25)';
    ctx.shadowOffsetX = (e.x || 0) * s; ctx.shadowOffsetY = (e.y || 0) * s; ctx.shadowBlur = (e.blur || 0) * s;
    const ring = new Path2D();
    ring.rect(-n.w * 4 - 1000, -n.h * 4 - 1000, n.w * 9 + 2000, n.h * 9 + 2000);
    ring.addPath(path);
    ctx.fillStyle = '#000';
    ctx.fill(ring, 'evenodd');
    ctx.restore();
  }

  if (n.children && n.children.length && n.type !== 'boolean') {
    ctx.save();
    if (n.clip !== false) ctx.clip(path, rule);
    ctx.filter = 'none';
    drawNodes(ctx, doc, n.children, opts, m, a);
    ctx.restore();
  }
  if (stroke && n.strokeWidth > 0) strokeWith(ctx, n, stroke, path, doc);
  ctx.restore();
}

function fillWith(ctx, fill, n, doc, path, rule) {
  for (const p of paints(fill)) {
    ctx.save();
    if (p.opacity != null) ctx.globalAlpha *= p.opacity;
    if (p.blend && p.blend !== 'normal') ctx.globalCompositeOperation = p.blend;
    if (p.type === 'solid') { ctx.fillStyle = p.color; ctx.fill(path, rule); }
    else { ctx.clip(path, rule); fillPaints(ctx, { ...p, opacity: undefined, blend: undefined }, n.w, n.h, doc, () => { ctx.beginPath(); ctx.rect(-1, -1, n.w + 2, n.h + 2); }); }
    ctx.restore();
  }
}

function strokeWith(ctx, n, stroke, path, doc) {
  const align = n.type === 'line' ? 'center' : n.strokeAlign || 'center';
  const w = n.strokeWidth;
  ctx.save();
  ctx.lineCap = n.strokeCap || (n.type === 'line' ? 'round' : 'butt');
  ctx.lineJoin = n.strokeJoin || 'miter';
  if (Array.isArray(n.dash) && n.dash.length) ctx.setLineDash(n.dash.filter(Number.isFinite));
  else if (n.dashed) ctx.setLineDash([6, 4]);
  ctx.lineWidth = align === 'center' ? w : w * 2;
  if (align === 'inside') ctx.clip(path);
  if (align === 'outside') {
    const ring = new Path2D();
    ring.rect(-w * 4 - n.w * 2, -w * 4 - n.h * 2, n.w * 5 + w * 8, n.h * 5 + w * 8);
    ring.addPath(path);
    ctx.clip(ring, 'evenodd');
  }
  const ps = paints(stroke);
  for (const p of ps) {
    ctx.save();
    if (p.opacity != null) ctx.globalAlpha *= p.opacity;
    if (p.blend && p.blend !== 'normal') ctx.globalCompositeOperation = p.blend;
    ctx.strokeStyle = strokePaint(ctx, p, n);
    ctx.stroke(path);
    ctx.restore();
  }
  ctx.restore();
}

// A stroke paint in the layer's pixel space (unit-space gradients would scale the line width too).
function strokePaint(ctx, p, n) {
  const stops = (g) => { for (const s of p.stops || []) { try { g.addColorStop(Math.min(1, Math.max(0, s.pos)), s.color); } catch {} } return g; };
  const w = n.w || 1, h = n.h || 1;
  if (p.type === 'linear') {
    const a = ((p.angle ?? 90) * Math.PI) / 180, dx = Math.cos(a) / 2, dy = Math.sin(a) / 2;
    return stops(ctx.createLinearGradient((0.5 - dx) * w, (0.5 - dy) * h, (0.5 + dx) * w, (0.5 + dy) * h));
  }
  if (p.type === 'radial' || p.type === 'diamond') return stops(ctx.createRadialGradient((p.cx ?? 0.5) * w, (p.cy ?? 0.5) * h, 0, (p.cx ?? 0.5) * w, (p.cy ?? 0.5) * h, (p.r ?? 0.5) * Math.max(w, h)));
  if (p.type === 'angular' && ctx.createConicGradient) return stops(ctx.createConicGradient(((p.angle || 0) * Math.PI) / 180, (p.cx ?? 0.5) * w, (p.cy ?? 0.5) * h));
  return p.color || firstColor(p) || '#000';
}

function drawText(ctx, n, styles, fill, effects, doc) {
  const t = textOf(n, styles);
  const L = textLayout(n, styles);
  ctx.font = L.font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = t.align === 'center' ? 'center' : t.align === 'right' ? 'right' : 'left';
  const x = t.align === 'center' ? n.w / 2 : t.align === 'right' ? n.w : 0;
  if (t.letterSpacing && 'letterSpacing' in ctx) ctx.letterSpacing = t.letterSpacing + 'px';
  const drop = effects.find((e) => e.type === 'drop');
  if (drop) {
    const s = scaleOf(ctx);
    ctx.shadowColor = drop.color || 'rgba(0,0,0,0.25)';
    ctx.shadowOffsetX = (drop.x || 0) * s; ctx.shadowOffsetY = (drop.y || 0) * s; ctx.shadowBlur = (drop.blur || 0) * s;
  }
  const ps = paints(fill);
  const solid = ps.length === 1 && ps[0].type === 'solid';
  if (L.rich) {
    // Styled pieces, left to right; each line aligns as a whole.
    const base = (ps[0] && (ps[0].color || firstColor(ps[0]))) || '#000';
    ctx.textAlign = 'left';
    for (const line of L.rich) {
      const x0 = t.align === 'center' ? (n.w - line.w) / 2 : t.align === 'right' ? n.w - line.w : 0;
      for (const p of line.pieces) {
        ctx.font = p.font;
        ctx.fillStyle = p.fill || base;
        const y = line.y + line.lh / 2;
        ctx.fillText(p.text, x0 + p.x, y);
        if (p.decoration) {
          ctx.save();
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = Math.max(1, p.size / 14);
          const ly = y + (p.decoration === 'underline' ? p.size * 0.45 : 0);
          ctx.beginPath(); ctx.moveTo(x0 + p.x, ly); ctx.lineTo(x0 + p.x + p.w, ly); ctx.stroke();
          ctx.restore();
        }
      }
    }
    return;
  }
  if (solid || !ps.length) {
    ctx.fillStyle = (ps[0] && ps[0].color) || '#000';
    L.lines.forEach((line, i) => ctx.fillText(line, x, i * L.lh + L.lh / 2));
    if (t.decoration) decorate(ctx, t, L, x);
    return;
  }
  // Gradient or image text: draw the glyphs as a mask, then paint through it.
  ctx.save();
  ctx.fillStyle = '#000';
  L.lines.forEach((line, i) => ctx.fillText(line, x, i * L.lh + L.lh / 2));
  ctx.globalCompositeOperation = 'source-atop';
  ctx.shadowColor = 'transparent';
  fillPaints(ctx, fill, n.w, n.h, doc, () => { ctx.beginPath(); ctx.rect(0, 0, n.w, n.h); });
  ctx.restore();
}

function decorate(ctx, t, L, x) {
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = Math.max(1, t.fontSize / 14);
  L.lines.forEach((line, i) => {
    const w = ctx.measureText(line).width;
    const x0 = t.align === 'center' ? x - w / 2 : t.align === 'right' ? x - w : x;
    const y = i * L.lh + L.lh / 2 + (t.decoration === 'underline' ? t.fontSize * 0.45 : 0);
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + w, y); ctx.stroke();
  });
  ctx.restore();
}

// A fixed 64x64 tile of random grey (or colour) pixels; seeded so every render looks the same.
const noiseTiles = new Map();
function noisePattern(ctx, size, mono) {
  const key = `${size}|${mono}`;
  let tile = noiseTiles.get(key);
  if (!tile) {
    const N = 64;
    tile = new OffscreenCanvas(N * size, N * size);
    const t = tile.getContext('2d');
    let seed = 12345;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 255;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const v = rnd() | 0;
      t.fillStyle = mono ? `rgb(${v},${v},${v})` : `rgb(${v},${rnd() | 0},${rnd() | 0})`;
      t.fillRect(x * size, y * size, size, size);
    }
    noiseTiles.set(key, tile);
  }
  return ctx.createPattern(tile, 'repeat');
}

function scaleOf(ctx) {
  const t = ctx.getTransform();
  return Math.hypot(t.a, t.b) || 1;
}

// The canvas view: clear, set the view transform, draw.
export function drawView(ctx, doc, view, size, dpr, opts = {}) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = opts.background || '#F5F5F5';
  ctx.fillRect(0, 0, size.w * dpr, size.h * dpr);
  ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.x, dpr * view.y);
  const cull = { x: -view.x / view.zoom, y: -view.y / view.zoom, w: size.w / view.zoom, h: size.h / view.zoom };
  drawNodes(ctx, doc, opts.roots || doc.children, { ...opts, cull });
}
