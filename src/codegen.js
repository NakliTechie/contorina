// Inspect and code export: CSS for one layer; HTML/CSS and React for a frame. Pure (no DOM).
// Auto layout becomes flexbox; plain frames position their children absolutely; vectors become SVG.
import { fillOf, strokeOf, textOf, fontStack } from './styles.js';
import { paints, firstColor } from './paint.js';
import { hasLayout } from './doc.js';
import { toSVG } from './export.js';
import { radii } from './render.js';

const px = (v) => `${Math.round(v * 100) / 100}px`;
const JUST = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between' };
const ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' };

function paintCSS(v, doc) {
  const layers = [];
  for (const p of paints(v).slice().reverse()) { // CSS lists the top layer first
    const stops = (p.stops || []).map((s) => `${s.color} ${Math.round(s.pos * 100)}%`).join(', ');
    if (p.type === 'solid') layers.push({ color: p.color });
    else if (p.type === 'linear') layers.push({ image: `linear-gradient(${Math.round(((p.angle ?? 90) + 90) * 100) / 100}deg, ${stops})` });
    else if (p.type === 'radial' || p.type === 'diamond') layers.push({ image: `radial-gradient(ellipse at ${Math.round((p.cx ?? 0.5) * 100)}% ${Math.round((p.cy ?? 0.5) * 100)}%, ${stops})` });
    else if (p.type === 'angular') layers.push({ image: `conic-gradient(from ${Math.round(((p.angle || 0) + 90) * 100) / 100}deg at ${Math.round((p.cx ?? 0.5) * 100)}% ${Math.round((p.cy ?? 0.5) * 100)}%, ${stops})` });
    else if (p.type === 'image' && doc.assets && doc.assets[p.asset]) layers.push({ image: `url(data:${doc.assets[p.asset].mime};base64,${doc.assets[p.asset].data})`, size: p.mode === 'fit' ? 'contain' : p.mode === 'tile' ? 'auto' : 'cover' });
  }
  // A solid under gradients becomes the background colour; any other solid becomes a flat gradient.
  const out = {};
  const imgs = [];
  layers.forEach((l, i) => {
    if (l.color && i === layers.length - 1) out['background-color'] = l.color;
    else if (l.color) imgs.push(`linear-gradient(${l.color}, ${l.color})`);
    else imgs.push(l.image);
  });
  if (imgs.length) out['background-image'] = imgs.join(', ');
  const img = paints(v).find((p) => p.type === 'image');
  if (img) { out['background-size'] = img.mode === 'fit' ? 'contain' : img.mode === 'tile' ? 'auto' : 'cover'; out['background-position'] = 'center'; out['background-repeat'] = img.mode === 'tile' ? 'repeat' : 'no-repeat'; }
  return out;
}

// CSS declarations for one layer, as an ordered object. parent: the parent node or null.
export function cssFor(doc, id, { root = false } = {}) {
  const n = doc.nodes[id];
  const p = n.parent ? doc.nodes[n.parent] : null;
  const css = {};
  const inFlow = p && hasLayout(p) && !n.absolute;
  if (!root && !inFlow) { css.position = 'absolute'; css.left = px(n.x); css.top = px(n.y); }
  const sz = n.sizing || {};
  const row = inFlow && p.layout.mode === 'row';
  const wMode = n.type === 'text' && n.autoSize === 'width' ? 'hug' : sz.h || 'fixed';
  const hMode = n.type === 'text' && n.autoSize !== 'fixed' ? 'hug' : sz.v || 'fixed';
  if (wMode === 'fill' && inFlow) { if (row) css.flex = '1 0 0'; else css['align-self'] = 'stretch'; } else if (wMode !== 'hug') css.width = px(n.w);
  if (hMode === 'fill' && inFlow) { if (!row) css.flex = '1 0 0'; else css['align-self'] = 'stretch'; } else if (hMode !== 'hug') css.height = px(n.h);
  if (hasLayout(n)) {
    const L = n.layout;
    css.display = 'flex';
    css['flex-direction'] = L.mode === 'row' ? 'row' : 'column';
    if (L.wrap) css['flex-wrap'] = 'wrap';
    css['justify-content'] = JUST[L.justify] || 'flex-start';
    css['align-items'] = ALIGN[L.align] || 'flex-start';
    if (L.gap) css.gap = L.wrap && L.crossGap != null && L.crossGap !== L.gap ? `${px(L.crossGap)} ${px(L.gap)}` : px(L.gap);
    const pd = L.pad || [0, 0, 0, 0];
    if (pd.some(Boolean)) css.padding = pd.map(px).join(' ');
  } else if (n.children && n.children.length) css.position = css.position || 'relative';
  if (n.rotation) css.transform = `rotate(${Math.round(n.rotation * 100) / 100}deg)`;
  if (n.opacity != null && n.opacity < 1) css.opacity = String(Math.round(n.opacity * 1000) / 1000);
  if (n.blendMode && n.blendMode !== 'normal' && n.blendMode !== 'pass') css['mix-blend-mode'] = n.blendMode;
  const fill = fillOf(n, doc.styles), stroke = strokeOf(n, doc.styles);
  if (n.type === 'text') {
    const t = textOf(n, doc.styles);
    const col = firstColor(fill);
    if (col) css.color = col;
    css['font-family'] = fontStack(t.fontFamily);
    css['font-size'] = px(t.fontSize);
    css['font-weight'] = String(t.fontWeight || 400);
    css['line-height'] = px(t.fontSize * (t.lineHeight || 1.25));
    if (t.align && t.align !== 'left') css['text-align'] = t.align;
    if (t.letterSpacing) css['letter-spacing'] = px(t.letterSpacing);
    if (t.decoration === 'underline') css['text-decoration'] = 'underline';
    if (t.decoration === 'strike') css['text-decoration'] = 'line-through';
    if (t.textCase === 'upper') css['text-transform'] = 'uppercase';
    if (t.textCase === 'lower') css['text-transform'] = 'lowercase';
    css['white-space'] = n.autoSize === 'width' ? 'pre' : 'pre-wrap';
  } else if (n.type !== 'vector' && n.type !== 'polygon' && n.type !== 'star' && n.type !== 'line') {
    Object.assign(css, paintCSS(fill, doc));
    const r = radii(n);
    if (n.type === 'ellipse') css['border-radius'] = '50%';
    else if (Array.isArray(r) ? r.some(Boolean) : r) css['border-radius'] = Array.isArray(r) ? r.map(px).join(' ') : px(r);
    if (stroke && n.strokeWidth > 0) {
      const color = firstColor(stroke);
      const style = n.dash && n.dash.length ? 'dashed' : 'solid';
      if (n.strokeAlign === 'outside') css.outline = `${px(n.strokeWidth)} ${style} ${color}`;
      else css.border = `${px(n.strokeWidth)} ${style} ${color}`;
      css['box-sizing'] = 'border-box';
    }
    if ((n.type === 'frame' || n.type === 'instance') && n.clip !== false && n.children && n.children.length) css.overflow = 'hidden';
  }
  const shadows = [], filters = [];
  for (const e of n.effects || []) {
    if (e.visible === false) continue;
    if (e.type === 'drop') shadows.push(`${px(e.x || 0)} ${px(e.y || 0)} ${px(e.blur || 0)} ${px(e.spread || 0)} ${e.color || 'rgba(0,0,0,0.25)'}`);
    if (e.type === 'inner') shadows.push(`inset ${px(e.x || 0)} ${px(e.y || 0)} ${px(e.blur || 0)} 0 ${e.color || 'rgba(0,0,0,0.25)'}`);
    if (e.type === 'blur') filters.push(`blur(${px(e.radius || 0)})`);
    if (e.type === 'bgblur') css['backdrop-filter'] = `blur(${px(e.radius || 0)})`;
  }
  if (shadows.length) css[n.type === 'text' ? 'text-shadow' : 'box-shadow'] = n.type === 'text' ? shadows.filter((s) => !s.startsWith('inset')).map((s) => s.split(' ').filter((_, i) => i !== 3).join(' ')).join(', ') : shadows.join(', ');
  if (filters.length) css.filter = filters.join(' ');
  return css;
}

export const cssText = (css, indent = '') => Object.entries(css).map(([k, v]) => `${indent}${k}: ${v};`).join('\n');
const cls = (n, used) => {
  let base = String(n.name || n.type).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || n.type;
  if (/^[0-9]/.test(base)) base = 'l-' + base;
  let c = base, k = 2;
  while (used.has(c)) c = `${base}-${k++}`;
  used.add(c);
  return c;
};
const escHTML = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function toHTML(doc, ids) {
  const used = new Set();
  const rules = [];
  const walk = (id, depth, root) => {
    const n = doc.nodes[id];
    if (!n || n.visible === false) return '';
    const c = cls(n, used);
    const pad = '  '.repeat(depth);
    if (n.type === 'vector' || n.type === 'polygon' || n.type === 'star' || n.type === 'line') {
      rules.push(`.${c} {\n${cssText(cssFor(doc, id, { root }), '  ')}\n}`);
      const svg = toSVG({ ...doc, children: [id] }, [id]).trim().replace(/\n/g, '');
      return `${pad}<div class="${c}">${svg}</div>`;
    }
    rules.push(`.${c} {\n${cssText(cssFor(doc, id, { root }), '  ')}\n}`);
    if (n.type === 'text') return `${pad}<p class="${c}">${escHTML(n.text)}</p>`;
    const kids = (n.children || []).map((k) => walk(k, depth + 1, false)).filter(Boolean);
    return kids.length ? `${pad}<div class="${c}">\n${kids.join('\n')}\n${pad}</div>` : `${pad}<div class="${c}"></div>`;
  };
  const list = (ids && ids.length ? ids : doc.children).filter((id) => doc.nodes[id]);
  const body = list.map((id) => walk(id, 1, true)).join('\n');
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>${escHTML(doc.nodes[list[0]]?.name || doc.name)}</title>\n<style>\n* { box-sizing: border-box; margin: 0; }\n${rules.join('\n')}\n</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

const camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
export function toReact(doc, ids) {
  const list = (ids && ids.length ? ids : doc.children).filter((id) => doc.nodes[id]);
  const comp = (String(doc.nodes[list[0]]?.name || 'Design').replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^[a-z]/, (c) => c.toUpperCase()) || 'Design').replace(/^[0-9]/, 'D$&');
  const walk = (id, depth, root) => {
    const n = doc.nodes[id];
    if (!n || n.visible === false) return '';
    const pad = '  '.repeat(depth);
    const style = Object.entries(cssFor(doc, id, { root })).map(([k, v]) => `${camel(k)}: ${JSON.stringify(v)}`).join(', ');
    if (n.type === 'vector' || n.type === 'polygon' || n.type === 'star' || n.type === 'line') {
      const svg = toSVG({ ...doc, children: [id] }, [id]).trim().replace(/\n/g, '');
      return `${pad}<div style={{ ${style} }} dangerouslySetInnerHTML={{ __html: ${JSON.stringify(svg)} }} />`;
    }
    if (n.type === 'text') return `${pad}<p style={{ ${style} }}>{${JSON.stringify(n.text)}}</p>`;
    const kids = (n.children || []).map((k) => walk(k, depth + 1, false)).filter(Boolean);
    return kids.length ? `${pad}<div style={{ ${style} }}>\n${kids.join('\n')}\n${pad}</div>` : `${pad}<div style={{ ${style} }} />`;
  };
  const inner = list.length === 1 ? walk(list[0], 2, true) : `    <>\n${list.map((id) => walk(id, 3, true)).join('\n')}\n    </>`;
  return `export default function ${comp}() {\n  return (\n${inner}\n  );\n}\n`;
}
