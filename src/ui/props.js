// Properties panel. It rebuilds only when the shape of the selection changes and otherwise refreshes
// values in place, so a field being dragged is never torn down mid-gesture.
import { h, clear } from './dom.js';
import { numberField } from './numfield.js';
import { state, subscribe } from '../store.js';
import { hasLayout } from '../doc.js';
import { fillOf, strokeOf, textOf, FONT_STACKS } from '../styles.js';
import { variantSetOf, variantProps } from '../components.js';
import { DEFAULT_LAYOUT } from '../layout.js';

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
    if (!ns.length) return 'doc:' + Object.keys(state.doc.styles).length + ':' + JSON.stringify(Object.values(state.doc.styles).map((s) => s.name)) + Object.values(state.doc.nodes).filter((n) => n.component).map((n) => n.id + n.name).join();
    return ns.map((n) => {
      const p = n.parent && state.doc.nodes[n.parent];
      return [n.id, n.name, n.type, !!n.src, !!n.component, hasLayout(n) && JSON.stringify(n.layout), hasLayout(p), !!fillOf(n, state.doc.styles), !!strokeOf(n, state.doc.styles), n.fillStyle, n.strokeStyle, n.textStyle, n.mainId, n.sizing && JSON.stringify(n.sizing), n.constraints && JSON.stringify(n.constraints), n.fontFamily, n.fontWeight, n.align, n.autoSize, n.clip, n.variant && JSON.stringify(n.variant), n.locked].join('|');
    }).join(';') + Object.keys(state.doc.styles).join();
  }

  function build() {
    fields = [];
    clear(body);
    const ns = nodes();
    if (!ns.length) { buildDoc(); return; }
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
    const clipRow = ns.every((n) => n.type === 'frame' || n.type === 'instance') && !ns.some((n) => n.src)
      ? h('label.ps-check', h('input', { type: 'checkbox', checked: common((n) => n.clip !== false) !== false, on: { change: (e) => setProps({ clip: e.target.checked }) } }), 'Clip content') : null;
    body.append(section('Appearance', grid(num('Op', 'opacity', { scale: 100, min: 0, max: 100, def: 100, unit: '%', decimals: 0, title: 'Opacity' }), rounded ? num('R', 'radius', { min: 0, title: 'Corner radius' }) : null), clipRow));

    if (!ns.every((n) => n.type === 'line')) body.append(section(allType('text') ? 'Text colour' : 'Fill', colorRow('fill')));
    if (!allType('text')) body.append(section('Stroke', colorRow('stroke')));

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

    body.append(section('Export', h('div.ps-row', button('PNG', () => app.run('export.png', { ids: state.selection.slice(), download: true })), button('SVG', () => app.run('export.svg', { ids: state.selection.slice(), download: true })))));
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
