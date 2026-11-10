// Regressions from the second independent check (2026-11-11): documents, SVG files and agent calls are
// untrusted input, so none of them may inject script, hang the page or rewrite structure.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.navigator ??= { platform: 'test' };
await import('../src/commands.js');
await import('../src/commands-vector.js');
await import('../src/commands-layer4.js');
await import('../src/commands-layer5.js');
await import('../src/commands-layer6.js');
const { get } = await import('../src/registry.js');
const { Tx, emptyDoc, validateDoc } = await import('../src/doc.js');
const { resolve } = await import('../src/resolve.js');
const { toHTML } = await import('../src/codegen.js');
const { toSVG } = await import('../src/export.js');
const { toPDF } = await import('../src/pdf.js');
const { parsePath } = await import('../src/vector.js');
const { worldMatrix, apply } = await import('../src/geom.js');

function exec(doc, id, params = {}, selection = []) {
  const tx = new Tx(doc);
  const r = get(id).doc(tx, params, { selection, state: { doc } });
  if (r === false) return { doc, r };
  resolve(tx);
  return { doc: tx.doc, r };
}
const n = (doc, id) => doc.nodes[id];
const rectDoc = (props) => validateDoc({ children: ['r'], nodes: { r: { id: 'r', type: 'rect', x: 0, y: 0, w: 10, h: 10, parent: null, ...props } } });

test('code export keeps hostile colours inside their CSS declaration', () => {
  const d = rectDoc({ fill: 'red;}</style><script>alert(2)</script><style>' });
  const html = toHTML(d, ['r']);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<\/style><script/);
});

test('SVG export and loading drop image data that is not base64 of a raster type', () => {
  const bad = { children: ['r'], nodes: { r: { id: 'r', type: 'rect', x: 0, y: 0, w: 10, h: 10, parent: null, fill: { type: 'image', asset: 'a', mode: 'fill' } } }, assets: { a: { mime: 'image/png', data: 'AAAA"/><script>alert(1)</script><x a="' }, s: { mime: 'image/svg+xml', data: 'PHN2Zz4=' } } };
  assert.doesNotMatch(toSVG(bad), /<script>/); // even without loading through validateDoc
  const d = validateDoc(bad);
  assert.deepEqual(Object.keys(d.assets), []);
  assert.throws(() => exec(emptyDoc(), 'asset.add', { mime: 'image/png', data: 'not base64!' }), /base64/);
  assert.throws(() => exec(emptyDoc(), 'asset.add', { mime: 'image/svg+xml', data: 'PHN2Zz4=' }), /Unsupported/);
});

test('path data with stray numbers parses and stops', { timeout: 2000 }, () => {
  const subs = parsePath('M0 0 L1 1 Z 5 6 L2 2');
  assert.equal(subs[0].closed, true);
  assert.equal(parsePath('5 5 5').length, 0);
  const { doc } = exec(emptyDoc(), 'import.svg', { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0 L5 5 Z 5"/></svg>' });
  assert.ok(doc.children.length === 1);
});

test('a document cannot use variable bindings to rewrite structure fields', () => {
  const d = validateDoc({
    children: ['r'],
    nodes: { r: { id: 'r', type: 'rect', x: 0, y: 0, w: 10, h: 10, parent: null, bind: { parent: 'v1', type: 'v1', text: 'v1' } } },
    variables: { collections: { c: { name: 'c', modes: [{ id: 'm', name: 'm' }] } }, vars: { v1: { name: 'v', collection: 'c', type: 'string', values: { m: 'zzz' } } } },
  });
  assert.deepEqual(Object.keys(n(d, 'r').bind), ['text']);
  // Even with the bind map written back in directly, resolve only drives properties of the variable's kind.
  const raw = { ...d, nodes: { r: { ...n(d, 'r'), bind: { parent: 'v1', type: 'v1' } } } };
  const out = exec(raw, 'node.set', { ids: ['r'], props: { opacity: 0.5 } }).doc;
  assert.equal(n(out, 'r').type, 'rect');
  assert.equal(n(out, 'r').parent, null);
});

test('editing a rotated vector path keeps untouched points where they were', () => {
  let d = exec(emptyDoc(), 'vector.create', { d: 'M0 0 L100 0 L100 50 L0 50 Z', id: 'v' }).doc;
  d = exec(d, 'node.set', { ids: ['v'], props: { rotation: 45 } }).doc;
  const before = apply(worldMatrix(d, 'v'), { x: 0, y: 0 });
  d = exec(d, 'vector.setPath', { id: 'v', d: 'M0 0 L100 0 L130 80 L0 50 Z' }).doc;
  const after = apply(worldMatrix(d, 'v'), { x: 0, y: 0 });
  assert.ok(Math.hypot(before.x - after.x, before.y - after.y) < 0.02, `moved ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
});

test('the prototype flow start survives save and load', () => {
  let d = exec(emptyDoc(), 'node.create', { type: 'frame', id: 'f' }).doc;
  d = exec(d, 'proto.setStart', { id: 'f' }).doc;
  assert.equal(validateDoc(JSON.parse(JSON.stringify(d))).flowStart, 'f');
});

test('SVG <use> cycles and blow-ups are refused', { timeout: 5000 }, () => {
  const cyc = '<svg xmlns="http://www.w3.org/2000/svg"><g id="a"><rect width="1" height="1"/><use href="#a"/></g></svg>';
  assert.ok(exec(emptyDoc(), 'import.svg', { svg: cyc }).doc.children.length === 1);
  let defs = '<g id="l0"><rect width="1" height="1"/></g>';
  for (let i = 1; i <= 22; i++) defs += `<g id="l${i}"><use href="#l${i - 1}"/><use href="#l${i - 1}"/></g>`;
  const bomb = `<svg xmlns="http://www.w3.org/2000/svg"><defs>${defs}</defs><use href="#l22"/></svg>`;
  assert.throws(() => exec(emptyDoc(), 'import.svg', { svg: bomb }), /too complex/);
});

test('pages: a missing target is refused, broken page lists are repaired on load', () => {
  let d = exec(emptyDoc(), 'node.create', { type: 'rect', id: 'r' }).doc;
  assert.throws(() => exec(d, 'node.moveToPage', { ids: ['r'], page: 'nope' }), /No page/);
  const fixed = validateDoc({ children: ['r'], nodes: { r: { id: 'r', type: 'rect', x: 0, y: 0, w: 1, h: 1, parent: null } }, pages: [{ id: 'p1', name: 'A', children: ['r', 'ghost'] }], page: 'missing' });
  assert.equal(fixed.page, 'p1');
  assert.deepEqual(fixed.pages[0].children, ['r']);
});

test('aliases must point at an existing variable of the same type', () => {
  let d = exec(emptyDoc(), 'variable.createCollection', { id: 'c' }).doc;
  d = exec(d, 'variable.create', { collection: 'c', name: 'n', type: 'number', value: 5, id: 'num' }).doc;
  assert.throws(() => exec(d, 'variable.create', { collection: 'c', name: 'col', type: 'color', value: { alias: 'num' } }), /cannot alias/);
  assert.throws(() => exec(d, 'variable.create', { collection: 'c', name: 'col', type: 'color', value: { alias: 'nope' } }), /No variable/);
});

test('hostile numbers load as safe values and export cleanly', () => {
  const d = rectDoc({ dash: 'x', strokeWidth: 'NaN', stroke: '#000000', grids: [{ type: 'columns', count: 1e9 }], x: 1e300 });
  assert.equal(n(d, 'r').dash, undefined);
  assert.equal(n(d, 'r').grids[0].count, 200);
  assert.doesNotThrow(() => toSVG(d));
  const pdf = Buffer.from(toPDF(d)).toString('latin1');
  assert.doesNotMatch(pdf, /NaN|e\+/);
});
