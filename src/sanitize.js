// Cleaning rules for values that reach the renderer and every exporter: paints, effects, style runs and
// styles. Loading a document and every command that writes these values go through them, so a hostile
// file or agent call cannot break rendering or smuggle text into exported CSS and SVG. Invalid entries
// are dropped; numbers are made finite and clamped.
const HEX = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR = /^(#([0-9a-f]{3,8})|rgba?\(\s*[\d.\s,%/]+\))$/i;
const num = (v, d, lo = -Infinity, hi = Infinity) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
const BLENDS = new Set(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']);

function cleanStops(stops) {
  const out = (Array.isArray(stops) ? stops : []).filter((s) => s && typeof s.color === 'string' && COLOR.test(s.color)).slice(0, 32).map((s) => ({ pos: num(s.pos, 0, 0, 1), color: s.color }));
  return out.length ? out : [{ pos: 0, color: '#000000' }, { pos: 1, color: '#FFFFFF' }];
}
function cleanOnePaint(p) {
  if (typeof p === 'string') return COLOR.test(p) ? p : null;
  if (!p || typeof p !== 'object') return null;
  const base = {};
  if (p.opacity != null) base.opacity = num(p.opacity, 1, 0, 1);
  if (p.blend && BLENDS.has(p.blend)) base.blend = p.blend;
  if (p.visible === false) base.visible = false;
  switch (p.type) {
    case 'solid': return typeof p.color === 'string' && COLOR.test(p.color) ? { type: 'solid', color: p.color, ...base } : null;
    case 'linear': return { type: 'linear', angle: num(p.angle, 90, -3600, 3600), stops: cleanStops(p.stops), ...base };
    case 'radial': case 'diamond': return { type: p.type, cx: num(p.cx, 0.5, -10, 10), cy: num(p.cy, 0.5, -10, 10), r: num(p.r, 0.5, 0, 50), stops: cleanStops(p.stops), ...base };
    case 'angular': return { type: 'angular', cx: num(p.cx, 0.5, -10, 10), cy: num(p.cy, 0.5, -10, 10), angle: num(p.angle, 0, -3600, 3600), stops: cleanStops(p.stops), ...base };
    case 'image': return typeof p.asset === 'string' ? { type: 'image', asset: p.asset, mode: ['fill', 'fit', 'crop', 'tile'].includes(p.mode) ? p.mode : 'fill', ...(p.scale != null ? { scale: num(p.scale, 1, 0.01, 100) } : {}), ...(p.ox != null ? { ox: num(p.ox, 0, -10, 10) } : {}), ...(p.oy != null ? { oy: num(p.oy, 0, -10, 10) } : {}), ...base } : null;
    default: return null;
  }
}
export function cleanPaint(v) {
  if (v == null) return v;
  if (Array.isArray(v)) { const out = v.map(cleanOnePaint).filter((x) => x != null).slice(0, 16); return out.length ? out : null; }
  return cleanOnePaint(v);
}

export function cleanEffects(list) {
  if (list == null) return list;
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const e of list.slice(0, 16)) {
    if (!e || typeof e !== 'object') continue;
    const vis = e.visible === false ? { visible: false } : {};
    const color = typeof e.color === 'string' && COLOR.test(e.color) ? e.color : '#00000040';
    if (e.type === 'drop' || e.type === 'inner') out.push({ type: e.type, x: num(e.x, 0, -1e4, 1e4), y: num(e.y, 0, -1e4, 1e4), blur: num(e.blur, 0, 0, 1000), ...(e.type === 'drop' ? { spread: num(e.spread, 0, -1000, 1000) } : {}), color, ...vis });
    else if (e.type === 'blur' || e.type === 'bgblur') out.push({ type: e.type, radius: num(e.radius, 0, 0, 1000), ...vis });
    else if (e.type === 'glass') out.push({ type: 'glass', radius: num(e.radius, 16, 0, 1000), tint: num(e.tint, 0.15, 0, 1), highlight: num(e.highlight, 0.6, 0, 1), ...vis });
    else if (e.type === 'noise') out.push({ type: 'noise', amount: num(e.amount, 0.15, 0, 1), size: Math.round(num(e.size, 1, 1, 16)), ...(e.mono === false ? { mono: false } : {}), ...vis });
  }
  return out;
}

export function cleanRuns(runs, textLength) {
  if (runs == null) return runs;
  if (!Array.isArray(runs)) return undefined;
  const out = [];
  for (const r of runs.slice(0, 2000)) {
    if (!r || typeof r !== 'object' || !r.style || typeof r.style !== 'object') continue;
    const start = Math.max(0, Math.min(textLength, Math.floor(num(r.start, 0)))), end = Math.max(start, Math.min(textLength, Math.floor(num(r.end, 0))));
    if (end <= start) continue;
    const st = {};
    const s = r.style;
    if (s.fontWeight != null) st.fontWeight = Math.round(num(s.fontWeight, 400, 1, 1000));
    if (s.fontSize != null) st.fontSize = num(s.fontSize, 16, 0.5, 2000);
    if (s.italic === true) st.italic = true;
    if (s.decoration === 'underline' || s.decoration === 'strike') st.decoration = s.decoration;
    if (typeof s.fill === 'string' && HEX.test(s.fill)) st.fill = s.fill;
    if (Object.keys(st).length) out.push({ start, end, style: st });
  }
  return out.length ? out : undefined;
}

export function cleanStyle(s) {
  if (!s || typeof s !== 'object') return null;
  const name = String(s.name || 'Style').slice(0, 200);
  if (s.type === 'color') { const value = cleanPaint(s.value); return value == null ? null : { type: 'color', name, value }; }
  if (s.type === 'text') return { type: 'text', name, fontSize: num(s.fontSize, 16, 0.5, 2000), fontFamily: typeof s.fontFamily === 'string' ? s.fontFamily.slice(0, 100) : 'Inter', fontWeight: Math.round(num(s.fontWeight, 400, 1, 1000)), lineHeight: num(s.lineHeight, 1.25, 0.1, 10) };
  if (s.type === 'effect') return { type: 'effect', name, effects: cleanEffects(s.effects) || [] };
  if (s.type === 'grid') return { type: 'grid', name, grids: (Array.isArray(s.grids) ? s.grids : []).filter((g) => g && typeof g === 'object').slice(0, 8).map((g) => ({ type: ['columns', 'rows', 'grid'].includes(g.type) ? g.type : 'columns', count: Math.round(num(g.count, 12, 1, 200)), gutter: num(g.gutter, 20, 0, 1e4), margin: num(g.margin, 20, 0, 1e4), size: num(g.size, 8, 2, 1e4), ...(typeof g.color === 'string' && COLOR.test(g.color) ? { color: g.color } : {}) })) };
  return null;
}

export const isFontFamily = (f) => typeof f === 'string' && /^[\w \-]{1,100}$/.test(f);
