// SVG import. A small XML parser (no DOM, so Node tests run it) and a converter from SVG elements to
// Figger layer specs: rect and ellipse stay editable shapes when untransformed or only moved and
// scaled; everything else becomes a vector path. Groups become unclipped frames.
import { parsePath, serialize, mapPoints, fitVector, boundsOf } from './vector.js';
import { mul, IDENT } from './geom.js';

// ---- XML ----------------------------------------------------------------------------------------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const unent = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m));
export function parseXML(src) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.children.push({ text: m[1] });
    else if (m[2]) { if (stack.length > 1 && stack[stack.length - 1].tag === m[2]) stack.pop(); else { const i = stack.map((s) => s.tag).lastIndexOf(m[2]); if (i > 0) stack.length = i; } }
    else if (m[3]) {
      const attrs = {};
      const ar = /([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;
      let a;
      while ((a = ar.exec(m[4] || ''))) attrs[a[1]] = unent(a[2] ?? a[3] ?? '');
      const el = { tag: m[3].replace(/^svg:/, ''), attrs, children: [] };
      top.children.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6] !== undefined && m[6].trim()) top.children.push({ text: unent(m[6]) });
  }
  return root;
}

// ---- colours and transforms ------------------------------------------------------------------------
const NAMED = { black: '#000000', white: '#FFFFFF', red: '#FF0000', green: '#008000', blue: '#0000FF', yellow: '#FFFF00', gray: '#808080', grey: '#808080', orange: '#FFA500', purple: '#800080', none: null, transparent: null };
const hex2 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0').toUpperCase();
export function parseColor(v) {
  if (v == null) return undefined;
  v = String(v).trim().toLowerCase();
  if (v in NAMED) return NAMED[v];
  if (v === 'currentcolor') return '#000000';
  let m = v.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    return '#' + h.toUpperCase();
  }
  m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map((x, i) => (x.endsWith('%') ? (parseFloat(x) * (i < 3 ? 255 : 1)) / 100 : parseFloat(x)));
    return '#' + hex2(p[0]) + hex2(p[1]) + hex2(p[2]) + (p[3] != null && p[3] < 1 ? hex2(p[3] * 255) : '');
  }
  return undefined;
}
export function parseTransform(t) {
  let m = IDENT;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let x;
  while ((x = re.exec(t || ''))) {
    const a = x[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let n;
    switch (x[1]) {
      case 'matrix': n = a.slice(0, 6); break;
      case 'translate': n = [1, 0, 0, 1, a[0] || 0, a[1] || 0]; break;
      case 'scale': n = [a[0], 0, 0, a[1] ?? a[0], 0, 0]; break;
      case 'rotate': {
        const r = ((a[0] || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
        n = [c, s, -s, c, 0, 0];
        if (a.length >= 3) n = mul(mul([1, 0, 0, 1, a[1], a[2]], n), [1, 0, 0, 1, -a[1], -a[2]]);
        break;
      }
      case 'skewX': n = [1, 0, Math.tan(((a[0] || 0) * Math.PI) / 180), 1, 0, 0]; break;
      case 'skewY': n = [1, Math.tan(((a[0] || 0) * Math.PI) / 180), 0, 1, 0, 0]; break;
    }
    m = mul(m, n);
  }
  return m;
}
const len = (v, ref = 0) => { if (v == null || v === '') return 0; const s = String(v).trim(); return s.endsWith('%') ? (parseFloat(s) / 100) * ref : parseFloat(s) || 0; };

// ---- SVG to layer specs -------------------------------------------------------------------------------
// Returns { w, h, layers: [spec] } where spec = { type, name, props (in SVG root coordinates), children }.
export function svgToSpecs(src) {
  const doc = parseXML(src);
  const svg = findFirst(doc, 'svg');
  if (!svg) throw new Error('Not an SVG document');
  const ids = {};
  index(svg, ids);
  const vb = (svg.attrs.viewBox || '').split(/[\s,]+/).map(Number);
  let w = len(svg.attrs.width), h = len(svg.attrs.height);
  let root = IDENT;
  if (vb.length === 4 && vb.every(Number.isFinite)) {
    if (!w) w = vb[2];
    if (!h) h = vb[3];
    root = [w / vb[2], 0, 0, h / vb[3], (-vb[0] * w) / vb[2], (-vb[1] * h) / vb[3]];
  }
  w = w || 100; h = h || 100;
  const vp = { w, h, budget: 20000, stack: new Set() };
  const layers = walkKids(svg, root, inheritStyle({}, svg), ids, vp);
  return { w, h, layers };
}
function findFirst(n, tag) { if (n.tag === tag) return n; for (const c of n.children || []) { const f = c.tag && findFirst(c, tag); if (f) return f; } return null; }
function index(n, ids) { if (n.attrs && n.attrs.id) ids[n.attrs.id] = n; for (const c of n.children || []) if (c.tag) index(c, ids); }

const STYLE_KEYS = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'display', 'visibility'];
function inheritStyle(parent, el) {
  const s = { ...parent, opacity: undefined };
  const css = {};
  for (const part of String(el.attrs.style || '').split(';')) { const [k, v] = part.split(':'); if (k && v) css[k.trim()] = v.trim(); }
  for (const k of STYLE_KEYS) { const v = css[k] ?? el.attrs[k]; if (v != null && v !== 'inherit') s[k] = v; }
  return s;
}

function paintFrom(v, ids, op) {
  if (v == null) return undefined;
  const m = String(v).match(/^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/);
  if (m) {
    const g = ids[m[1]];
    if (!g || !/Gradient$/.test(g.tag)) return '#000000';
    const stops = g.children.filter((c) => c.tag === 'stop').map((s) => {
      const st = inheritStyle({}, s);
      const css = {};
      for (const part of String(s.attrs.style || '').split(';')) { const [k, val] = part.split(':'); if (k && val) css[k.trim()] = val.trim(); }
      const color = parseColor(css['stop-color'] ?? s.attrs['stop-color'] ?? '#000') || '#000000';
      const o = parseFloat(css['stop-opacity'] ?? s.attrs['stop-opacity'] ?? '1');
      const off = String(s.attrs.offset || '0');
      return { pos: off.endsWith('%') ? parseFloat(off) / 100 : parseFloat(off) || 0, color: o < 1 ? color.slice(0, 7) + hex2(o * 255) : color };
    });
    if (g.tag === 'linearGradient') {
      const x1 = len(g.attrs.x1 ?? '0', 1), y1 = len(g.attrs.y1 ?? '0', 1), x2 = len(g.attrs.x2 ?? '1', 1), y2 = len(g.attrs.y2 ?? '0', 1);
      return [{ type: 'linear', angle: Math.round((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI), stops, ...(op < 1 ? { opacity: op } : {}) }];
    }
    return [{ type: 'radial', cx: len(g.attrs.cx ?? '0.5', 1), cy: len(g.attrs.cy ?? '0.5', 1), r: len(g.attrs.r ?? '0.5', 1), stops, ...(op < 1 ? { opacity: op } : {}) }];
  }
  const c = parseColor(v);
  if (c === null) return null;
  if (c === undefined) return undefined;
  return op < 1 ? [{ type: 'solid', color: c.slice(0, 7), opacity: op }] : c;
}

function styleProps(s, ids, scale) {
  const op = s.opacity != null ? parseFloat(s.opacity) : 1;
  const fill = s.fill === undefined ? '#000000' : paintFrom(s.fill, ids, parseFloat(s['fill-opacity'] ?? '1'));
  const stroke = s.stroke === undefined ? null : paintFrom(s.stroke, ids, parseFloat(s['stroke-opacity'] ?? '1'));
  const p = { fill: fill ?? null, stroke: stroke ?? null, strokeWidth: stroke ? Math.round(len(s['stroke-width'] ?? '1') * scale * 100) / 100 : 1 };
  if (op < 1) p.opacity = op;
  if (s['fill-rule'] === 'evenodd') p.fillRule = 'evenodd';
  if (s['stroke-linecap']) p.strokeCap = s['stroke-linecap'];
  if (s['stroke-linejoin']) p.strokeJoin = s['stroke-linejoin'];
  if (s['stroke-dasharray'] && s['stroke-dasharray'] !== 'none') p.dash = s['stroke-dasharray'].split(/[\s,]+/).map(Number).filter(Number.isFinite).map((v) => v * scale);
  if (s.display === 'none' || s.visibility === 'hidden') p.visible = false;
  return p;
}

const scaleOf = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
const isAxisAligned = (m) => Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && m[0] > 0 && m[3] > 0;

function walkKids(el, m, style, ids, vp) {
  const out = [];
  for (const c of el.children) if (c.tag) { const r = walk(c, m, style, ids, vp); if (r) out.push(r); }
  return out;
}

function walk(el, parentM, parentStyle, ids, vp) {
  if (--vp.budget < 0) throw new Error('The SVG is too complex to import (over 20,000 elements after <use> expansion)');
  if (['defs', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'pattern', 'symbol', 'style', 'title', 'desc', 'metadata', 'marker', 'filter'].includes(el.tag)) return null;
  const m = mul(parentM, parseTransform(el.attrs.transform));
  const s = inheritStyle(parentStyle, el);
  const name = el.attrs.id || el.attrs['inkscape:label'] || null;
  const a = el.attrs;
  const sp = () => styleProps(s, ids, scaleOf(m));
  const vector = (d, typeName) => {
    const wd = serialize(mapPoints(parsePath(d), ([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]));
    if (!wd) return null;
    return { type: 'vector', name: name || typeName, props: { ...fitVector(wd), ...sp() } };
  };
  switch (el.tag) {
    case 'g': case 'svg': case 'a': case 'switch': {
      const kids = walkKids(el, el.tag === 'svg' && el !== null ? m : m, s, ids, vp);
      if (!kids.length) return null;
      return { type: 'group', name: name || 'Group', props: s.opacity != null && parseFloat(s.opacity) < 1 ? { opacity: parseFloat(s.opacity) } : {}, children: kids };
    }
    case 'use': {
      const ref = ids[(a.href || a['xlink:href'] || '').replace(/^#/, '')];
      // A <use> may not reach itself or nest past 16 levels.
      if (!ref || vp.stack.has(ref) || vp.stack.size >= 16) return null;
      vp.stack.add(ref);
      try { return walk(ref, mul(m, [1, 0, 0, 1, len(a.x), len(a.y)]), s, ids, vp); } finally { vp.stack.delete(ref); }
    }
    case 'rect': {
      const x = len(a.x, vp.w), y = len(a.y, vp.h), w = len(a.width, vp.w), h = len(a.height, vp.h);
      if (!(w > 0 && h > 0)) return null;
      const rx = len(a.rx ?? a.ry), ry = len(a.ry ?? a.rx);
      if (isAxisAligned(m) && Math.abs(rx - ry) < 1e-9) {
        return { type: 'rect', name: name || 'Rectangle', props: { x: m[0] * x + m[4], y: m[3] * y + m[5], w: w * m[0], h: h * m[3], radius: rx * m[0], ...sp() } };
      }
      const d = rx || ry ? `M${x + rx} ${y} H${x + w - rx} A${rx} ${ry} 0 0 1 ${x + w} ${y + ry} V${y + h - ry} A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h} H${x + rx} A${rx} ${ry} 0 0 1 ${x} ${y + h - ry} V${y + ry} A${rx} ${ry} 0 0 1 ${x + rx} ${y} Z` : `M${x} ${y} H${x + w} V${y + h} H${x} Z`;
      return vector(d, 'Rectangle');
    }
    case 'circle': case 'ellipse': {
      const cx = len(a.cx, vp.w), cy = len(a.cy, vp.h);
      const rx = el.tag === 'circle' ? len(a.r) : len(a.rx), ry = el.tag === 'circle' ? len(a.r) : len(a.ry);
      if (!(rx > 0 && ry > 0)) return null;
      if (isAxisAligned(m)) return { type: 'ellipse', name: name || 'Ellipse', props: { x: m[0] * (cx - rx) + m[4], y: m[3] * (cy - ry) + m[5], w: 2 * rx * m[0], h: 2 * ry * m[3], ...sp() } };
      return vector(`M${cx + rx} ${cy} A${rx} ${ry} 0 1 1 ${cx - rx} ${cy} A${rx} ${ry} 0 1 1 ${cx + rx} ${cy} Z`, 'Ellipse');
    }
    case 'line': {
      const v = vector(`M${len(a.x1)} ${len(a.y1)} L${len(a.x2)} ${len(a.y2)}`, 'Line');
      if (v) { v.props.fill = null; if (!v.props.stroke) v.props.stroke = '#000000'; }
      return v;
    }
    case 'polyline': case 'polygon': {
      const pts = String(a.points || '').trim().split(/[\s,]+/).map(Number);
      if (pts.length < 4) return null;
      let d = `M${pts[0]} ${pts[1]}`;
      for (let i = 2; i + 1 < pts.length; i += 2) d += ` L${pts[i]} ${pts[i + 1]}`;
      if (el.tag === 'polygon') d += ' Z';
      const v = vector(d, el.tag === 'polygon' ? 'Polygon' : 'Polyline');
      if (v && el.tag === 'polyline' && s.fill === undefined) v.props.fill = null;
      return v;
    }
    case 'path': return a.d ? vector(a.d, 'Path') : null;
    case 'text': {
      const text = textOf(el);
      if (!text.trim()) return null;
      const size = len(s['font-size'] ?? '16') * scaleOf(m);
      const x = len(a.x), y = len(a.y);
      const px = m[0] * x + m[2] * y + m[4], py = m[1] * x + m[3] * y + m[5];
      const anchor = s['text-anchor'];
      const p = sp();
      return {
        type: 'text', name: name || text.slice(0, 40),
        props: { text, x: px, y: py - size * 0.8, fontSize: Math.round(size * 100) / 100, fontFamily: (s['font-family'] || 'Inter').split(',')[0].replace(/['"]/g, '').trim(), fontWeight: s['font-weight'] === 'bold' ? 700 : parseInt(s['font-weight'] || '400', 10) || 400, fill: p.fill ?? '#000000', align: anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left', anchorX: anchor },
      };
    }
    case 'image': {
      const href = a.href || a['xlink:href'] || '';
      const mm = href.match(/^data:(image\/(?:png|jpeg|gif|webp|avif));base64,([A-Za-z0-9+/]*={0,2})$/);
      if (!mm) return null;
      const x = len(a.x), y = len(a.y), w = len(a.width), h = len(a.height);
      return { type: 'image', name: name || 'Image', props: { x: m[0] * x + m[4], y: m[3] * y + m[5], w: w * m[0], h: h * m[3] }, asset: { mime: mm[1], data: mm[2], w, h } };
    }
    default: return null;
  }
}
function textOf(el) { return (el.children || []).map((c) => (c.text != null ? c.text : textOf(c))).join('').replace(/\s+/g, ' ').trim(); }

// Bounds of a spec in SVG root coordinates.
export function specBounds(sp) {
  if (sp.type === 'group') {
    const bs = sp.children.map(specBounds).filter(Boolean);
    if (!bs.length) return null;
    const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
    return { x: x0, y: y0, w: Math.max(...bs.map((b) => b.x + b.w)) - x0, h: Math.max(...bs.map((b) => b.y + b.h)) - y0 };
  }
  return { x: sp.props.x, y: sp.props.y, w: sp.props.w || 0, h: sp.props.h || 0 };
}
export { boundsOf };
