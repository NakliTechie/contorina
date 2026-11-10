// Parity additions: component properties, min and max sizes. DOM-free.
import { register } from './registry.js';
import { toAVD } from './avd.js';
import { download } from './storage.js';

const ids$ = { type: 'array', desc: 'Node ids; defaults to the current selection' };
const sel = (tx, p, env) => (p.ids ?? env.selection ?? []).filter((id) => tx.get(id));
const inMain = (tx, mainId, id) => { for (let n = tx.get(id); n; n = n.parent ? tx.get(n.parent) : null) if (n.id === mainId) return true; return false; };

register(
  {
    id: 'component.addProp', label: 'Add component property', group: 'Components', hidden: true,
    description: 'Add a property to a main component: type text (drives a text layer), boolean (shows or hides a layer) or swap (chooses the main of a nested instance). target is the layer inside the main.',
    params: { id: { type: 'string', required: true }, name: { type: 'string', required: true }, type: { type: 'string', required: true, enum: ['text', 'boolean', 'swap'] }, target: { type: 'string', required: true }, default: { type: 'any' } },
    doc(tx, p) {
      const m = tx.get(p.id);
      if (!m || !m.component) throw new Error('Choose a main component');
      const t = tx.get(p.target);
      if (!t || t.id === p.id || !inMain(tx, p.id, p.target)) throw new Error('The target must be a layer inside the main component');
      if (p.type === 'text' && t.type !== 'text') throw new Error('A text property needs a text layer');
      if (p.type === 'swap' && t.type !== 'instance') throw new Error('A swap property needs a nested instance');
      const def = p.default !== undefined ? p.default : p.type === 'text' ? t.text : p.type === 'boolean' ? t.visible !== false : t.mainId;
      tx.set(p.id, { props: { ...(m.props || {}), [p.name]: { type: p.type, target: p.target, default: def } } });
    },
  },
  {
    id: 'component.removeProp', label: 'Remove component property', group: 'Components', hidden: true,
    params: { id: { type: 'string', required: true }, name: { type: 'string', required: true } },
    doc(tx, p) {
      const m = tx.get(p.id);
      if (!m || !m.props || !m.props[p.name]) return false;
      const props = { ...m.props };
      delete props[p.name];
      tx.set(p.id, { props: Object.keys(props).length ? props : undefined });
    },
  },
  {
    id: 'instance.setProp', label: 'Set instance property', group: 'Components', hidden: true,
    description: 'Set a component property on an instance (text, true/false, or a main component id for swap); value null resets it to the default.',
    params: { id: { type: 'string', required: true }, name: { type: 'string', required: true }, value: { type: 'any', required: true } },
    doc(tx, p) {
      const inst = tx.get(p.id);
      if (!inst || inst.type !== 'instance' || inst.src) throw new Error('Choose an instance');
      const def = (tx.get(inst.mainId)?.props || {})[p.name];
      if (!def) throw new Error(`The component has no property ${p.name}`);
      if (def.type === 'text' && p.value !== null && typeof p.value !== 'string') throw new Error('A text property takes text');
      if (def.type === 'boolean' && p.value !== null && typeof p.value !== 'boolean') throw new Error('A boolean property takes true or false');
      if (def.type === 'swap' && p.value !== null && !tx.get(p.value)?.component) throw new Error('A swap property takes a main component id');
      const vals = { ...(inst.propValues || {}) };
      if (p.value === null) delete vals[p.name]; else vals[p.name] = p.value;
      tx.set(p.id, { propValues: Object.keys(vals).length ? vals : undefined });
    },
  },
  {
    id: 'export.avd', label: 'Export Android Vector Drawable', group: 'Export',
    description: 'Export the given layers (default: selection, else everything) as an Android Vector Drawable XML string; download saves a file. Text and images are skipped.',
    params: { ids: { type: 'array' }, download: { type: 'boolean' } },
    run(p, env, o) {
      const doc = env.state.doc;
      const ids = p.ids && p.ids.length ? p.ids : env.selection.length ? env.selection : doc.children;
      const xml = toAVD(doc, ids);
      if (p.download || (o && o.source !== 'agent' && p.download !== false && typeof document !== 'undefined')) download(new Blob([xml], { type: 'application/xml' }), (doc.name || 'figger').replace(/[^\w.-]+/g, '_').toLowerCase() + '.xml');
      return xml;
    },
  },
  {
    id: 'node.setMinMax', label: 'Set min and max size', group: 'Layout', hidden: true,
    description: 'Set minimum and maximum width and height (null clears one); auto layout and resizing respect them.',
    params: { ids: ids$, minW: { type: 'number', nullable: true }, maxW: { type: 'number', nullable: true }, minH: { type: 'number', nullable: true }, maxH: { type: 'number', nullable: true } },
    doc(tx, p, env) {
      const ids = sel(tx, p, env).filter((id) => !tx.get(id).src);
      if (!ids.length) return false;
      for (const id of ids) {
        const patch = {};
        for (const k of ['minW', 'maxW', 'minH', 'maxH']) if (p[k] !== undefined) patch[k] = p[k] === null ? undefined : Math.max(0, p[k]);
        tx.set(id, patch);
        const n = tx.get(id);
        const w = Math.min(n.maxW ?? Infinity, Math.max(n.minW ?? 0, n.w)), h = Math.min(n.maxH ?? Infinity, Math.max(n.minH ?? 0, n.h));
        if (w !== n.w || h !== n.h) tx.set(id, { w, h });
      }
    },
  },
);
