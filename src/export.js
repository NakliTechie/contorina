// SVG and PNG export. SVG is a pure string build (testable in Node); PNG uses the canvas renderer.
import { localMatrix, worldBox, unionBoxes, worldMatrix, IDENT } from './geom.js';
import { fillOf, strokeOf, textOf, fontStack } from './styles.js';
import { textLayout } from './text.js';
import { drawNodes } from './render.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (v) => Math.round(v * 1000) / 1000;
const mat = (m) => `matrix(${m.map(num).join(' ')})`;

export function exportBounds(doc, ids) {
  const list = ids && ids.length ? ids : doc.children;
  return unionBoxes(list.filter((id) => doc.nodes[id] && doc.nodes[id].visible !== false).map((id) => worldBox(doc, id)));
}

export function toSVG(doc, ids) {
  const list = (ids && ids.length ? ids : doc.children).filter((id) => doc.nodes[id]);
  const b = exportBounds(doc, list) || { x: 0, y: 0, w: 1, h: 1 };
  let clipN = 0;
  const defs = [];
  const shape = (n, attrs) => {
    if (n.type === 'ellipse') return `<ellipse cx="${num(n.w / 2)}" cy="${num(n.h / 2)}" rx="${num(n.w / 2)}" ry="${num(n.h / 2)}"${attrs}/>`;
    if (n.type === 'line') return `<line x1="0" y1="0" x2="${num(n.w)}" y2="0"${attrs}/>`;
    const r = n.radius > 0 ? ` rx="${num(Math.min(n.radius, n.w / 2, n.h / 2))}"` : '';
    return `<rect width="${num(n.w)}" height="${num(n.h)}"${r}${attrs}/>`;
  };
  const node = (id, m) => {
    const n = doc.nodes[id];
    if (!n || n.visible === false) return '';
    const fill = fillOf(n, doc.styles), stroke = strokeOf(n, doc.styles);
    const op = n.opacity != null && n.opacity < 1 ? ` opacity="${num(n.opacity)}"` : '';
    const t = mat(m);
    if (n.type === 'text') {
      const s = textOf(n, doc.styles);
      const L = textLayout(n, doc.styles);
      const anchor = s.align === 'center' ? 'middle' : s.align === 'right' ? 'end' : 'start';
      const x = s.align === 'center' ? n.w / 2 : s.align === 'right' ? n.w : 0;
      const spans = L.lines.map((l, i) => `<tspan x="${num(x)}" y="${num(i * L.lh + L.lh / 2)}">${esc(l) || ' '}</tspan>`).join('');
      return `<text transform="${t}"${op} fill="${esc(fill || '#000')}" font-family="${esc(fontStack(s.fontFamily))}" font-size="${num(s.fontSize)}" font-weight="${s.fontWeight}" text-anchor="${anchor}" dominant-baseline="central" xml:space="preserve"><title>${esc(n.name)}</title>${spans}</text>`;
    }
    const sAttr = stroke && n.strokeWidth > 0 ? ` stroke="${esc(stroke)}" stroke-width="${num(n.strokeWidth)}"${n.type === 'line' ? ' stroke-linecap="round"' : ''}${n.dashed ? ' stroke-dasharray="6 4"' : ''}` : '';
    const fAttr = n.type === 'line' ? ' fill="none"' : ` fill="${fill ? esc(fill) : 'none'}"`;
    if (!n.children || !n.children.length) return `<g transform="${t}"${op}>${shape(n, fAttr + sAttr)}</g>`;
    let kids = n.children.map((c) => node(c, localMatrix(doc.nodes[c] || {}))).join('');
    if (n.clip !== false) {
      const cid = `clip${clipN++}`;
      defs.push(`<clipPath id="${cid}">${shape(n, '')}</clipPath>`);
      kids = `<g clip-path="url(#${cid})">${kids}</g>`;
    }
    return `<g transform="${t}"${op} id="${esc(n.name).replace(/\s+/g, '_')}">${fill ? shape(n, fAttr) : ''}${kids}${sAttr ? shape(n, ' fill="none"' + sAttr) : ''}</g>`;
  };
  const body = list.map((id) => {
    const n = doc.nodes[id];
    const pm = n.parent ? worldMatrix(doc, n.parent) : IDENT;
    const lm = localMatrix(n);
    const m = [pm[0] * lm[0] + pm[2] * lm[1], pm[1] * lm[0] + pm[3] * lm[1], pm[0] * lm[2] + pm[2] * lm[3], pm[1] * lm[2] + pm[3] * lm[3], pm[0] * lm[4] + pm[2] * lm[5] + pm[4] - b.x, pm[1] * lm[4] + pm[3] * lm[5] + pm[5] - b.y];
    return node(id, m);
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(b.w)}" height="${num(b.h)}" viewBox="0 0 ${num(b.w)} ${num(b.h)}">\n${defs.length ? `<defs>${defs.join('')}</defs>\n` : ''}${body}\n</svg>\n`;
}

export async function toPNG(doc, ids, scale = 2) {
  const list = (ids && ids.length ? ids : doc.children).filter((id) => doc.nodes[id]);
  const b = exportBounds(doc, list);
  if (!b) throw new Error('Nothing to export');
  const w = Math.max(1, Math.ceil(b.w * scale)), h = Math.max(1, Math.ceil(b.h * scale));
  if (w * h > 16384 * 16384) throw new Error('Export is too large; lower the scale');
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, -b.x * scale, -b.y * scale);
  for (const id of list) {
    const n = doc.nodes[id];
    drawNodes(ctx, doc, [id], {}, n.parent ? worldMatrix(doc, n.parent) : IDENT, 1);
  }
  return canvas.convertToBlob({ type: 'image/png' });
}
