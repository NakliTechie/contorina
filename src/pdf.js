// Vector PDF export. One page per exported top-level layer. Shapes become PDF paths with solid
// colour (a gradient uses its first stop), opacity through ExtGState, frames clip their children, text
// uses the standard Helvetica fonts with WinAnsi encoding (characters outside it print as "?"), and
// images embed as JPEG when the caller supplies the bytes. Pure: returns a Uint8Array.
import { localMatrix, worldMatrix, mul, IDENT } from './geom.js';
import { fillOf, strokeOf, textOf } from './styles.js';
import { firstColor, paints } from './paint.js';
import { outlineD, parsePath } from './vector.js';
import { textLayout } from './text.js';
import { exportBounds } from './export.js';

// PDF numbers: finite, no exponent notation; anything else prints as 0.
const f = (v) => { const x = Math.round(Number(v) * 1000) / 1000; if (!Number.isFinite(x) || Math.abs(x) > 1e9) return '0'; return Object.is(x, -0) ? '0' : String(x); };
function rgb(hex) {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
}
// WinAnsi covers Latin-1 plus a few symbols; PDF strings escape \ ( ).
function winAnsi(s) {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    const map = { 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x20ac: 0x80, 0x2026: 0x85 };
    const b = c < 256 ? c : map[c];
    if (b === undefined) { out += '?'; continue; }
    const t = String.fromCharCode(b);
    out += t === '\\' || t === '(' || t === ')' ? '\\' + t : b < 32 ? ' ' : t;
  }
  return out;
}

function pathOps(d) {
  const ops = [];
  for (const s of parsePath(d)) {
    for (const g of s.segs) {
      if (g.c === 'M') ops.push(`${f(g.pts[0][0])} ${f(g.pts[0][1])} m`);
      else if (g.c === 'L') ops.push(`${f(g.pts[0][0])} ${f(g.pts[0][1])} l`);
      else ops.push(`${g.pts.map((p) => `${f(p[0])} ${f(p[1])}`).join(' ')} c`);
    }
    if (s.closed) ops.push('h');
  }
  return ops.join('\n');
}

// images: { [assetId]: { jpeg: Uint8Array, w, h } } prepared by the caller (browser), optional.
export function toPDF(doc, ids, { images = {} } = {}) {
  const list = (ids && ids.length ? ids : doc.children).filter((id) => doc.nodes[id] && doc.nodes[id].visible !== false);
  if (!list.length) throw new Error('Nothing to export');
  const objs = []; // object bodies (strings or Uint8Array streams)
  const add = (body) => { objs.push(body); return objs.length; };
  const gstates = new Map(); // alpha key -> name
  const usedImages = new Map(); // asset id -> { name, obj }
  const fonts = { F1: 'Helvetica', F2: 'Helvetica-Bold' };
  const pages = [];

  const gs = (fa, sa) => {
    const k = `${f(fa)}/${f(sa)}`;
    if (!gstates.has(k)) gstates.set(k, { name: `GS${gstates.size + 1}`, fa, sa });
    return gstates.get(k).name;
  };

  const draw = (id, alpha, out) => {
    const n = doc.nodes[id];
    if (!n || n.visible === false) return;
    const a = alpha * (n.opacity ?? 1);
    const m = localMatrix(n);
    out.push('q', `${m.map(f).join(' ')} cm`);
    const fill = fillOf(n, doc.styles), stroke = strokeOf(n, doc.styles);
    if (n.type === 'text') {
      const t = textOf(n, doc.styles);
      const L = textLayout(n, doc.styles);
      const c = rgb(firstColor(fill) || '#000000') || { r: 0, g: 0, b: 0, a: 1 };
      out.push(`/${gs(a * c.a, a)} gs`, `${f(c.r)} ${f(c.g)} ${f(c.b)} rg`, 'BT', `/${(t.fontWeight || 400) >= 600 ? 'F2' : 'F1'} ${f(t.fontSize)} Tf`);
      L.lines.forEach((line, i) => {
        // Helvetica's average advance is about 0.5 em; centre and right alignment use that estimate.
        const est = line.length * t.fontSize * 0.5;
        const x = t.align === 'center' ? (n.w - est) / 2 : t.align === 'right' ? n.w - est : 0;
        const baseline = i * L.lh + L.lh / 2 + t.fontSize * 0.35;
        out.push(`1 0 0 -1 ${f(x)} ${f(baseline)} Tm`, `(${winAnsi(line)}) Tj`);
      });
      out.push('ET', 'Q');
      return;
    }
    const d = outlineD(n);
    const ops = pathOps(d);
    const rule = n.fillRule === 'evenodd' ? 'f*' : 'f';
    for (const p of n.type === 'line' ? [] : paints(fill)) {
      if (p.type === 'image') {
        const img = images[p.asset];
        if (img) {
          if (!usedImages.has(p.asset)) usedImages.set(p.asset, { name: `Im${usedImages.size + 1}`, img });
          const im = usedImages.get(p.asset);
          // Cover the box like the "fill" mode; the clip keeps the overflow out.
          const k = Math.max(n.w / img.w, n.h / img.h), dw = img.w * k, dh = img.h * k;
          out.push('q', ops, 'W n', `/${gs(a, a)} gs`, `${f(dw)} 0 0 ${f(-dh)} ${f((n.w - dw) / 2)} ${f((n.h + dh) / 2)} cm`, `/${im.name} Do`, 'Q');
          continue;
        }
      }
      const c = rgb(firstColor(p) || '#C4C4C4');
      if (!c) continue;
      out.push(`/${gs(a * c.a * (p.opacity ?? 1), a)} gs`, `${f(c.r)} ${f(c.g)} ${f(c.b)} rg`, ops, rule);
    }
    if (n.children && n.children.length && n.type !== 'boolean') {
      out.push('q');
      if (n.clip !== false) out.push(ops, 'W n');
      for (const c of n.children) draw(c, a, out);
      out.push('Q');
    }
    if (stroke && n.strokeWidth > 0) {
      const c = rgb(firstColor(stroke) || '#000000');
      if (c) {
        out.push(`/${gs(a, a * c.a)} gs`, `${f(c.r)} ${f(c.g)} ${f(c.b)} RG`, `${f(n.strokeWidth)} w`);
        if (Array.isArray(n.dash) && n.dash.length) out.push(`[${n.dash.map(f).join(' ')}] 0 d`);
        if (n.type === 'line' || n.strokeCap === 'round') out.push('1 J');
        out.push(ops, 'S');
      }
    }
    out.push('Q');
  };

  for (const id of list) {
    const n = doc.nodes[id];
    const b = exportBounds(doc, [id]);
    const out = [];
    // Flip to a top-left origin, then move the layer's painted box to the page origin.
    out.push(`1 0 0 -1 0 ${f(b.h)} cm`, `1 0 0 1 ${f(-b.x)} ${f(-b.y)} cm`);
    const pm = n.parent ? worldMatrix(doc, n.parent) : IDENT;
    out.push(`${pm.map(f).join(' ')} cm`);
    draw(id, 1, out);
    pages.push({ w: b.w, h: b.h, content: out.join('\n') });
  }

  // Objects: 1 catalog, 2 pages, then fonts, gstates, images, then page + content pairs.
  // One byte per character: WinAnsi text and the binary header comment must not become UTF-8.
  const enc = { encode: (str) => Uint8Array.from(str, (c) => c.charCodeAt(0) & 255) };
  const catalog = add('');
  const pagesObj = add('');
  const fontObjs = Object.entries(fonts).map(([name, base]) => [name, add(`<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`)]);
  const gsObjs = [...gstates.values()].map((g) => [g.name, add(`<< /Type /ExtGState /ca ${f(g.fa)} /CA ${f(g.sa)} >>`)]);
  const imgObjs = [...usedImages.values()].map(({ name, img }) => [name, add({ dict: `<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>`, bytes: img.jpeg })]);
  const res = `<< /Font << ${fontObjs.map(([n, o]) => `/${n} ${o} 0 R`).join(' ')} >> /ExtGState << ${gsObjs.map(([n, o]) => `/${n} ${o} 0 R`).join(' ')} >> /XObject << ${imgObjs.map(([n, o]) => `/${n} ${o} 0 R`).join(' ')} >> >>`;
  const kids = [];
  for (const p of pages) {
    const body = enc.encode(p.content);
    const c = add({ dict: `<< /Length ${body.length} >>`, bytes: body });
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${f(p.w)} ${f(p.h)}] /Resources ${res} /Contents ${c} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  const chunks = [];
  let offset = 0;
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); offset += b.length; };
  push('%PDF-1.4\n%âãÏÓ\n');
  const xref = [];
  objs.forEach((o, i) => {
    xref.push(offset);
    if (typeof o === 'string') push(`${i + 1} 0 obj\n${o}\nendobj\n`);
    else { push(`${i + 1} 0 obj\n${o.dict}\nstream\n`); push(o.bytes); push('\nendstream\nendobj\n'); }
  });
  const xo = offset;
  push(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${xref.map((x) => String(x).padStart(10, '0') + ' 00000 n \n').join('')}`);
  push(`trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info << /Producer (Figger) >> >>\nstartxref\n${xo}\n%%EOF\n`);
  const outBytes = new Uint8Array(offset);
  let p = 0;
  for (const c of chunks) { outBytes.set(c, p); p += c.length; }
  return outBytes;
}
