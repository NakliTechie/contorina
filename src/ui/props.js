// Properties panel. It rebuilds only when the shape of the selection changes and otherwise refreshes
// values in place, so a field being dragged is never torn down mid-gesture.
import { h, clear } from './dom.js';
import { numberField } from './numfield.js';
import { state, subscribe } from '../store.js';
import { hasLayout } from '../doc.js';
import { fillOf, strokeOf, textOf, FONT_STACKS } from '../styles.js';
import { variantSetOf, variantProps } from '../components.js';
import { DEFAULT_LAYOUT } from '../layout.js';
import { paintList, effectsEditor } from './paint-editor.js';
import { BLEND_MODES } from '../paint.js';
import { variablesSection, bindingSection, protoSection, gridsSection, inspectView } from './props-extra.js';

const WEIGHTS = [[100, 'Thin'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [900, 'Black']];

export function createProps(root, app) {
  const body = h('div.props-body');
  root.append(body);
  let key = '', fields = [], gest = null;

  const nodes = () => state.selection.map((id) => state.doc.nodes[id]).filter(Boolean);
  const common = (fn) => { const ns = nodes(); if (!ns.length) return null; const v = fn(ns[0]); return ns.every((n) => fn(n) === v) ? v : null; };
  const apply = (cmd, params, phase) => {
    if (phase === 'preview') { gest = gest || app.gesture(); gest.preview(cmd, params); return; }
    if (phase === 'cancel') { gest?.cancel(); gest = null; return; }
    if (gest) { gest.commit(cmd, params); gest = null; } else app.run(cmd, params);
  };
  const setProps = (props, phase = 'commit') => apply('node.set', { ids: state.selection.slice(), props }, phase);
  const num = (label, prop, o = {}) => {
    const f = numberField({ label, title: o.title, step: o.step, min: o.min, max: o.max, def: o.def ?? 0, unit: o.unit, decimals: o.decimals,
      get: () => { const v = common((n) => (o.get ? o.get(n) : n[prop])); return v == null ? null : v * (o.scale || 1); },
      apply: (v, phase) => setProps({ [prop]: v / (o.scale || 1) }, phase) });
    fields.push(f);
    return f.el;
  };
  const section = (title, ...kids) => h('section.ps', h('h3', title), ...kids);
  const grid = (...kids) => h('div.ps-grid', ...kids);
  const select = (value, options, onChange, label) => {
    const s = h('select', { 'aria-label': label, on: { change: () => onChange(s.value) } }, options.map(([v, l]) => h('option', { value: String(v) }, l)));
    s.value = value == null ? '' : String(value);
    if (value == null) s.prepend(h('option', { value: '', disabled: true, selected: true }, 'Mixed'));
    return s;
  };
  const button = (label, fn, o = {}) => h('button.ps-btn' + (o.primary ? '.primary' : ''), { type: 'button', title: o.title, on: { click: fn } }, label);
  const seg = (value, options, onPick, label) => h('div.seg', { role: 'group', 'aria-label': label }, options.map(([v, l, t]) =>
    h('button' + (v === value ? '.on' : ''), { type: 'button', title: t || l, 'aria-pressed': v === value ? 'true' : 'false', on: { click: () => onPick(v) } }, l)));

  function colorRow(kind) {
    const prop = kind;
    const styleKey = kind === 'fill' ? 'fillStyle' : 'strokeStyle';
    const value = common((n) => (kind === 'fill' ? fillOf(n, state.doc.styles) : strokeOf(n, state.doc.styles)));
    const styleId = common((n) => n[styleKey] || '');
    const colorStyles = Object.entries(state.doc.styles).filter(([, s]) => s.type === 'color');
    const has = nodes().some((n) => (kind === 'fill' ? fillOf(n, state.doc.styles) : strokeOf(n, state.doc.styles)));
    if (!has) return h('div.ps-row', button(`+ Add ${kind}`, () => setProps({ [prop]: kind === 'fill' ? '#D9D9D9' : '#1E1E1E', ...(kind === 'stroke' ? { strokeWidth: 1 } : {}) })));
    const color = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000', 'aria-label': `${kind} colour`, disabled: !!styleId });
    const hex = h('input.hex', { type: 'text', value: value || '', placeholder: 'Mixed', spellcheck: false, 'aria-label': `${kind} hex`, disabled: !!styleId });
    color.addEventListener('input', () => { hex.value = color.value.toUpperCase(); setProps({ [prop]: color.value.toUpperCase() }, 'preview'); });
    color.addEventListener('change', () => setProps({ [prop]: color.value.toUpperCase() }));
    hex.addEventListener('keydown', (e) => e.stopPropagation());
    hex.addEventListener('change', () => {
      let v = hex.value.trim();
      if (/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) v = '#' + v;
      if (/^#[0-9a-f]{3}$/i.test(v)) v = '#' + v.slice(1).split('').map((c) => c + c).join('');
      if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v)) setProps({ [prop]: v.toUpperCase() }); else hex.classList.add('bad');
    });
    const styleSel = select(styleId, [['', '— no style —'], ...colorStyles.map(([id, s]) => [id, s.name])], (v) => app.run('node.applyStyle', { kind, styleId: v || null }), `${kind} style`);
    return h('div.ps-col',
      h('div.ps-row', color, hex, button('−', () => setProps({ [prop]: null, [styleKey]: undefined }), { title: `Remove ${kind}` })),
      h('div.ps-row', styleSel, button('❖', () => app.run('style.fromSelection', { kind }), { title: `Create a colour style from this ${kind}` })),
      kind === 'stroke' ? grid(num('W', 'strokeWidth', { min: 0, step: 0.5, def: 1, title: 'Stroke width' })) : null);
  }

  function structureKey() {
    const ns = nodes();
    const extra = '|' + !!state.inspect + JSON.stringify(state.doc.variables || null).length + JSON.stringify(state.doc.variables || null) + (state.doc.flowStart || '');
    if (!ns.length) return extra + 'doc:' + Object.keys(state.doc.styles).length + ':' + JSON.stringify(Object.values(state.doc.styles).map((s) => s.name)) + Object.values(state.doc.nodes).filter((n) => n.component).map((n) => n.id + n.name).join();
    return ns.map((n) => {
      const p = n.parent && state.doc.nodes[n.parent];
      return [n.id, n.name, n.type, !!n.src, !!n.component, hasLayout(n) && JSON.stringify(n.layout), hasLayout(p), !!fillOf(n, state.doc.styles), !!strokeOf(n, state.doc.styles), n.fillStyle, n.strokeStyle, n.textStyle, n.mainId, n.sizing && JSON.stringify(n.sizing), n.constraints && JSON.stringify(n.constraints), n.fontFamily, n.fontWeight, n.align, n.autoSize, n.clip, n.variant && JSON.stringify(n.variant), n.locked, JSON.stringify(n.fill ?? null), JSON.stringify(n.stroke ?? null), JSON.stringify(n.effects ?? null), Array.isArray(n.radius), n.strokeAlign, n.blendMode, n.fillRule, n.strokeCap, n.strokeJoin, JSON.stringify(n.dash ?? null), n.decoration, n.textCase, JSON.stringify(n.proto ?? null), JSON.stringify(n.grids ?? null), JSON.stringify(n.modes ?? null), JSON.stringify(n.bind ?? null)].join('|');
    }).join(';') + Object.keys(state.doc.styles).join() + extra;
  }

  function build() {
    fields = [];
    clear(body);
    const ns = nodes();
    if (!ns.length) { buildDoc(); return; }
    if (state.inspect) {
      body.append(h('div.ps-row.pad', button('← Design', () => app.run('view.inspect'), { title: 'Shift+D' })), inspectView(state.doc, ns, app));
      return;
    }
    const one = ns.length === 1 ? ns[0] : null;
    const allType = (t) => ns.every((n) => n.type === t);
    const doc = state.doc;

    // Header and components.
    const title = one ? one.name : `${ns.length} layers`;
    const kind = one ? (one.component ? 'Main component' : one.variantSet ? 'Component set' : one.type === 'instance' ? 'Instance' : one.src ? 'Layer in an instance' : one.type) : 'Mixed';
    body.append(h('div.ps-head', h('span.ps-kind', kind), h('span.ps-title', title)));
    if (one && one.type === 'instance' && !one.src) {
      const main = doc.nodes[one.mainId];
      const set = main && variantSetOf(doc, main.id);
      const rows = [];
      if (set) {
        const props = variantProps(doc, set);
        for (const [prop, values] of Object.entries(props)) rows.push(h('label.ps-field', h('span', prop), select((main.variant || {})[prop], values.map((v) => [v, v]), (v) => app.run('instance.setVariant', { id: one.id, prop, value: v }), prop)));
      }
      const others = Object.values(doc.nodes).filter((n) => n.component && n.id !== one.mainId && !n.src);
      body.append(section('Instance',
        h('div.ps-note', main ? `of ${main.name}` : 'Its main component was deleted'),
        ...rows,
        others.length ? h('label.ps-field', h('span', 'Swap'), select(one.mainId, [[one.mainId, main ? main.name : '—'], ...others.map((n) => [n.id, n.name])], (v) => v !== one.mainId && app.run('instance.swap', { id: one.id, mainId: v }), 'Swap instance')) : null,
        h('div.ps-row', main ? button('Go to main', () => app.run('component.goToMain')) : null, button('Reset', () => app.run('instance.reset')), button('Detach', () => app.run('component.detach')))));
    } else if (one && one.component) {
      const set = variantSetOf(doc, one.id);
      body.append(section('Component', set ? h('div.ps-note', `Variant ${Object.entries(one.variant || {}).map(([k, v]) => `${k}=${v}`).join(', ')} — rename to change`) : null,
        h('div.ps-row', button('Create instance', () => app.run('component.instance'), { primary: true }))));
    } else if (ns.length > 1 && ns.every((n) => n.component && !variantSetOf(doc, n.id))) {
      body.append(section('Components', h('div.ps-row', button('Combine as variants', () => app.run('component.combineVariants'), { primary: true }))));
    } else if (one && one.src) {
      body.append(h('div.ps-note.pad', 'Changes here become overrides on the instance. Geometry follows the main component.'));
    } else if (!ns.some((n) => n.src || n.variantSet)) {
      body.append(h('div.ps-row.pad', button('Create component', () => app.run('component.create'), { title: 'Mod+Alt+K' })));
    }

    if (!ns.some((n) => n.src)) {
      body.append(section('Position', grid(num('X', 'x'), num('Y', 'y'), num('W', 'w', { min: 1, def: 100 }), num('H', 'h', { min: 0, def: 100 }), num('↻', 'rotation', { title: 'Rotation', unit: '°', min: -180, max: 180 }))));
    }

    // Auto layout.
    const containers = ns.filter((n) => n.type === 'frame' || n.type === 'instance');
    if (containers.length === ns.length && !ns.some((n) => n.src)) {
      const L = common((n) => (hasLayout(n) ? JSON.stringify(n.layout) : ''));
      if (!L) {
        body.append(section('Auto layout', h('div.ps-row', button('+ Add auto layout', () => app.run('layout.add'), { title: 'Shift+A' }))));
      } else {
        const lay = JSON.parse(L);
        const setL = (patch, phase = 'commit') => apply('layout.set', { ids: state.selection.slice(), layout: patch }, phase);
        const lnum = (label, get, toPatch, o = {}) => {
          const f = numberField({ label, title: o.title, min: o.min ?? 0, step: 1, def: o.def ?? 0, get: () => { const n = nodes()[0]; return n && hasLayout(n) ? get(n.layout) : null; }, apply: (v, phase) => setL(toPatch(v, nodes()[0].layout), phase) });
          fields.push(f);
          return f.el;
        };
        const padIdx = (i) => lnum(['↑', '→', '↓', '←'][i], (l) => (l.pad || [0, 0, 0, 0])[i], (v, l) => { const p = (l.pad || [0, 0, 0, 0]).slice(); p[i] = v; return { pad: p }; }, { title: ['Padding top', 'Padding right', 'Padding bottom', 'Padding left'][i] });
        body.append(section('Auto layout',
          h('div.ps-row', seg(lay.wrap ? 'wrap' : lay.mode, [['row', '→', 'Horizontal'], ['column', '↓', 'Vertical'], ['wrap', '↩', 'Wrap']], (v) => setL(v === 'wrap' ? { mode: 'row', wrap: true } : { mode: v, wrap: false }), 'Direction'),
            button('×', () => app.run('layout.remove'), { title: 'Remove auto layout (Alt+Shift+A)' })),
          grid(lnum('Gap', (l) => l.gap, (v) => ({ gap: v }), { title: 'Gap between items' }), lay.wrap ? lnum('Rows', (l) => l.crossGap ?? l.gap, (v) => ({ crossGap: v }), { title: 'Gap between rows' }) : null),
          grid(padIdx(0), padIdx(1), padIdx(2), padIdx(3)),
          h('label.ps-field', h('span', 'Align'), select(lay.align, [['start', 'Start'], ['center', 'Centre'], ['end', 'End'], ['stretch', 'Stretch']], (v) => setL({ align: v }), 'Align items')),
          h('label.ps-field', h('span', 'Justify'), select(lay.justify, [['start', 'Start'], ['center', 'Centre'], ['end', 'End'], ['between', 'Space between']], (v) => setL({ justify: v }), 'Justify items'))));
      }
    }

    // Resizing (hug, fill, fixed).
    const inFlow = ns.every((n) => hasLayout(n.parent && doc.nodes[n.parent]));
    const ownLayout = ns.every((n) => hasLayout(n) || n.type === 'text');
    if ((inFlow || ownLayout) && !ns.some((n) => n.src)) {
      const opts = (axis) => [['fixed', 'Fixed'], ...(ownLayout ? [['hug', 'Hug']] : []), ...(inFlow ? [['fill', 'Fill']] : [])];
      body.append(section('Resizing',
        h('label.ps-field', h('span', 'Width'), select(common((n) => (n.sizing || {}).h || (n.type === 'text' && n.autoSize === 'width' ? 'hug' : 'fixed')), opts('h'), (v) => app.run('node.setSizing', { h: v }), 'Width sizing')),
        h('label.ps-field', h('span', 'Height'), select(common((n) => (n.sizing || {}).v || (n.type === 'text' && n.autoSize !== 'fixed' ? 'hug' : 'fixed')), opts('v'), (v) => app.run('node.setSizing', { v }), 'Height sizing'))));
    }

    // Constraints, for children of plain frames and instances' mains.
    const inPlainFrame = ns.every((n) => { const p = n.parent && doc.nodes[n.parent]; return p && !hasLayout(p) && p.type === 'frame'; });
    if (inPlainFrame && !ns.some((n) => n.src)) {
      body.append(section('Constraints',
        h('label.ps-field', h('span', 'Horizontal'), select(common((n) => (n.constraints || {}).h || 'left'), [['left', 'Left'], ['right', 'Right'], ['leftright', 'Left and right'], ['center', 'Centre'], ['scale', 'Scale']], (v) => app.run('node.setConstraints', { h: v }), 'Horizontal constraint')),
        h('label.ps-field', h('span', 'Vertical'), select(common((n) => (n.constraints || {}).v || 'top'), [['top', 'Top'], ['bottom', 'Bottom'], ['topbottom', 'Top and bottom'], ['center', 'Centre'], ['scale', 'Scale']], (v) => app.run('node.setConstraints', { v }), 'Vertical constraint'))));
    }

    // Appearance.
    const rounded = ns.every((n) => ['rect', 'frame', 'instance'].includes(n.type));
    const perCorner = rounded && ns.some((n) => Array.isArray(n.radius));
    const clipRow = ns.every((n) => n.type === 'frame' || n.type === 'instance') && !ns.some((n) => n.src)
      ? h('label.ps-check', h('input', { type: 'checkbox', checked: common((n) => n.clip !== false) !== false, on: { change: (e) => setProps({ clip: e.target.checked }) } }), 'Clip content') : null;
    const cornerField = (i, label) => {
      const f = numberField({ label, title: ['Top left', 'Top right', 'Bottom right', 'Bottom left'][i] + ' radius', min: 0, def: 0,
        get: () => common((n) => (Array.isArray(n.radius) ? n.radius[i] : n.radius || 0)),
        apply: (v, phase) => { const n0 = nodes()[0]; const r = Array.isArray(n0.radius) ? n0.radius.slice() : [0, 1, 2, 3].map(() => n0.radius || 0); r[i] = v; setProps({ radius: r }, phase); } });
      fields.push(f);
      return f.el;
    };
    const radiusUI = !rounded ? null : perCorner
      ? h('div.ps-col', grid(cornerField(0, '↖'), cornerField(1, '↗'), cornerField(3, '↙'), cornerField(2, '↘')), h('div.ps-row', button('One radius', () => { const r = nodes()[0].radius; setProps({ radius: Array.isArray(r) ? Math.max(...r) : r }); })))
      : h('div.ps-row', num('R', 'radius', { min: 0, title: 'Corner radius' }), button('⌜⌝', () => { const r = nodes()[0].radius || 0; setProps({ radius: [r, r, r, r] }); }, { title: 'Independent corners' }));
    body.append(section('Appearance',
      grid(num('Op', 'opacity', { scale: 100, min: 0, max: 100, def: 100, unit: '%', decimals: 0, title: 'Opacity' }),
        select(common((n) => n.blendMode || 'normal'), [['normal', 'Normal'], ...BLEND_MODES.slice(1).map((b) => [b, b])], (v) => setProps({ blendMode: v === 'normal' ? undefined : v }), 'Layer blend mode')),
      radiusUI, clipRow));

    // Shape settings for polygons, stars and vectors.
    if (allType('polygon')) body.append(section('Polygon', grid(num('Sides', 'sides', { min: 3, max: 60, def: 3, decimals: 0, title: 'Number of sides' }))));
    if (allType('star')) body.append(section('Star', grid(num('Pts', 'points', { min: 3, max: 60, def: 5, decimals: 0, title: 'Number of points' }), num('In', 'inner', { scale: 100, min: 1, max: 100, def: 38, unit: '%', decimals: 0, title: 'Inner radius ratio' }))));
    if (one && ['vector', 'polygon', 'star'].includes(one.type) && !one.src) {
      body.append(section('Path', h('div.ps-row', button('Edit path', () => app.run('vector.editPath'), { title: 'Double-click the shape, or Enter' }),
        one.type === 'vector' ? select(one.fillRule || 'nonzero', [['nonzero', 'Non-zero'], ['evenodd', 'Even-odd']], (v) => setProps({ fillRule: v }), 'Fill rule') : null)));
    }
    const shapes = ns.filter((n) => !n.src && n.type !== 'text' && !n.children);
    if (ns.length >= 2 && !ns.some((n) => n.src)) {
      body.append(section('Boolean', h('div.ps-row', ...['union', 'subtract', 'intersect', 'exclude'].map((op) => button(op[0].toUpperCase() + op.slice(1), () => app.run('boolean.apply', { op }), { title: `Boolean ${op}` })))));
    }
    if (shapes.length && shapes.length === ns.length && !ns.every((n) => n.type === 'vector' || n.type === 'line')) {
      body.append(h('div.ps-row.pad', button('Flatten to vector', () => app.run('node.flatten'), { title: 'Mod+E' })));
    }

    // Fill and stroke paints (with shared styles).
    const paintSection = (kind) => {
      const styleKey = kind === 'fill' ? 'fillStyle' : 'strokeStyle';
      const styleId = common((n) => n[styleKey] || '');
      const colorStyles = Object.entries(doc.styles).filter(([, s]) => s.type === 'color');
      const styleRow = h('div.ps-row', select(styleId, [['', '— no style —'], ...colorStyles.map(([id, s]) => [id, s.name])], (v) => app.run('node.applyStyle', { kind, styleId: v || null }), `${kind} style`),
        button('❖', () => app.run('style.fromSelection', { kind }), { title: `Create a style from this ${kind}` }));
      const sameValue = common((n) => JSON.stringify(n[kind] ?? null));
      const editor = styleId ? h('div.ps-note', `Paint comes from the style “${doc.styles[styleId]?.name}”. Edit it with nothing selected.`)
        : sameValue === null ? h('div.ps-note', 'Mixed') : paintList({ get: () => nodes()[0] && nodes()[0][kind], apply: (v, phase) => setProps({ [kind]: v }, phase), fields, app, kind });
      return h('div.ps-col', styleRow, editor);
    };
    if (!ns.every((n) => n.type === 'line')) body.append(section(allType('text') ? 'Text paint' : 'Fill', paintSection('fill')));
    if (!allType('text')) {
      const hasStroke = ns.some((n) => strokeOf(n, doc.styles));
      const opts = hasStroke ? h('div.ps-col',
        grid(num('W', 'strokeWidth', { min: 0, step: 0.5, def: 1, title: 'Stroke width' }),
          select(common((n) => n.strokeAlign || 'center'), [['center', 'Centre'], ['inside', 'Inside'], ['outside', 'Outside']], (v) => setProps({ strokeAlign: v === 'center' ? undefined : v }), 'Stroke position')),
        grid(select(common((n) => n.strokeCap || 'butt'), [['butt', 'Butt cap'], ['round', 'Round cap'], ['square', 'Square cap']], (v) => setProps({ strokeCap: v }), 'Stroke cap'),
          select(common((n) => n.strokeJoin || 'miter'), [['miter', 'Miter join'], ['round', 'Round join'], ['bevel', 'Bevel join']], (v) => setProps({ strokeJoin: v }), 'Stroke join')),
        h('label.ps-field', h('span', 'Dashes'), h('input', { type: 'text', value: (common((n) => JSON.stringify(n.dash || [])) && (nodes()[0].dash || []).join(' ')) || '', placeholder: 'e.g. 6 4', 'aria-label': 'Dash pattern',
          on: { keydown: (e) => e.stopPropagation(), change: (e) => { const d = e.target.value.trim().split(/[\s,]+/).map(Number).filter((x) => Number.isFinite(x) && x >= 0); setProps({ dash: d.length ? d : undefined, dashed: undefined }); } } }))) : null;
      body.append(section('Stroke', paintSection('stroke'), opts));
    }
    body.append(section('Effects', effectsEditor({ get: () => nodes()[0] && nodes()[0].effects, apply: (v, phase) => setProps({ effects: v }, phase), fields })));

    if (allType('text')) {
      const t0 = textOf(ns[0], doc.styles);
      const textStyles = Object.entries(doc.styles).filter(([, s]) => s.type === 'text');
      const styleId = common((n) => n.textStyle || '');
      const fontOpts = Object.keys(FONT_STACKS).map((f) => [f, f]);
      if (!FONT_STACKS[t0.fontFamily]) fontOpts.push([t0.fontFamily, t0.fontFamily]);
      body.append(section('Text',
        h('div.ps-row', select(styleId, [['', '— no text style —'], ...textStyles.map(([id, s]) => [id, s.name])], (v) => app.run('node.applyStyle', { kind: 'text', styleId: v || null }), 'Text style'),
          button('❖', () => app.run('style.fromSelection', { kind: 'text' }), { title: 'Create a text style' })),
        styleId ? h('div.ps-note', 'Font settings come from the text style.') : h('div.ps-col',
          h('label.ps-field', h('span', 'Font'), select(common((n) => n.fontFamily), fontOpts, (v) => setProps({ fontFamily: v }), 'Font family')),
          h('label.ps-field', h('span', 'Weight'), select(common((n) => n.fontWeight), WEIGHTS, (v) => setProps({ fontWeight: Number(v) }), 'Font weight')),
          grid(num('Size', 'fontSize', { min: 1, def: 16, title: 'Font size' }), num('LH', 'lineHeight', { min: 0.5, step: 0.05, def: 1.25, title: 'Line height (multiple)' }))),
        h('div.ps-row', seg(common((n) => n.align || 'left'), [['left', '⟸', 'Left'], ['center', '≡', 'Centre'], ['right', '⟹', 'Right']], (v) => setProps({ align: v }), 'Alignment'),
          select(common((n) => n.autoSize || 'width'), [['width', 'Auto width'], ['height', 'Auto height'], ['fixed', 'Fixed size']], (v) => setProps({ autoSize: v }), 'Text box sizing'))));
    }

    const vb = !ns.some((n) => n.src) && bindingSection(doc, ns, app);
    if (vb) body.append(vb);
    if (one && !one.src && one.type === 'frame') body.append(gridsSection(one, app, fields));
    if (one && !one.src) body.append(protoSection(doc, one, app));
    const ids = () => state.selection.slice();
    body.append(section('Export', h('div.ps-row', button('PNG', () => app.run('export.png', { ids: ids(), download: true })), button('JPG', () => app.run('export.jpg', { ids: ids(), download: true })), button('SVG', () => app.run('export.svg', { ids: ids(), download: true })), button('PDF', () => app.run('export.pdf', { ids: ids(), download: true }))),
      h('div.ps-row', button('Code…', () => app.run('code.show')), button('Inspect', () => app.run('view.inspect'), { title: 'Shift+D' }))));
  }

  function buildDoc() {
    const doc = state.doc;
    const name = h('input', { type: 'text', value: doc.name, 'aria-label': 'Document name', on: { keydown: (e) => e.stopPropagation(), change: (e) => app.run('doc.rename', { name: e.target.value }) } });
    body.append(section('Document', name, h('div.ps-note', `${Object.keys(doc.nodes).length} layers · saved to ${app.storageLabel()}`)));
    const styles = Object.entries(doc.styles);
    const styleRows = styles.map(([id, s]) => {
      const nm = h('input', { type: 'text', value: s.name, 'aria-label': 'Style name', on: { keydown: (e) => e.stopPropagation(), change: (e) => app.run('style.update', { id, patch: { name: e.target.value } }) } });
      const del = button('×', async () => { if (await app.confirm(`Delete style “${s.name}”?`, 'Layers using it keep its current values.', 'Delete', true)) app.run('style.delete', { id }); }, { title: 'Delete style' });
      if (s.type === 'color') {
        const c = h('input', { type: 'color', value: s.value.slice(0, 7), 'aria-label': `${s.name} colour` });
        c.addEventListener('input', () => apply('style.update', { id, patch: { value: c.value.toUpperCase() } }, 'preview'));
        c.addEventListener('change', () => apply('style.update', { id, patch: { value: c.value.toUpperCase() } }, 'commit'));
        return h('div.ps-row.style-row', c, nm, del);
      }
      const size = h('input.small', { type: 'number', value: s.fontSize, min: 1, 'aria-label': `${s.name} size`, on: { keydown: (e) => e.stopPropagation(), change: (e) => app.run('style.update', { id, patch: { fontSize: Number(e.target.value) || s.fontSize } }) } });
      const wt = select(s.fontWeight, WEIGHTS, (v) => app.run('style.update', { id, patch: { fontWeight: Number(v) } }), `${s.name} weight`);
      return h('div.ps-col.style-row', h('div.ps-row', h('span.ps-aa', 'Aa'), nm, del), h('div.ps-row', size, wt));
    });
    body.append(section('Styles', ...styleRows,
      h('div.ps-row', button('+ Colour', () => app.run('style.create', { type: 'color', name: `Color ${styles.filter(([, s]) => s.type === 'color').length + 1}`, value: '#0D99FF' })),
        button('+ Text', () => app.run('style.create', { type: 'text', name: `Text ${styles.filter(([, s]) => s.type === 'text').length + 1}`, fontSize: 16 })))));
    const mains = Object.values(doc.nodes).filter((n) => n.component && !n.src);
    body.append(variablesSection(doc, app));
    body.append(section('Components', mains.length ? mains.map((m) => h('div.ps-row.comp-row', h('span.ps-comp', '❖ ' + m.name), button('Insert', () => {
      const c = app.viewCenter();
      app.run('component.instance', { mainId: m.id, x: Math.round(c.x - m.w / 2), y: Math.round(c.y - m.h / 2) });
    }))) : h('div.ps-note', 'Select a frame and press Create component (Mod+Alt+K).')));
    body.append(section('Export', h('div.ps-row', button('PNG', () => app.run('export.png', { download: true })), button('SVG', () => app.run('export.svg', { download: true })))));
  }

  subscribe((what) => {
    if (!(what.has('doc') || what.has('selection'))) return;
    const k = structureKey();
    if (k !== key && !fields.some((f) => f.dragging) && !body.contains(document.activeElement)) { key = k; build(); }
    else if (k !== key && what.has('selection')) { key = k; build(); }
    else for (const f of fields) f.update();
  });
  key = structureKey();
  build();
}

export { DEFAULT_LAYOUT };
