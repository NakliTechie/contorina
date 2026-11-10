// Layer 3 (paints, images, vectors, booleans) and regressions from the 2026-11-11 checker report.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.navigator ??= { platform: 'test' };
await import('../src/commands.js');
await import('../src/commands-vector.js');
const { get } = await import('../src/registry.js');
const { Tx, emptyDoc, makeNode } = await import('../src/doc.js');
const { resolve } = await import('../src/resolve.js');
const { toSVG } = await import('../src/export.js');
const V = await import('../src/vector.js');

function exec(doc, id, params = {}, selection = []) {
  const tx = new Tx(doc);
  const r = get(id).doc(tx, params, { selection });
  if (r === false) return { doc, r };
  resolve(tx);
  return { doc: tx.doc, r };
}
const n = (doc, id) => doc.nodes[id];

test('path parsing normalises relative, shorthand, quadratic and arc commands', () => {
  const subs = V.parsePath('m10 10 h20 v20 q0 10 -10 10 t-10 -10 a5 5 0 0 1 -10 0 z');
  assert.equal(subs.length, 1);
  assert.ok(subs[0].closed);
  assert.deepEqual(subs[0].segs.slice(0, 3).map((s) => [s.c, ...s.pts.flat()]), [['M', 10, 10], ['L', 30, 10], ['L', 30, 30]]);
  assert.ok(subs[0].segs.every((s) => ['M', 'L', 'C'].includes(s.c)));
  const b = V.boundsOf(V.parsePath('M0 0 C0 -10 10 -10 10 0'));
  assert.ok(Math.abs(b.y - -7.5) < 0.1); // the cubic's peak, not its control points
});

test('anchors round-trip through path data', () => {
  const d = 'M0 0 C10 0 20 10 20 20 L0 20 Z';
  const a = V.toAnchors(V.parsePath(d));
  assert.equal(a[0].nodes.length, 3);
  assert.deepEqual(a[0].nodes[0].out, [10, 0]);
  const again = V.toAnchors(V.parsePath(V.fromAnchors(a)));
  assert.deepEqual(again, a);
});

test('vector.create fits the layer box to the path; vector.setPath refits and keeps the drawing in place', () => {
  const { doc, r } = exec(emptyDoc(), 'vector.create', { d: 'M50 50 L150 50 L100 120 Z', id: 'v' });
  assert.equal(r.value, 'v');
  assert.deepEqual([n(doc, 'v').x, n(doc, 'v').y, n(doc, 'v').w, n(doc, 'v').h], [50, 50, 100, 70]);
  assert.equal(n(doc, 'v').d, 'M0 0 L100 0 L50 70 Z');
  // Drag the bottom point down by 30 in layer units.
  const d2 = exec(doc, 'vector.setPath', { id: 'v', d: 'M0 0 L100 0 L50 100 Z' }).doc;
  assert.deepEqual([n(d2, 'v').x, n(d2, 'v').y, n(d2, 'v').h], [50, 50, 100]);
  // Move the left point left by 10: the box grows to the left and the path shifts right.
  const d3 = exec(doc, 'vector.setPath', { id: 'v', d: 'M-10 0 L100 0 L50 70 Z' }).doc;
  assert.equal(n(d3, 'v').x, 40);
  assert.equal(n(d3, 'v').w, 110);
  assert.match(n(d3, 'v').d, /^M0 0 L110 0/);
});

test('booleans: union and subtract of two squares', () => {
  let d = emptyDoc();
  d = exec(d, 'node.create', { type: 'rect', x: 0, y: 0, w: 100, h: 100, id: 'a' }).doc;
  d = exec(d, 'node.create', { type: 'rect', x: 50, y: 0, w: 100, h: 100, id: 'b', props: { fill: '#FF0000' } }).doc;
  const u = exec(d, 'boolean.apply', { ids: ['a', 'b'], op: 'union' });
  const un = n(u.doc, u.r.value);
  assert.equal(un.type, 'vector');
  assert.deepEqual([un.x, un.y, un.w, un.h], [0, 0, 150, 100]);
  assert.equal(un.fill, '#D9D9D9'); // the bottom-most layer's paint
  assert.ok(!u.doc.nodes.a && !u.doc.nodes.b);
  const s = exec(d, 'boolean.apply', { ids: ['b', 'a'], op: 'subtract' });
  const sn = n(s.doc, s.r.value);
  assert.deepEqual([sn.x, sn.w], [0, 50]);
  const i = exec(d, 'boolean.intersect', {}, ['a', 'b']);
  assert.equal(n(i.doc, i.doc.children[0]).w, 50);
});

test('flatten bakes rotation and per-corner radius into a path', () => {
  let d = emptyDoc();
  d = exec(d, 'node.create', { type: 'rect', x: 0, y: 0, w: 100, h: 50, id: 'r', props: { rotation: 90, radius: [10, 0, 0, 0] } }).doc;
  const f = exec(d, 'node.flatten', { ids: ['r'] });
  const v = n(f.doc, f.r.select[0]);
  assert.equal(v.type, 'vector');
  assert.equal(v.rotation, 0);
  assert.ok(Math.abs(v.w - 50) < 0.01 && Math.abs(v.h - 100) < 0.01);
  assert.ok(Math.abs(v.x - 25) < 0.01 && Math.abs(v.y + 25) < 0.01);
  assert.match(v.d, /C/);
});

test('polygon and star outlines', () => {
  assert.equal(V.parsePath(V.polygonD(6))[0].segs.length, 6);
  assert.equal(V.parsePath(V.starD(5, 0.4))[0].segs.length, 10);
  const { doc } = exec(emptyDoc(), 'node.create', { type: 'star', x: 0, y: 0, w: 100, h: 100, id: 's' });
  assert.equal(n(doc, 's').points, 5);
  assert.match(toSVG(doc), /<path d="M50 0 L/);
});

test('images: an asset is stored once and drawn through an image paint', () => {
  let d = emptyDoc();
  const a = exec(d, 'asset.add', { mime: 'image/png', data: 'iVBORw0KGgo=', name: 'pic', w: 40, h: 20, id: 'img1' });
  d = a.doc;
  assert.equal(a.r.value, 'img1');
  assert.throws(() => exec(d, 'asset.add', { mime: 'text/html', data: 'x' }), /Unsupported/);
  const p = exec(d, 'image.place', { asset: 'img1', x: 5, y: 5 });
  const r = n(p.doc, p.r.value);
  assert.deepEqual([r.w, r.h, r.fill.type, r.fill.asset], [40, 20, 'image', 'img1']);
  const svg = toSVG(p.doc);
  assert.match(svg, /<pattern[^>]*><image href="data:image\/png;base64,iVBORw0KGgo="/);
});

test('SVG export writes gradients, shadows, dashes and escapes hostile attribute values', () => {
  let d = emptyDoc();
  d = exec(d, 'node.create', { type: 'rect', x: 0, y: 0, w: 100, h: 100, id: 'g', props: {
    fill: [{ type: 'linear', angle: 0, stops: [{ pos: 0, color: '#FF0000' }, { pos: 1, color: '#0000FF' }] }],
    stroke: '#000000', strokeWidth: 2, dash: [4, 2], effects: [{ type: 'drop', x: 0, y: 4, blur: 8, color: '#00000040' }],
  } }).doc;
  d = exec(d, 'node.create', { type: 'text', x: 0, y: 120, id: 't', props: { text: 'x', fontWeight: '400" onload="alert(1)' } }).doc;
  const svg = toSVG(d);
  assert.match(svg, /<linearGradient id="f\d+" x1="0" y1="0.5" x2="1" y2="0.5">/);
  assert.match(svg, /<feDropShadow dx="0" dy="4" stdDeviation="4"/);
  assert.match(svg, /stroke-dasharray="4 2"/);
  assert.doesNotMatch(svg, /onload=/);
});

test('checker regressions: styles and layout removal on an instance root stick', () => {
  let d = emptyDoc();
  d = exec(d, 'node.create', { type: 'frame', x: 0, y: 0, w: 100, h: 40, id: 'm' }).doc;
  d = exec(d, 'node.create', { type: 'rect', parent: 'm', x: 0, y: 0, w: 20, h: 20, id: 'k' }).doc;
  d = exec(d, 'layout.add', { ids: ['m'] }).doc;
  d = exec(d, 'component.create', {}, ['m']).doc;
  d = exec(d, 'component.instance', { mainId: 'm', id: 'i' }).doc;
  d = exec(d, 'style.create', { type: 'color', name: 'Brand', value: '#123456', id: 'sB' }).doc;
  d = exec(d, 'node.applyStyle', { ids: ['i'], kind: 'fill', styleId: 'sB' }).doc;
  assert.equal(n(d, 'i').fillStyle, 'sB');
  assert.match(toSVG(d, ['i']), /#123456/);
  d = exec(d, 'layout.remove', { ids: ['i'] }).doc;
  assert.equal(n(d, 'i').layout, null);
  assert.ok(n(d, 'm').layout); // the main keeps its layout
  d = exec(d, 'node.applyStyle', { ids: ['i'], kind: 'fill', styleId: null }).doc;
  assert.equal(n(d, 'i').fillStyle, null);
});

test('checker regressions: reparenting out of a rotated frame keeps the on-screen angle; ids and types cannot be smuggled in', () => {
  let d = emptyDoc();
  d = exec(d, 'node.create', { type: 'frame', x: 0, y: 0, w: 200, h: 200, id: 'f', props: { rotation: 30 } }).doc;
  d = exec(d, 'node.create', { type: 'rect', parent: 'f', x: 50, y: 50, w: 20, h: 20, id: 'r' }).doc;
  d = exec(d, 'node.reparent', { ids: ['r'], parent: null }).doc;
  assert.equal(n(d, 'r').rotation, 30);
  const m = makeNode('rect', { type: 'frame', children: ['x'], id: 'z' });
  assert.equal(m.type, 'rect');
  assert.equal(m.children, undefined);
});
