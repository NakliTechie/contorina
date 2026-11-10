// Layers 4 and 5: variables and modes, prototype links, pages, grids, SVG and Figma import,
// code export and PDF export.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.navigator ??= { platform: 'test' };
await import('../src/commands.js');
await import('../src/commands-vector.js');
await import('../src/commands-layer4.js');
await import('../src/commands-layer5.js');
const { get } = await import('../src/registry.js');
const { Tx, emptyDoc } = await import('../src/doc.js');
const { resolve } = await import('../src/resolve.js');
const { toHTML, toReact, cssFor } = await import('../src/codegen.js');
const { toPDF } = await import('../src/pdf.js');
const { parseXML, parseColor, parseTransform } = await import('../src/import-svg.js');

function exec(doc, id, params = {}, selection = []) {
  const tx = new Tx(doc);
  const r = get(id).doc(tx, params, { selection, state: { doc } });
  if (r === false) return { doc, r };
  resolve(tx);
  return { doc: tx.doc, r };
}
const run = (doc, id, params = {}, selection = []) => get(id).run(params, { selection, state: { doc } }, {});
const n = (doc, id) => doc.nodes[id];

test('variables: modes switch values for a frame and everything inside it; aliases resolve', () => {
  let d = emptyDoc();
  d = exec(d, 'variable.createCollection', { name: 'Theme', id: 'c' }).doc;
  const mLight = d.variables.collections.c.modes[0].id;
  d = exec(d, 'variable.addMode', { collection: 'c', name: 'Dark', id: 'dark' }).doc;
  d = exec(d, 'variable.create', { collection: 'c', name: 'bg', type: 'color', value: '#FFFFFF', id: 'bg' }).doc;
  d = exec(d, 'variable.set', { id: 'bg', mode: 'dark', value: '#111111' }).doc;
  d = exec(d, 'variable.create', { collection: 'c', name: 'surface', type: 'color', value: { alias: 'bg' }, id: 'surface' }).doc;
  d = exec(d, 'variable.create', { collection: 'c', name: 'pad', type: 'number', value: 120, id: 'w' }).doc;
  d = exec(d, 'node.create', { type: 'frame', x: 0, y: 0, w: 200, h: 200, id: 'f' }).doc;
  d = exec(d, 'node.create', { type: 'rect', parent: 'f', x: 0, y: 0, w: 10, h: 10, id: 'r' }).doc;
  d = exec(d, 'node.bindVariable', { ids: ['r'], prop: 'fill', variable: 'surface' }).doc;
  d = exec(d, 'node.bindVariable', { ids: ['r'], prop: 'w', variable: 'w' }).doc;
  assert.equal(n(d, 'r').fill, '#FFFFFF');
  assert.equal(n(d, 'r').w, 120);
  d = exec(d, 'node.setMode', { ids: ['f'], collection: 'c', mode: 'dark' }).doc;
  assert.equal(n(d, 'r').fill, '#111111');
  assert.ok(mLight);
  assert.throws(() => exec(d, 'node.bindVariable', { ids: ['r'], prop: 'fill', variable: 'w' }), /cannot drive/);
  assert.throws(() => exec(d, 'variable.set', { id: 'bg', mode: 'dark', value: 'red' }), /colour/);
  // Setting the property directly detaches it; deleting a variable keeps the current value.
  const d2 = exec(d, 'node.set', { ids: ['r'], props: { w: 33 } }).doc;
  assert.equal(n(d2, 'r').w, 33);
  assert.equal(n(d2, 'r').bind.w, undefined);
  const d3 = exec(d, 'variable.delete', { id: 'surface' }).doc;
  assert.equal(n(d3, 'r').fill, '#111111');
  assert.equal(n(d3, 'r').bind.fill, undefined);
});

test('prototype links validate their action and target', () => {
  let d = emptyDoc();
  d = exec(d, 'node.create', { type: 'frame', id: 'a' }).doc;
  d = exec(d, 'node.create', { type: 'frame', x: 300, id: 'b' }).doc;
  d = exec(d, 'proto.set', { ids: ['a'], proto: { action: 'navigate', target: 'b', transition: 'dissolve' } }).doc;
  assert.deepEqual(n(d, 'a').proto, { trigger: 'click', action: 'navigate', transition: 'dissolve', duration: 300, target: 'b' });
  assert.throws(() => exec(d, 'proto.set', { ids: ['a'], proto: { action: 'navigate', target: 'nope' } }), /target/);
  assert.throws(() => exec(d, 'proto.set', { ids: ['a'], proto: { action: 'url', url: 'javascript:alert(1)' } }), /http/);
  d = exec(d, 'proto.setStart', { id: 'b' }).doc;
  assert.equal(d.flowStart, 'b');
});

test('pages: add, switch, move layers between pages, delete', () => {
  let d = emptyDoc();
  d = exec(d, 'node.create', { type: 'rect', id: 'r1' }).doc;
  const { doc: d1, r } = exec(d, 'page.add', { name: 'Two' });
  assert.equal(d1.pages.length, 2);
  assert.deepEqual(d1.children, []);
  let d2 = exec(d1, 'node.create', { type: 'rect', id: 'r2' }).doc;
  d2 = exec(d2, 'page.open', { id: 'page1' }).doc;
  assert.deepEqual(d2.children, ['r1']);
  d2 = exec(d2, 'node.moveToPage', { ids: ['r1'], page: r.value }).doc;
  assert.deepEqual(d2.children, []);
  d2 = exec(d2, 'page.open', { id: r.value }).doc;
  assert.deepEqual(d2.children.sort(), ['r1', 'r2']);
  d2 = exec(d2, 'page.delete', { id: r.value }).doc;
  assert.equal(d2.pages.length, 1);
  assert.ok(!d2.nodes.r1 && !d2.nodes.r2);
});

test('SVG import: shapes, transforms, groups, gradients and text', () => {
  assert.equal(parseColor('#abc'), '#AABBCC');
  assert.equal(parseColor('rgb(255, 0, 0)'), '#FF0000');
  assert.equal(parseColor('none'), null);
  assert.deepEqual(parseTransform('translate(10 20) scale(2)'), [2, 0, 0, 2, 10, 20]);
  assert.equal(parseXML('<a x="1 &amp; 2"><b/>t</a>').children[0].attrs.x, '1 & 2');
  const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="400" height="200">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs>
    <rect x="10" y="10" width="50" height="20" rx="4" fill="url(#g)"/>
    <g id="icons" transform="translate(100 0)"><circle cx="20" cy="20" r="10" fill="#0f0"/><path d="M0 50 L40 50 L20 80 Z" fill="none" stroke="black" stroke-width="2"/></g>
    <text x="100" y="95" font-size="10" text-anchor="middle">Hi &amp; bye</text>
    <rect x="0" y="0" width="10" height="10" transform="rotate(45)"/>
  </svg>`;
  const { doc, r } = exec(emptyDoc(), 'import.svg', { svg, x: 0, y: 0 });
  const root = n(doc, r.value);
  assert.deepEqual([root.w, root.h], [400, 200]);
  const kids = root.children.map((id) => n(doc, id));
  const rect = kids.find((k) => k.type === 'rect');
  assert.deepEqual([rect.x, rect.y, rect.w, rect.h, rect.radius], [20, 20, 100, 40, 8]);
  assert.equal(rect.fill[0].type, 'linear');
  const group = kids.find((k) => k.name === 'icons');
  assert.equal(group.type, 'frame');
  const circle = n(doc, group.children[0]);
  assert.equal(circle.type, 'ellipse');
  assert.equal(circle.fill, '#00FF00');
  const path = n(doc, group.children[1]);
  assert.equal(path.type, 'vector');
  assert.equal(path.stroke, '#000000');
  assert.equal(path.strokeWidth, 4);
  const text = kids.find((k) => k.type === 'text');
  assert.equal(text.text, 'Hi & bye');
  assert.equal(text.fontSize, 20);
  assert.ok(text.x < 200); // centred on x = 200 after measuring
  assert.ok(kids.some((k) => k.type === 'vector' && k.name === 'Rectangle')); // the rotated rect
  assert.throws(() => exec(emptyDoc(), 'import.svg', { svg: '<html></html>' }), /Not an SVG/);
});

test('Figma REST JSON import: pages, frames with auto layout, text, vectors, paints and effects', () => {
  const json = {
    name: 'Kit', document: { type: 'DOCUMENT', children: [{ type: 'CANVAS', name: 'Cover', children: [{
      type: 'FRAME', name: 'Card', absoluteBoundingBox: { x: 100, y: 50, width: 300, height: 200 }, size: { x: 300, y: 200 },
      relativeTransform: [[1, 0, 100], [0, 1, 50]], fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
      effects: [{ type: 'DROP_SHADOW', offset: { x: 0, y: 4 }, radius: 8, color: { r: 0, g: 0, b: 0, a: 0.25 } }],
      cornerRadius: 12, clipsContent: true, layoutMode: 'VERTICAL', itemSpacing: 8, paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16, primaryAxisAlignItems: 'MIN', counterAxisAlignItems: 'CENTER',
      layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'HUG',
      children: [
        { type: 'TEXT', name: 'Title', characters: 'Hello', size: { x: 60, y: 24 }, relativeTransform: [[1, 0, 16], [0, 1, 16]], fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }], style: { fontFamily: 'Inter', fontWeight: 700, fontSize: 20, lineHeightPx: 24, textAlignHorizontal: 'LEFT', textAutoResize: 'WIDTH_AND_HEIGHT' } },
        { type: 'VECTOR', name: 'Icon', size: { x: 24, y: 24 }, relativeTransform: [[1, 0, 16], [0, 1, 48]], fills: [{ type: 'GRADIENT_LINEAR', gradientHandlePositions: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }, { x: 0, y: 1 }], gradientStops: [{ position: 0, color: { r: 1, g: 0, b: 0, a: 1 } }, { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } }] }], fillGeometry: [{ path: 'M0 0L24 0L12 24Z', windingRule: 'NONZERO' }] },
      ],
    }] }, { type: 'CANVAS', name: 'Empty', children: [] }] },
  };
  const { doc, r } = exec(emptyDoc(), 'import.figma', { json });
  assert.equal(r.value, 2);
  assert.deepEqual(doc.pages.map((p) => p.name), ['Page 1', 'Cover', 'Empty']);
  const card = n(doc, doc.children[0]);
  assert.deepEqual([card.x, card.y, card.w, card.radius, card.layout.mode, card.layout.gap, card.layout.align], [100, 50, 300, 12, 'column', 8, 'center']);
  assert.equal(card.effects[0].type, 'drop');
  assert.equal(card.effects[0].color, '#00000040');
  const [title, icon] = card.children.map((id) => n(doc, id));
  assert.equal(title.text, 'Hello');
  assert.equal(title.fontWeight, 700);
  assert.equal(icon.type, 'vector');
  assert.equal(icon.fill.type, 'linear');
  assert.equal(icon.fill.angle, 0);
  assert.ok(card.h > 16 + 24 + 8 + 24); // hug height from the auto layout
});

test('code export: auto layout becomes flexbox, text keeps its font, React output is a component', () => {
  let d = emptyDoc();
  d = exec(d, 'node.create', { type: 'rect', x: 0, y: 0, w: 40, h: 40, id: 'a', props: { name: 'Avatar', radius: 20, effects: [{ type: 'drop', x: 0, y: 2, blur: 4, color: '#00000040' }] } }).doc;
  d = exec(d, 'node.create', { type: 'text', x: 60, y: 10, id: 't', props: { text: 'Ada <Lovelace>', fontSize: 14, fontWeight: 600 } }).doc;
  const { doc } = exec(d, 'layout.add', { ids: ['a', 't'] });
  const frame = doc.children[0];
  const css = cssFor(doc, frame, { root: true });
  assert.equal(css.display, 'flex');
  assert.equal(css['flex-direction'], 'row');
  assert.equal(css.gap, '10px');
  const html = toHTML(doc, [frame]);
  assert.match(html, /<p class="ada-lovelace">Ada &lt;Lovelace&gt;<\/p>/);
  assert.match(html, /box-shadow: 0px 2px 4px 0px #00000040;/);
  assert.match(html, /border-radius: 20px;/);
  const jsx = toReact(doc, [frame]);
  assert.match(jsx, /^export default function Frame\(\)/);
  assert.match(jsx, /fontWeight: "600"/);
  assert.equal(run(doc, 'export.code', { ids: ['a'], format: 'css' }).includes('border-radius: 20px;'), true);
});

test('PDF export: a valid file with one page per layer and an xref that points at each object', () => {
  let d = emptyDoc();
  d = exec(d, 'node.create', { type: 'frame', x: 0, y: 0, w: 200, h: 100, id: 'f1', props: { fill: '#FFEEDD' } }).doc;
  d = exec(d, 'node.create', { type: 'text', parent: 'f1', x: 10, y: 10, id: 't', props: { text: 'Héllo (PDF) — ✓' } }).doc;
  d = exec(d, 'node.create', { type: 'ellipse', x: 300, y: 0, w: 50, h: 50, id: 'e', props: { opacity: 0.5, stroke: '#000000', strokeWidth: 2 } }).doc;
  const bytes = toPDF(d);
  const s = Buffer.from(bytes).toString('latin1');
  assert.match(s, /^%PDF-1\.4/);
  assert.match(s, /\/Count 2/);
  assert.match(s, /\(H\xe9llo \\\(PDF\\\) \x97 \?\) Tj/);
  assert.match(s, /\/ca 0\.5/);
  // Every xref offset lands on "N 0 obj".
  const xref = s.slice(s.lastIndexOf('xref'));
  const offsets = [...xref.matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
  offsets.forEach((o, i) => assert.ok(s.startsWith(`${i + 1} 0 obj`, o), `object ${i + 1}`));
  const startxref = Number(s.match(/startxref\n(\d+)/)[1]);
  assert.ok(s.startsWith('xref', startxref));
});
