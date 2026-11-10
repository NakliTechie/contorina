import { textOf, fontString } from './styles.js';

let ctx;
function measureCtx() {
  if (ctx !== undefined) return ctx;
  try {
    ctx = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1).getContext('2d') : null;
  } catch {
    ctx = null;
  }
  return ctx;
}

const widthCache = new Map();
export function textWidth(font, size, s) {
  const key = font + '\u0000' + s;
  let w = widthCache.get(key);
  if (w === undefined) {
    const c = measureCtx();
    if (c) { c.font = font; w = c.measureText(s).width; } else w = s.length * size * 0.55; // Node fallback for tests
    if (widthCache.size > 20000) widthCache.clear();
    widthCache.set(key, w);
  }
  return w;
}

// Break text into lines. wrapWidth = null means only explicit newlines break.
export function breakLines(t, wrapWidth) {
  const font = fontString(t);
  const out = [];
  for (const para of String(t.text ?? '').split('\n')) {
    if (wrapWidth == null) { out.push(para); continue; }
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const next = line + w;
      if (line && textWidth(font, t.fontSize, next.trimEnd()) > wrapWidth) {
        out.push(line.trimEnd());
        line = w.trimStart();
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

const layoutCache = new Map();
export function textLayout(n, styles) {
  const t = textOf(n, styles);
  const mode = n.autoSize || 'width';
  const wrap = mode === 'width' ? null : n.w;
  const key = `${t.fontWeight}|${t.fontSize}|${t.fontFamily}|${t.lineHeight}|${wrap}|${t.text}`;
  let r = layoutCache.get(key);
  if (!r) {
    const lines = breakLines(t, wrap);
    const font = fontString(t);
    const lh = t.fontSize * (t.lineHeight || 1.25);
    const w = Math.ceil(Math.max(1, ...lines.map((l) => textWidth(font, t.fontSize, l))));
    r = { lines, lh, font, w, h: Math.ceil(lines.length * lh) };
    if (layoutCache.size > 5000) layoutCache.clear();
    layoutCache.set(key, r);
  }
  return r;
}

// Resolve pass: size auto-sized text nodes from their content.
export function measureTexts(tx) {
  const nodes = tx.doc.nodes;
  for (const id in nodes) {
    const n = nodes[id];
    if (n.type !== 'text') continue;
    let mode = n.autoSize || 'width';
    const p = n.parent && nodes[n.parent];
    if (mode === 'width' && n.sizing && n.sizing.h === 'fill' && p && p.layout && p.layout.mode !== 'none') mode = 'height';
    if (mode === 'fixed') continue;
    const L = textLayout(mode === n.autoSize ? n : { ...n, autoSize: mode }, tx.doc.styles);
    const patch = {};
    if (mode === 'width' && n.w !== L.w) patch.w = L.w;
    if (n.h !== L.h) patch.h = L.h;
    if (patch.w !== undefined || patch.h !== undefined) tx.set(id, patch);
  }
}
