// Paint list editor (fills and strokes) and effects editor for the properties panel.
import { h } from './dom.js';
import { numberField } from './numfield.js';
import { paints, defaultPaint, PAINT_TYPES, BLEND_MODES } from '../paint.js';

const TYPE_LABEL = { solid: 'Solid', linear: 'Linear', radial: 'Radial', angular: 'Angular', diamond: 'Diamond', image: 'Image' };

// Store a list in its simplest form: one plain solid paint is a hex string; an empty list is null.
export function compact(list) {
  if (!list.length) return null;
  if (list.length === 1 && list[0].type === 'solid' && list[0].opacity == null && (!list[0].blend || list[0].blend === 'normal')) return list[0].color;
  return list;
}

const colorInput = (value, onInput, onChange, label) => {
  const c = h('input', { type: 'color', value: /^#[0-9a-f]{6}/i.test(value || '') ? value.slice(0, 7) : '#000000', 'aria-label': label });
  c.addEventListener('input', () => onInput(c.value.toUpperCase()));
  c.addEventListener('change', () => onChange(c.value.toUpperCase()));
  return c;
};
const sel = (value, options, onChange, label) => {
  const s = h('select', { 'aria-label': label, on: { change: () => onChange(s.value) } }, options.map(([v, l]) => h('option', { value: v }, l)));
  s.value = value;
  return s;
};
const btn = (label, title, fn) => h('button.ps-btn', { type: 'button', title, on: { click: fn } }, label);

// value: the layer's fill (any paint form); apply(newValue, phase); fields: array to push number fields into.
export function paintList({ get, apply, fields, app, kind }) {
  const value = get();
  const list = () => paints(get()).map((p) => ({ ...p }));
  const set = (next, phase = 'commit') => apply(compact(next), phase);
  const rows = list().map((p, i) => {
    const update = (patch, phase) => { const l = list(); l[i] = { ...l[i], ...patch }; set(l, phase); };
    const head = h('div.ps-row',
      sel(p.type, PAINT_TYPES.map((t) => [t, TYPE_LABEL[t]]), (t) => { const l = list(); l[i] = defaultPaint(t, l[i]); set(l); }, `${kind} ${i + 1} type`),
      btn('−', `Remove this ${kind}`, () => { const l = list(); l.splice(i, 1); set(l); }));
    const body = [];
    if (p.type === 'solid') {
      const hex = h('input.hex', { type: 'text', value: p.color, spellcheck: false, 'aria-label': `${kind} hex`, on: { keydown: (e) => e.stopPropagation() } });
      hex.addEventListener('change', () => {
        let v = hex.value.trim();
        if (/^[0-9a-f]{3,8}$/i.test(v)) v = '#' + v;
        if (/^#[0-9a-f]{3}$/i.test(v)) v = '#' + v.slice(1).split('').map((c) => c + c).join('');
        if (/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) update({ color: v.toUpperCase() }); else hex.classList.add('bad');
      });
      body.push(h('div.ps-row', colorInput(p.color, (v) => { hex.value = v; update({ color: v }, 'preview'); }, (v) => update({ color: v }), `${kind} colour`), hex));
    } else if (p.type === 'image') {
      body.push(h('div.ps-row',
        btn(p.asset ? 'Replace image' : 'Choose image', 'Pick an image file', async () => {
          const input = h('input', { type: 'file', accept: 'image/*' });
          input.onchange = async () => {
            if (!input.files[0]) return;
            const img = await app.readImage(input.files[0]);
            const asset = app.run('asset.add', img);
            update({ asset });
          };
          input.click();
        }),
        sel(p.mode || 'fill', [['fill', 'Fill'], ['fit', 'Fit'], ['crop', 'Crop'], ['tile', 'Tile']], (v) => update({ mode: v }), 'Image mode')));
      if (p.mode === 'tile' || p.mode === 'crop') {
        const f = numberField({ label: 'Sc', title: 'Image scale', min: 0.01, step: 0.05, def: 1, get: () => paints(get())[i]?.scale ?? 1, apply: (v, ph) => update({ scale: v }, ph) });
        fields.push(f);
        body.push(f.el);
      }
    } else {
      // Gradients: geometry fields, then one row per stop.
      const geo = [];
      const g = (label, key, o) => { const f = numberField({ label, title: o.title, min: o.min, max: o.max, step: o.step || 1, def: o.def, unit: o.unit, decimals: o.decimals, get: () => (paints(get())[i] || {})[key] ?? o.def, apply: (v, ph) => update({ [key]: v }, ph) }); fields.push(f); geo.push(f.el); };
      if (p.type === 'linear' || p.type === 'angular') g('∠', 'angle', { title: 'Angle', min: -360, max: 360, def: p.type === 'linear' ? 90 : 0, unit: '°' });
      if (p.type !== 'linear') { g('X', 'cx', { title: 'Centre x (0-1)', min: -1, max: 2, step: 0.01, def: 0.5 }); g('Y', 'cy', { title: 'Centre y (0-1)', min: -1, max: 2, step: 0.01, def: 0.5 }); }
      if (p.type === 'radial' || p.type === 'diamond') g('R', 'r', { title: 'Radius (0-1)', min: 0, max: 3, step: 0.01, def: 0.5 });
      body.push(h('div.ps-grid', geo));
      (p.stops || []).forEach((st, k) => {
        const stopUpdate = (patch, ph) => { const stops = (paints(get())[i].stops || []).map((x) => ({ ...x })); stops[k] = { ...stops[k], ...patch }; update({ stops }, ph); };
        const pos = numberField({ label: '%', title: 'Stop position', min: 0, max: 100, def: k ? 100 : 0, decimals: 0, get: () => Math.round(((paints(get())[i]?.stops || [])[k]?.pos ?? 0) * 100), apply: (v, ph) => stopUpdate({ pos: v / 100 }, ph) });
        fields.push(pos);
        body.push(h('div.ps-row.stop', colorInput(st.color, (v) => stopUpdate({ color: v }, 'preview'), (v) => stopUpdate({ color: v }), `Stop ${k + 1} colour`), pos.el,
          (p.stops.length > 2 ? btn('−', 'Remove stop', () => { const stops = p.stops.filter((_, j) => j !== k); update({ stops }); }) : null)));
      });
      body.push(h('div.ps-row', btn('+ Stop', 'Add a colour stop', () => { const stops = [...(p.stops || []), { pos: 0.5, color: '#888888' }].sort((a, b) => a.pos - b.pos); update({ stops }); })));
    }
    // Opacity and blend for every paint.
    const op = numberField({ label: 'Op', title: 'Paint opacity', min: 0, max: 100, def: 100, unit: '%', decimals: 0, get: () => Math.round(((paints(get())[i] || {}).opacity ?? 1) * 100), apply: (v, ph) => update({ opacity: v >= 100 ? undefined : v / 100 }, ph) });
    fields.push(op);
    body.push(h('div.ps-grid', op.el, sel(p.blend || 'normal', BLEND_MODES.map((b) => [b, b]), (v) => update({ blend: v === 'normal' ? undefined : v }), 'Paint blend mode')));
    return h('div.paint', head, ...body);
  });
  return h('div.ps-col', ...rows.reverse(), h('div.ps-row', btn(`+ ${kind === 'fill' ? 'Fill' : 'Stroke'}`, `Add a ${kind}`, () => set([...list(), { type: 'solid', color: kind === 'fill' ? '#D9D9D9' : '#1E1E1E' }]))));
}

const EFFECT_TYPES = [['drop', 'Drop shadow'], ['inner', 'Inner shadow'], ['blur', 'Layer blur'], ['bgblur', 'Background blur']];
const EFFECT_DEFAULTS = { drop: { x: 0, y: 4, blur: 8, spread: 0, color: '#00000040' }, inner: { x: 0, y: 2, blur: 4, color: '#00000040' }, blur: { radius: 4 }, bgblur: { radius: 8 } };

export function effectsEditor({ get, apply, fields }) {
  const value = get() || [];
  const list = () => (get() || []).map((e) => ({ ...e }));
  const set = (next, phase = 'commit') => apply(next.length ? next : undefined, phase);
  const rows = list().map((e, i) => {
    const update = (patch, ph) => { const l = list(); l[i] = { ...l[i], ...patch }; set(l, ph); };
    const f = (label, key, o = {}) => { const x = numberField({ label, title: o.title, min: o.min, step: o.step || 1, def: o.def ?? 0, get: () => ((get() || [])[i] || {})[key] ?? 0, apply: (v, ph) => update({ [key]: v }, ph) }); fields.push(x); return x.el; };
    const shadow = e.type === 'drop' || e.type === 'inner';
    const color = shadow ? h('input.hex', { type: 'text', value: e.color || '#00000040', spellcheck: false, 'aria-label': 'Shadow colour (hex with alpha)', on: { keydown: (ev) => ev.stopPropagation(), change: (ev) => { const v = ev.target.value.trim(); if (/^#?([0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) update({ color: (v[0] === '#' ? v : '#' + v).toUpperCase() }); else ev.target.classList.add('bad'); } } }) : null;
    return h('div.paint',
      h('div.ps-row',
        h('input', { type: 'checkbox', checked: e.visible !== false, 'aria-label': 'Effect visible', on: { change: (ev) => update({ visible: ev.target.checked ? undefined : false }) } }),
        sel(e.type, EFFECT_TYPES, (t) => { const l = list(); l[i] = { type: t, ...EFFECT_DEFAULTS[t] }; set(l); }, 'Effect type'),
        btn('−', 'Remove effect', () => { const l = list(); l.splice(i, 1); set(l); })),
      shadow ? h('div.ps-grid', f('X', 'x', { title: 'Offset x' }), f('Y', 'y', { title: 'Offset y' }), f('Blur', 'blur', { min: 0, title: 'Blur' }), e.type === 'drop' ? f('Spr', 'spread', { title: 'Spread' }) : null) : h('div.ps-grid', f('Blur', 'radius', { min: 0, title: 'Blur radius' })),
      color);
  });
  return h('div.ps-col', ...rows, h('div.ps-row', btn('+ Effect', 'Add a drop shadow', () => set([...list(), { type: 'drop', ...EFFECT_DEFAULTS.drop }]))));
}
