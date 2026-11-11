// SVG and PNG export. SVG is a pure string build (testable in Node); PNG uses the canvas renderer.
// Every value written into an attribute passes through esc() or num(), because document files are
// untrusted input (a .contorina.json can come from anywhere).
import { localMatrix, worldBox, unionBoxes, worldMatrix, mul, IDENT } from './geom.js';
import { fillOf, strokeOf, textOf, fontStack, effectsOf } from './styles.js';
import { textLayout } from './text.js';
import { drawNodes } from './render.js';
import { svgPaints, paints, firstColor, preloadImages } from './paint.js';
import { outlineD } from './vector.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v) => { const x = Number(v); return Number.isFinite(x) ? Math.round(x * 1000) / 1000 : 0; };
const mat = (m) => `matrix(${m.map(num).join(' ')})`;
const ALIGN = { left: 'start', center: 'middle', right: 'end' };

// The area a layer paints: its box grown by drop shadows and blurs (its own and its children's).
function paintedBox(doc, id) {
  const boxes = [worldBox(doc, id)];
  const walk = (nid) => {
    const n = doc.nodes[nid];
    if (!n || n.visible === false) return;
    for (const e of effectsOf(n, doc.styles)) {
      if (e.visible === false) continue;
      const b = worldBox(doc, nid);
      if (e.type === 'drop') { const g = (e.blur || 0) + (e.spread || 0); boxes.push({ x: b.x + (e.x || 0) - g, y: b.y + (e.y || 0) - g, w: b.w + 2 * g, h: b.h + 2 * g }); }
      if (e.type === 'blur') { const g = (e.radius || 0) * 2; boxes.push({ x: b.x - g, y: b.y - g, w: b.w + 2 * g, h: b.h + 2 * g }); }
    }
    if (n.children && n.clip === false) n.children.forEach(walk);
  };
  walk(id);
  return unionBoxes(boxes);
}
export function exportBounds(doc, ids) {
  const list = ids && ids.length ? ids : doc.children;
  return unionBoxes(list.filter((id) => doc.nodes[id] && doc.nodes[id].visible !== false).map((id) => paintedBox(doc, id)));
}

export function toSVG(doc, ids) {
  const list = (ids && ids.length ? ids : doc.children).filter((id) => doc.nodes[id]);
  const b = exportBounds(doc, list) || { x: 0, y: 0, w: 1, h: 1 };
  let seq = 0;
  const uid = () => `f${seq++}`;
  const defs = [];

  const shape = (n, attrs) => {
    const r = n.radius;
    const simpleRect = (n.type === 'rect' || n.type === 'frame' || n.type === 'instance') && !Array.isArray(r);
    if (n.type === 'ellipse') return `<ellipse cx="${num(n.w / 2)}" cy="${num(n.h / 2)}" rx="${num(n.w / 2)}" ry="${num(n.h / 2)}"${attrs}/>`;
    if (n.type === 'line') return `<line x1="0" y1="0" x2="${num(n.w)}" y2="0"${attrs}/>`;
    if (simpleRect) {
      const rr = r > 0 ? ` rx="${num(Math.min(r, n.w / 2, n.h / 2))}"` : '';
      return `<rect width="${num(n.w)}" height="${num(n.h)}"${rr}${attrs}/>`;
    }
    const rule = n.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : '';
    return `<path d="${esc(outlineD(n))}"${rule}${attrs}/>`;
  };

  const filterFor = (n) => {
    const fx = effectsOf(n, doc.styles).filter((e) => e.visible !== false && (e.type === 'drop' || e.type === 'blur'));
    if (!fx.length) return '';
    const id = uid();
    const parts = fx.map((e) => {
      if (e.type === 'drop') return `<feDropShadow dx="${num(e.x)}" dy="${num(e.y)}" stdDeviation="${num((e.blur || 0) / 2)}" flood-color="${esc(e.color || 'rgba(0,0,0,0.25)')}"/>`;
      if (e.type === 'blur') return `<feGaussianBlur stdDeviation="${num((e.radius || 0) / 2)}"/>`;
      return ''; // inner shadows have no single SVG primitive; skipped
    }).join('');
    if (!parts) return '';
    defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">${parts}</filter>`);
    return ` filter="url(#${id})"`;
  };

  const strokeAttrs = (n, stroke) => {
    if (!stroke || !(n.strokeWidth > 0)) return '';
    const color = firstColor(stroke) || '#000';
    const dash = Array.isArray(n.dash) && n.dash.length ? n.dash : n.dashed ? [6, 4] : null;
    return ` stroke="${esc(color)}" stroke-width="${num(n.strokeWidth)}"`
      + (n.type === 'line' || n.strokeCap ? ` stroke-linecap="${esc(n.strokeCap || 'round')}"` : '')
      + (n.strokeJoin ? ` stroke-linejoin="${esc(n.strokeJoin)}"` : '')
      + (dash ? ` stroke-dasharray="${dash.map(num).join(' ')}"` : '');
  };

  const fills = (n, fill) => svgPaints(fill, n.w, n.h, doc, defs, uid)
    .map((p) => shape(n, ` fill="${esc(p.fill)}"${p.op != null ? ` fill-opacity="${num(p.op)}"` : ''}${p.blend ? ` style="mix-blend-mode:${esc(p.blend)}"` : ''}`)).join('');

  const node = (id, m) => {
    const n = doc.nodes[id];
    if (!n || n.visible === false) return '';
    const fill = fillOf(n, doc.styles), stroke = strokeOf(n, doc.styles);
    const op = n.opacity != null && n.opacity < 1 ? ` opacity="${num(n.opacity)}"` : '';
    const blend = n.blendMode && n.blendMode !== 'normal' && n.blendMode !== 'pass' ? ` style="mix-blend-mode:${esc(n.blendMode)}"` : '';
    const filt = filterFor(n);
    const head = `transform="${mat(m)}"${op}${blend}${filt}`;
    if (n.type === 'text') {
      const s = textOf(n, doc.styles);
      const L = textLayout(n, doc.styles);
      const x = s.align === 'center' ? n.w / 2 : s.align === 'right' ? n.w : 0;
      const spans = L.rich
        ? L.rich.map((line) => {
          const x0 = s.align === 'center' ? (n.w - line.w) / 2 : s.align === 'right' ? n.w - line.w : 0;
          return line.pieces.map((p) => `<tspan x="${num(x0 + p.x)}" y="${num(line.y + line.lh / 2)}" text-anchor="start" style="font:${esc(p.font)}"${p.fill ? ` fill="${esc(p.fill)}"` : ''}${p.decoration === 'underline' ? ' text-decoration="underline"' : p.decoration === 'strike' ? ' text-decoration="line-through"' : ''}>${esc(p.text)}</tspan>`).join('');
        }).join('')
        : L.lines.map((l, i) => `<tspan x="${num(x)}" y="${num(i * L.lh + L.lh / 2)}">${esc(l) || ' '}</tspan>`).join('');
      const color = firstColor(fill) || '#000';
      return `<text ${head} fill="${esc(color)}" font-family="${esc(fontStack(s.fontFamily))}" font-size="${num(s.fontSize)}" font-weight="${num(s.fontWeight || 400)}" text-anchor="${ALIGN[s.align] || 'start'}" dominant-baseline="central" xml:space="preserve"${s.decoration === 'underline' ? ' text-decoration="underline"' : s.decoration === 'strike' ? ' text-decoration="line-through"' : ''}><title>${esc(n.name)}</title>${spans}</text>`;
    }
    const fillSvg = n.type === 'line' ? '' : fills(n, fill);
    const strokeSvg = strokeAttrs(n, stroke) ? shape(n, ' fill="none"' + strokeAttrs(n, stroke)) : '';
    if (!n.children || !n.children.length || n.type === 'boolean') return `<g ${head}>${fillSvg}${strokeSvg}</g>`;
    let kids = n.children.map((c) => node(c, localMatrix(doc.nodes[c] || { x: 0, y: 0, w: 0, h: 0 }))).join('');
    if (n.clip !== false) {
      const cid = uid();
      defs.push(`<clipPath id="${cid}">${shape(n, '')}</clipPath>`);
      kids = `<g clip-path="url(#${cid})">${kids}</g>`;
    }
    return `<g ${head} id="${esc(String(n.name).replace(/\s+/g, '_'))}">${fillSvg}${kids}${strokeSvg}</g>`;
  };

  const body = list.map((id) => {
    const n = doc.nodes[id];
    const m = mul(n.parent ? worldMatrix(doc, n.parent) : IDENT, localMatrix(n));
    m[4] -= b.x; m[5] -= b.y;
    return node(id, m);
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(b.w)}" height="${num(b.h)}" viewBox="0 0 ${num(b.w)} ${num(b.h)}">\n${defs.length ? `<defs>${defs.join('')}</defs>\n` : ''}${body}\n</svg>\n`;
}

export async function toRaster(doc, ids, { scale = 2, type = 'image/png', quality = 0.92, background = null } = {}) {
  const list = (ids && ids.length ? ids : doc.children).filter((id) => doc.nodes[id]);
  const b = exportBounds(doc, list);
  if (!b) throw new Error('Nothing to export');
  await preloadImages(doc);
  const w = Math.max(1, Math.ceil(b.w * scale)), h = Math.max(1, Math.ceil(b.h * scale));
  if (w * h > 16384 * 16384) throw new Error('Export is too large; lower the scale');
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (background || type === 'image/jpeg') { ctx.fillStyle = background || '#FFFFFF'; ctx.fillRect(0, 0, w, h); }
  ctx.setTransform(scale, 0, 0, scale, -b.x * scale, -b.y * scale);
  for (const id of list) {
    const n = doc.nodes[id];
    drawNodes(ctx, doc, [id], {}, n.parent ? worldMatrix(doc, n.parent) : IDENT, 1);
  }
  return canvas.convertToBlob({ type, quality });
}
export const toPNG = (doc, ids, scale = 2) => toRaster(doc, ids, { scale });
export { paints };
