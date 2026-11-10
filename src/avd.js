// Android Vector Drawable export (res/drawable XML). Shapes and vectors become <path>; frames become
// <group> with a <clip-path>; colours are #AARRGGBB; gradients use their first stop; text and images
// are skipped because the format has no text or bitmaps. Pure.
import { localMatrix, worldMatrix, mul, IDENT } from './geom.js';
import { fillOf, strokeOf } from './styles.js';
import { firstColor } from './paint.js';
import { outlineD, transformD } from './vector.js';
import { exportBounds } from './export.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const num = (v) => Math.round(v * 1000) / 1000;
function argb(hex, alpha = 1) {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex || '');
  if (!m) return null;
  const a = Math.round((m[2] ? parseInt(m[2], 16) / 255 : 1) * alpha * 255);
  return '#' + a.toString(16).padStart(2, '0').toUpperCase() + m[1].toUpperCase();
}

export function toAVD(doc, ids) {
  const list = (ids && ids.length ? ids : doc.children).filter((id) => doc.nodes[id] && doc.nodes[id].visible !== false);
  const b = exportBounds(doc, list);
  if (!b) throw new Error('Nothing to export');
  const skipped = new Set();
  // Paths are written in canvas coordinates relative to the export box, so groups need no transforms.
  const walk = (id, m, alpha, pad) => {
    const n = doc.nodes[id];
    if (!n || n.visible === false) return '';
    const mm = mul(m, localMatrix(n));
    const a = alpha * (n.opacity ?? 1);
    if (n.type === 'text') { skipped.add('text'); return ''; }
    const d = transformD(outlineD(n), mm);
    const fill = n.type === 'line' ? null : argb(firstColor(fillOf(n, doc.styles)));
    const stroke = n.strokeWidth > 0 ? argb(firstColor(strokeOf(n, doc.styles))) : null;
    if ([].concat(fillOf(n, doc.styles) || []).some((p) => p && p.type === 'image')) skipped.add('images');
    let out = '';
    if (fill || stroke) {
      const scale = Math.sqrt(Math.abs(mm[0] * mm[3] - mm[1] * mm[2])) || 1;
      out += `${pad}<path android:name="${esc(n.name)}" android:pathData="${esc(d)}"`
        + (fill ? ` android:fillColor="${fill}"${a < 1 ? ` android:fillAlpha="${num(a)}"` : ''}${n.fillRule === 'evenodd' ? ' android:fillType="evenOdd"' : ''}` : '')
        + (stroke ? ` android:strokeColor="${stroke}" android:strokeWidth="${num(n.strokeWidth * scale)}"${a < 1 ? ` android:strokeAlpha="${num(a)}"` : ''}${n.strokeCap ? ` android:strokeLineCap="${esc(n.strokeCap)}"` : n.type === 'line' ? ' android:strokeLineCap="round"' : ''}` : '')
        + '/>\n';
    }
    if (n.children && n.children.length && n.type !== 'boolean') {
      const kids = n.children.map((c) => walk(c, mm, a, pad + '  ')).join('');
      if (kids) out += n.clip !== false ? `${pad}<group android:name="${esc(n.name)}">\n${pad}  <clip-path android:pathData="${esc(d)}"/>\n${kids}${pad}</group>\n` : kids;
    }
    return out;
  };
  const shift = [1, 0, 0, 1, -b.x, -b.y];
  const body = list.map((id) => { const n = doc.nodes[id]; return walk(id, mul(shift, n.parent ? worldMatrix(doc, n.parent) : IDENT), 1, '  '); }).join('');
  const note = skipped.size ? `<!-- Figger: ${[...skipped].join(' and ')} skipped; Vector Drawables cannot hold them. -->\n` : '';
  return `<?xml version="1.0" encoding="utf-8"?>\n${note}<vector xmlns:android="http://schemas.android.com/apk/res/android"\n    android:width="${num(b.w)}dp" android:height="${num(b.h)}dp"\n    android:viewportWidth="${num(b.w)}" android:viewportHeight="${num(b.h)}">\n${body}</vector>\n`;
}
