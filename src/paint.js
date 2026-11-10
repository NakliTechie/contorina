// Paints. A fill or stroke value is a hex string (one solid paint), a paint object, or a list of
// paints drawn bottom to top. Paint objects:
//   { type: 'solid', color, opacity?, blend? }
//   { type: 'linear', angle, stops: [{ pos, color }], opacity?, blend? }      angle in degrees, 0 = left to right
//   { type: 'radial' | 'diamond', cx, cy, r?, stops, ... }                     centre and radius in 0..1 of the box
//   { type: 'angular', cx, cy, angle, stops, ... }
//   { type: 'image', asset, mode: 'fill' | 'fit' | 'crop' | 'tile', scale?, opacity?, blend? }
// Gradient geometry is in unit box space, so a gradient stretches with its layer like Figma's.

export const PAINT_TYPES = ['solid', 'linear', 'radial', 'angular', 'diamond', 'image'];
export const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];

export function paints(v) {
  if (v == null || v === '') return [];
  const list = Array.isArray(v) ? v : [v];
  return list.filter(Boolean).map((p) => (typeof p === 'string' ? { type: 'solid', color: p } : p)).filter((p) => p.visible !== false);
}
// A single display colour (first solid, else first gradient stop), for swatches and fallbacks.
export function firstColor(v) {
  for (const p of paints(v)) {
    if (p.type === 'solid') return p.color;
    if (p.stops && p.stops.length) return p.stops[0].color;
  }
  return null;
}
export const isPlainColor = (v) => typeof v === 'string' || v == null;

export function defaultPaint(type, from = '#D9D9D9') {
  const c = firstColor(from) || '#D9D9D9';
  const stops = [{ pos: 0, color: c }, { pos: 1, color: '#FFFFFF' }];
  switch (type) {
    case 'linear': return { type, angle: 90, stops };
    case 'radial': return { type, cx: 0.5, cy: 0.5, r: 0.5, stops };
    case 'diamond': return { type, cx: 0.5, cy: 0.5, r: 0.5, stops };
    case 'angular': return { type, cx: 0.5, cy: 0.5, angle: 0, stops };
    case 'image': return { type, asset: null, mode: 'fill' };
    default: return { type: 'solid', color: c };
  }
}

// ---- Canvas -------------------------------------------------------------------------------------
const images = new Map(); // asset id -> { img, ready }
let onImageReady = () => {};
export function setImageReadyHandler(fn) { onImageReady = fn; }
export function imageFor(doc, id) {
  const a = doc.assets && doc.assets[id];
  if (!a || !/^image\/(png|jpeg|gif|webp|avif)$/.test(a.mime) || !/^[A-Za-z0-9+/]*={0,2}$/.test(a.data)) return null;
  let e = images.get(id);
  if (!e) {
    e = { img: null, ready: false };
    images.set(id, e);
    if (typeof Image !== 'undefined') {
      const img = new Image();
      img.onload = () => { e.ready = true; onImageReady(); };
      img.src = `data:${a.mime};base64,${a.data}`;
      e.img = img;
    }
  }
  return e.ready ? e.img : null;
}

// Decode every image a document uses (export cannot wait for the lazy load the canvas relies on).
export async function preloadImages(doc) {
  const ids = Object.keys(doc.assets || {});
  await Promise.all(ids.map((id) => new Promise((resolve) => {
    if (imageFor(doc, id)) return resolve();
    const e = images.get(id);
    if (!e || !e.img) return resolve();
    e.img.decode().then(() => { e.ready = true; resolve(); }, resolve);
    setTimeout(resolve, 3000); // never let an export wait forever on one image
  })));
}

function addStops(g, stops) {
  for (const s of stops || []) { try { g.addColorStop(Math.min(1, Math.max(0, s.pos)), s.color); } catch {} }
  return g;
}

// Fill the current path (already built in local space, box w x h) with every paint in v.
export function fillPaints(ctx, v, w, h, doc, path) {
  for (const p of paints(v)) {
    ctx.save();
    if (p.opacity != null) ctx.globalAlpha *= p.opacity;
    if (p.blend && p.blend !== 'normal') ctx.globalCompositeOperation = p.blend;
    if (p.type === 'solid') { ctx.fillStyle = p.color; path(); ctx.fill(); ctx.restore(); continue; }
    path();
    ctx.clip();
    if (p.type === 'image') drawImagePaint(ctx, p, w, h, doc);
    else if (p.type === 'diamond') {
      // Four linear gradients from the centre towards each edge, one per quadrant.
      const cx = (p.cx ?? 0.5) * w, cy = (p.cy ?? 0.5) * h, rx = Math.max(1e-6, (p.r ?? 0.5) * w), ry = Math.max(1e-6, (p.r ?? 0.5) * h);
      for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
        ctx.save();
        ctx.beginPath(); ctx.rect(sx > 0 ? cx : cx - w * 2, sy > 0 ? cy : cy - h * 2, w * 2, h * 2); ctx.clip();
        // Distance |dx|/rx + |dy|/ry is constant along lines perpendicular to (1/rx, 1/ry).
        const len = 1 / Math.hypot(1 / rx, 1 / ry);
        const ux = (sx / rx) * len * len, uy = (sy / ry) * len * len;
        ctx.fillStyle = addStops(ctx.createLinearGradient(cx, cy, cx + ux, cy + uy), p.stops);
        ctx.fillRect(-w, -h, w * 4, h * 4);
        ctx.restore();
      }
    } else {
      ctx.transform(w || 1, 0, 0, h || 1, 0, 0);
      let g;
      if (p.type === 'linear') {
        const a = ((p.angle ?? 90) * Math.PI) / 180;
        const dx = Math.cos(a) / 2, dy = Math.sin(a) / 2;
        g = ctx.createLinearGradient(0.5 - dx, 0.5 - dy, 0.5 + dx, 0.5 + dy);
      } else if (p.type === 'radial') g = ctx.createRadialGradient(p.cx ?? 0.5, p.cy ?? 0.5, 0, p.cx ?? 0.5, p.cy ?? 0.5, p.r ?? 0.5);
      else if (p.type === 'angular') g = ctx.createConicGradient ? ctx.createConicGradient(((p.angle || 0) * Math.PI) / 180, p.cx ?? 0.5, p.cy ?? 0.5) : null;
      if (g) { ctx.fillStyle = addStops(g, p.stops); ctx.fillRect(0, 0, 1, 1); }
    }
    ctx.restore();
  }
}

function drawImagePaint(ctx, p, w, h, doc) {
  const img = imageFor(doc, p.asset);
  if (!img) { ctx.fillStyle = '#E6E6E6'; ctx.fillRect(0, 0, w, h); return; }
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (p.mode === 'tile') {
    const s = p.scale || 1;
    const pat = ctx.createPattern(img, 'repeat');
    if (pat && pat.setTransform) pat.setTransform(new DOMMatrix([s, 0, 0, s, 0, 0]));
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const k = p.mode === 'fit' ? Math.min(w / iw, h / ih) : p.mode === 'crop' ? (p.scale || 1) * Math.max(w / iw, h / ih) : Math.max(w / iw, h / ih);
  const dw = iw * k, dh = ih * k;
  const ox = p.mode === 'crop' ? (p.ox || 0) * w : (w - dw) / 2, oy = p.mode === 'crop' ? (p.oy || 0) * h : (h - dh) / 2;
  ctx.drawImage(img, ox, oy, dw, dh);
}

// ---- SVG ----------------------------------------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const n3 = (v) => Math.round(v * 1000) / 1000;
// Returns [{ fill: 'url(#id)' | '#hex', opacity }] and pushes <defs> entries.
export function svgPaints(v, w, h, doc, defs, uid) {
  const out = [];
  for (const p of paints(v)) {
    const op = p.opacity != null && p.opacity < 1 ? p.opacity : null;
    const blend = p.blend && p.blend !== 'normal' ? p.blend : null;
    if (p.type === 'solid') { out.push({ fill: p.color, op, blend }); continue; }
    const id = uid();
    const stops = (p.stops || []).map((s) => `<stop offset="${n3(s.pos)}" stop-color="${esc(s.color)}"/>`).join('');
    if (p.type === 'linear') {
      const a = ((p.angle ?? 90) * Math.PI) / 180, dx = Math.cos(a) / 2, dy = Math.sin(a) / 2;
      defs.push(`<linearGradient id="${id}" x1="${n3(0.5 - dx)}" y1="${n3(0.5 - dy)}" x2="${n3(0.5 + dx)}" y2="${n3(0.5 + dy)}">${stops}</linearGradient>`);
    } else if (p.type === 'radial' || p.type === 'diamond') {
      defs.push(`<radialGradient id="${id}" cx="${n3(p.cx ?? 0.5)}" cy="${n3(p.cy ?? 0.5)}" r="${n3(p.r ?? 0.5)}">${stops}</radialGradient>`);
    } else if (p.type === 'angular') {
      // SVG has no conic gradient; the first stop stands in.
      out.push({ fill: (p.stops && p.stops[0] && p.stops[0].color) || '#000', op, blend });
      continue;
    } else if (p.type === 'image') {
      const a = doc.assets && doc.assets[p.asset];
      if (!a || !/^image\/(png|jpeg|gif|webp|avif)$/.test(a.mime) || !/^[A-Za-z0-9+/]*={0,2}$/.test(a.data)) continue;
      const par = p.mode === 'fit' ? 'xMidYMid meet' : 'xMidYMid slice';
      defs.push(`<pattern id="${id}" patternUnits="objectBoundingBox" width="1" height="1" viewBox="0 0 ${n3(w)} ${n3(h)}" preserveAspectRatio="none"><image href="data:${esc(a.mime)};base64,${a.data}" width="${n3(w)}" height="${n3(h)}" preserveAspectRatio="${par}"/></pattern>`);
    }
    out.push({ fill: `url(#${id})`, op, blend });
  }
  return out;
}
