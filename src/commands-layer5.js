// Import (SVG, Figma REST JSON) and code export commands (scope layer 5). DOM-free.
import { register } from './registry.js';
import { makeNode, uid } from './doc.js';
import { round2 } from './geom.js';
import { svgToSpecs, specBounds } from './import-svg.js';
import { figmaToSpecs } from './import-figma.js';
import { toHTML, toReact, cssFor, cssText } from './codegen.js';
import { ensurePages } from './commands-layer4.js';
import { measureTexts } from './text.js';
import { descendants } from './doc.js';

const r2 = (o) => { for (const k of ['x', 'y', 'w', 'h']) if (typeof o[k] === 'number') o[k] = round2(o[k]); return o; };

// Insert SVG specs (absolute SVG coordinates) under parent, shifting by (ox, oy).
function insertSvg(tx, specs, parent, ox, oy) {
  const out = [];
  for (const sp of specs) {
    if (sp.type === 'group') {
      const b = specBounds(sp);
      if (!b) continue;
      const f = makeNode('frame', r2({ name: sp.name, x: b.x - ox, y: b.y - oy, w: Math.max(1, b.w), h: Math.max(1, b.h), fill: null, clip: false, ...sp.props }));
      tx.add(f, parent);
      insertSvg(tx, sp.children, f.id, b.x, b.y);
      out.push(f.id);
    } else if (sp.type === 'image') {
      const aid = 'img' + uid();
      tx.doc.assets[aid] = { ...sp.asset, name: sp.name };
      const n = makeNode('rect', r2({ name: sp.name, ...sp.props, x: sp.props.x - ox, y: sp.props.y - oy, fill: { type: 'image', asset: aid, mode: 'fill' } }));
      tx.add(n, parent);
      out.push(n.id);
    } else {
      const { anchorX, ...props } = sp.props;
      const n = makeNode(sp.type, r2({ name: sp.name, ...props, x: props.x - ox, y: props.y - oy }));
      if (n.type === 'text') { n.autoSize = 'width'; if (anchorX === 'middle' || anchorX === 'end') n.anchor = anchorX; }
      tx.add(n, parent);
      out.push(n.id);
    }
  }
  return out;
}

// Figma specs carry coordinates relative to their parent already.
function insertFigma(tx, specs, parent) {
  const out = [];
  for (const sp of specs) {
    const n = makeNode(sp.type, r2({ ...sp.props }));
    tx.add(n, parent);
    if (sp.children) insertFigma(tx, sp.children, n.id);
    out.push(n.id);
  }
  return out;
}

register(
  {
    id: 'import.svg', label: 'Import SVG', group: 'Import', hidden: true,
    description: 'Import SVG markup as a frame of editable layers at (x, y): rectangles and ellipses stay shapes, other elements become vectors, groups become frames.',
    params: { svg: { type: 'string', required: true }, x: { type: 'number' }, y: { type: 'number' }, parent: { type: 'string', nullable: true }, name: { type: 'string' } },
    doc(tx, p) {
      const { w, h, layers } = svgToSpecs(p.svg);
      if (!layers.length) throw new Error('The SVG has no drawable elements');
      const root = makeNode('frame', { name: p.name || 'SVG', x: round2(p.x || 0), y: round2(p.y || 0), w: round2(w), h: round2(h), fill: null, clip: true });
      tx.add(root, p.parent ?? null);
      insertSvg(tx, layers, root.id, 0, 0);
      // SVG text anchors at its x; once measured, shift centred and end-anchored text left.
      measureTexts(tx);
      for (const id of descendants(tx.doc, root.id)) {
        const n = tx.get(id);
        if (n.anchor) tx.set(id, { x: round2(n.x - (n.anchor === 'middle' ? n.w / 2 : n.w)), anchor: undefined });
      }
      return { select: [root.id], value: root.id };
    },
  },
  {
    id: 'import.figma', label: 'Import Figma JSON', group: 'Import', hidden: true,
    description: 'Import Figma REST API JSON (a file with ?geometry=paths, or a nodes response) as new pages. Best effort: image fills become grey, instances arrive detached.',
    params: { json: { type: 'object', required: true } },
    doc(tx, p) {
      const { pages } = figmaToSpecs(p.json);
      ensurePages(tx);
      tx.doc.pages = tx.doc.pages.map((g) => (g.id === tx.doc.page ? { ...g, children: tx.doc.children.slice() } : g));
      let first = null;
      for (const pg of pages) {
        const id = 'p' + uid();
        tx.doc.pages = [...tx.doc.pages, { id, name: pg.name, children: [] }];
        tx.doc.page = id;
        tx.doc.children = [];
        insertFigma(tx, pg.layers, null);
        tx.doc.pages = tx.doc.pages.map((g) => (g.id === id ? { ...g, children: tx.doc.children.slice() } : g));
        first = first || { id, children: tx.doc.children.slice() };
      }
      if (first) { tx.doc.page = first.id; tx.doc.children = first.children; }
      return { select: [], value: pages.length };
    },
  },
  {
    id: 'export.code', label: 'Export code', group: 'Export', hidden: true,
    description: 'Return code for layers (default: selection, else the page): format html (a full HTML page with CSS), react (a JSX component) or css (declarations for the first layer).',
    params: { ids: { type: 'array' }, format: { type: 'string', required: true, enum: ['html', 'react', 'css'] } },
    run(p, env) {
      const doc = env.state.doc;
      const ids = p.ids && p.ids.length ? p.ids : env.selection.length ? env.selection : doc.children;
      if (p.format === 'css') return cssText(cssFor(doc, ids[0], { root: true }));
      return p.format === 'react' ? toReact(doc, ids) : toHTML(doc, ids);
    },
  },
);
