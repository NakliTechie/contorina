import { textOf, fontString, fontStack } from './styles.js';

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
// Lay out a text layer. Without style runs the result is { lines: [string], lh, font, w, h }. With
// runs it also carries rich: [{ pieces: [{ text, font, size, fill, decoration, x, w }], w, lh, y }], so
// every renderer can draw the pieces; `lines` stays plain text for formats with one style per line.
export function textLayout(n, styles) {
  const t = textOf(n, styles);
  const mode = n.autoSize || 'width';
  const wrap = mode === 'width' ? null : n.w;
  const runsKey = n.runs && n.runs.length ? JSON.stringify(n.runs) : '';
  const key = `${t.fontWeight}|${t.fontSize}|${t.fontFamily}|${t.lineHeight}|${t.letterSpacing || 0}|${t.textCase || ''}|${wrap}|${runsKey}|${t.text}`;
  let r = layoutCache.get(key);
  if (!r) {
    r = runsKey ? richLayout(t, n.runs, wrap) : plainLayout(t, wrap);
    if (layoutCache.size > 5000) layoutCache.clear();
    layoutCache.set(key, r);
  }
  return r;
}
const caseOf = (t, s) => (t.textCase === 'upper' ? s.toUpperCase() : t.textCase === 'lower' ? s.toLowerCase() : s);
function plainLayout(t, wrap) {
  const lines = breakLines({ ...t, text: caseOf(t, String(t.text ?? '')) }, wrap);
  const font = fontString(t);
  const lh = t.fontSize * (t.lineHeight || 1.25);
  const w = Math.ceil(Math.max(1, ...lines.map((l) => textWidth(font, t.fontSize, l) + (t.letterSpacing || 0) * l.length)));
  return { lines, lh, font, w, h: Math.ceil(lines.length * lh) };
}

// Style of each character: the layer's style patched by every run that covers it.
export function styleAt(t, runs, i) {
  let s = { fontWeight: t.fontWeight, fontSize: t.fontSize, italic: !!t.italic, fill: null, decoration: t.decoration || null };
  for (const r of runs) if (i >= r.start && i < r.end) s = { ...s, ...r.style };
  return s;
}
const fontOf = (t, s) => `${t.textCase === 'smallcaps' ? 'small-caps ' : ''}${s.italic ? 'italic ' : ''}${s.fontWeight || 400} ${s.fontSize}px ${fontStack(t.fontFamily)}`;

function richLayout(t, runs, wrap) {
  const text = caseOf(t, String(t.text ?? ''));
  // Split into atoms: maximal stretches with one style and one kind (word, space or newline).
  const atoms = [];
  let cur = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const kind = ch === '\n' ? 'nl' : /\s/.test(ch) ? 'sp' : 'w';
    const st = styleAt(t, runs, i);
    const sk = JSON.stringify(st);
    if (cur && cur.kind === kind && cur.sk === sk && kind !== 'nl') cur.text += ch;
    else { cur = { kind, text: ch, st, sk }; atoms.push(cur); }
  }
  const widthOf = (a) => textWidth(fontOf(t, a.st), a.st.fontSize, a.text) + (t.letterSpacing || 0) * a.text.length;
  const lines = [[]];
  let lineW = 0;
  // Words are runs of 'w' atoms with no space between; they wrap as a unit.
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    if (a.kind === 'nl') { lines.push([]); lineW = 0; continue; }
    if (a.kind === 'w' && wrap != null) {
      let j = i, ww = 0;
      while (j < atoms.length && atoms[j].kind === 'w') ww += widthOf(atoms[j++]);
      if (lineW > 0 && lineW + ww > wrap) {
        const line = lines[lines.length - 1];
        while (line.length && line[line.length - 1].kind === 'sp') line.pop();
        lines.push([]);
        lineW = 0;
      }
      for (let k = i; k < j; k++) { lines[lines.length - 1].push(atoms[k]); lineW += widthOf(atoms[k]); }
      i = j - 1;
      continue;
    }
    if (a.kind === 'sp' && lineW === 0 && lines.length > 1 && wrap != null) continue; // no leading space after a wrap
    lines[lines.length - 1].push(a);
    lineW += widthOf(a);
  }
  const base = t.fontSize * (t.lineHeight || 1.25);
  let y = 0;
  const rich = lines.map((atomsInLine) => {
    const maxSize = Math.max(t.fontSize, ...atomsInLine.map((a) => a.st.fontSize));
    const lh = base * (maxSize / t.fontSize);
    let x = 0;
    const pieces = atomsInLine.map((a) => { const w = widthOf(a); const p = { text: a.text, font: fontOf(t, a.st), size: a.st.fontSize, fill: a.st.fill, decoration: a.st.decoration, x, w }; x += w; return p; });
    const line = { pieces, w: x, lh, y };
    y += lh;
    return line;
  });
  const plain = rich.map((l) => l.pieces.map((p) => p.text).join(''));
  return { lines: plain, rich, lh: base, font: fontString(t), w: Math.ceil(Math.max(1, ...rich.map((l) => l.w))), h: Math.ceil(y) };
}

// Keep style runs attached to their characters when text is edited: find the changed middle by common
// prefix and suffix, shift runs after it, stretch runs that cover it.
export function shiftRuns(runs, oldText, newText) {
  if (!runs || !runs.length) return runs;
  let pre = 0;
  while (pre < oldText.length && pre < newText.length && oldText[pre] === newText[pre]) pre++;
  let suf = 0;
  while (suf < oldText.length - pre && suf < newText.length - pre && oldText[oldText.length - 1 - suf] === newText[newText.length - 1 - suf]) suf++;
  const oldEnd = oldText.length - suf, delta = newText.length - oldText.length;
  const out = [];
  for (const r of runs) {
    let { start, end } = r;
    if (start >= oldEnd) { start += delta; end += delta; }
    else if (end > pre) { end = Math.max(start, end >= oldEnd ? end + delta : Math.min(end, pre)); if (start > pre) start = pre; }
    start = Math.max(0, Math.min(start, newText.length)); end = Math.max(start, Math.min(end, newText.length));
    if (end > start) out.push({ ...r, start, end });
  }
  return out;
}

// Apply a style patch to [start, end): split runs at the edges, patch the covered pieces, merge
// neighbours with equal styles. A key set to null removes that key from the covered runs.
export function styleRange(runs, start, end, patch) {
  const cuts = new Set([start, end]);
  for (const r of runs || []) { cuts.add(r.start); cuts.add(r.end); }
  const points = [...cuts].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i], b = points[i + 1];
    let st = {};
    for (const r of runs || []) if (a >= r.start && b <= r.end) st = { ...st, ...r.style };
    if (a >= start && b <= end) { st = { ...st, ...patch }; for (const k in st) if (st[k] === null) delete st[k]; }
    if (Object.keys(st).length) {
      const last = out[out.length - 1];
      if (last && last.end === a && JSON.stringify(last.style) === JSON.stringify(st)) last.end = b;
      else out.push({ start: a, end: b, style: st });
    }
  }
  return out;
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
