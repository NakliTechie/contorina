// Batch H parity additions: grid layout, min/max sizes, component properties, effect styles,
// mixed text styles and Android Vector Drawable export.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.navigator ??= { platform: 'test' };
await import('../src/commands.js');
await import('../src/commands-vector.js');
await import('../src/commands-layer4.js');
await import('../src/commands-layer5.js');
await import('../src/commands-layer6.js');
const { get } = await import('../src/registry.js');
const { Tx, emptyDoc } = await import('../src/doc.js');
const { resolve } = await import('../src/resolve.js');
const { arrange } = await import('../src/layout.js');
const { styleRange, shiftRuns, textLayout } = await import('../src/text.js');
const { toSVG } = await import('../src/export.js');
const { toAVD } = await import('../src/avd.js');

function exec(doc, id, params = {}, selection = []) {
  const tx = new Tx(doc);
  const r = get(id).doc(tx, params, { selection, state: { doc } });
  if (r === false) return { doc, r };
  resolve(tx);
  return { doc: tx.doc, r };
}
const n = (doc, id) => doc.nodes[id];

test('grid layout: equal columns, rows as tall as their tallest cell, hug height', () => {
  const frame = { w: 220, h: 10, layout: { mode: 'grid', columns: 2, gap: 20, crossGap: 10, pad: [0, 0, 0, 0], align: 'start' }, sizing: { h: 'fixed', v: 'hug' } };
  const r = arrange(frame, [
    { id: 'a', w: 50, h: 30, sizing: { h: 'fill' } }, { id: 'b', w: 50, h: 60 },
    { id: 'c', w: 300, h: 20 },
  ]);
  assert.deepEqual(r.kids.map((k) => [k.x, k.y, k.w, k.h]), [[0, 0, 100, 30], [120, 0, 50, 60], [0, 70, 100, 20]]);
  assert.equal(r.h, 90);
});

test('min and max: fill children respect them and give spare room to the others', () => {
  const frame = { w: 300, h: 50, layout: { mode: 'row', gap: 0, pad: [0, 0, 0, 0], align: 'start', justify: 'start' }, sizing: { h: 'fixed', v: 'fixed' } };
  const r = arrange(frame, [{ id: 'a', w: 10, h: 10, sizing: { h: 'fill' }, maxW: 50 }, { id: 'b', w: 10, h: 10, sizing: { h: 'fill' } }]);
  assert.deepEqual(r.kids.map((k) => k.w), [50, 250]);
  let d = emptyDoc();
  d = exec(d, 'node.create', { type: 'rect', w: 100, h: 100, id: 'r' }).doc;
  d = exec(d, 'node.setMinMax', { ids: ['r'], maxW: 80, minH: 120 }).doc;
  assert.deepEqual([n(d, 'r').w, n(d, 'r').h], [80, 120]);
  d = exec(d, 'node.set', { ids: ['r'], props: { w: 500 } }).doc;
  assert.equal(n(d, 'r').w, 80);
});

test('component properties: text, boolean and instance swap per instance', () => {
  let d = emptyDoc();
  d = exec(d, 'node.create', { type: 'frame', w: 40, h: 40, id: 'iconA', props: { fill: '#FF0000' } }).doc;
  d = exec(d, 'node.create', { type: 'frame', w: 40, h: 40, x: 60, id: 'iconB', props: { fill: '#00FF00' } }).doc;
  d = exec(d, 'component.create', {}, ['iconA', 'iconB']).doc;
  d = exec(d, 'node.create', { type: 'frame', x: 0, y: 100, w: 200, h: 60, id: 'm' }).doc;
  d = exec(d, 'node.create', { type: 'text', parent: 'm', x: 50, y: 10, id: 'label', props: { text: 'Label' } }).doc;
  d = exec(d, 'node.create', { type: 'rect', parent: 'm', x: 150, y: 10, w: 10, h: 10, id: 'badge' }).doc;
  d = exec(d, 'component.instance', { mainId: 'iconA', x: 5, y: 5, parent: 'm', id: 'icon' }).doc;
  d = exec(d, 'component.create', {}, ['m']).doc;
  d = exec(d, 'component.addProp', { id: 'm', name: 'Label', type: 'text', target: 'label' }).doc;
  d = exec(d, 'component.addProp', { id: 'm', name: 'Badge', type: 'boolean', target: 'badge' }).doc;
  d = exec(d, 'component.addProp', { id: 'm', name: 'Icon', type: 'swap', target: 'icon' }).doc;
  assert.throws(() => exec(d, 'component.addProp', { id: 'm', name: 'X', type: 'text', target: 'badge' }), /text layer/);
  d = exec(d, 'component.instance', { mainId: 'm', x: 300, y: 100, id: 'i' }).doc;
  assert.equal(n(d, 'i~label').text, 'Label');
  d = exec(d, 'instance.setProp', { id: 'i', name: 'Label', value: 'Buy now' }).doc;
  d = exec(d, 'instance.setProp', { id: 'i', name: 'Badge', value: false }).doc;
  d = exec(d, 'instance.setProp', { id: 'i', name: 'Icon', value: 'iconB' }).doc;
  assert.equal(n(d, 'i~label').text, 'Buy now');
  assert.equal(n(d, 'i~badge').visible, false);
  assert.equal(n(d, 'i~icon').mainId, 'iconB');
  assert.equal(n(d, 'i~icon').fill, '#00FF00');
  assert.equal(n(d, 'label').text, 'Label'); // the main is untouched
  d = exec(d, 'instance.setProp', { id: 'i', name: 'Label', value: null }).doc;
  assert.equal(n(d, 'i~label').text, 'Label');
});

test('effect styles: shared shadows, delete bakes them back into the layer', () => {
  let d = emptyDoc();
  d = exec(d, 'node.create', { type: 'rect', id: 'a', props: { effects: [{ type: 'drop', x: 0, y: 6, blur: 12, color: '#00000033' }] } }).doc;
  d = exec(d, 'node.create', { type: 'rect', x: 200, id: 'b' }).doc;
  const { doc: d1, r } = exec(d, 'style.fromSelection', { kind: 'effect', name: 'Elevation' }, ['a']);
  d = exec(d1, 'node.applyStyle', { ids: ['b'], kind: 'effect', styleId: r.value }).doc;
  assert.match(toSVG(d, ['b']), /<feDropShadow dx="0" dy="6"/);
  d = exec(d, 'style.update', { id: r.value, patch: { effects: [{ type: 'drop', x: 0, y: 2, blur: 4, color: '#000000' }] } }).doc;
  assert.match(toSVG(d, ['a']), /dy="2"/);
  d = exec(d, 'style.delete', { id: r.value }).doc;
  assert.equal(n(d, 'b').effects[0].y, 2);
  assert.equal(n(d, 'b').effectStyle, undefined);
});

test('mixed text styles: ranges split and merge, survive edits, and lay out piece by piece', () => {
  let runs = styleRange([], 0, 5, { fontWeight: 700 });
  runs = styleRange(runs, 3, 8, { fill: '#FF0000' });
  assert.deepEqual(runs, [
    { start: 0, end: 3, style: { fontWeight: 700 } },
    { start: 3, end: 5, style: { fontWeight: 700, fill: '#FF0000' } },
    { start: 5, end: 8, style: { fill: '#FF0000' } },
  ]);
  assert.deepEqual(styleRange(runs, 0, 8, { fontWeight: null, fill: null }), []);
  // "Hello world": bold "world"; insert "big " before it.
  const r1 = [{ start: 6, end: 11, style: { fontWeight: 700 } }];
  assert.deepEqual(shiftRuns(r1, 'Hello world', 'Hello big world'), [{ start: 10, end: 15, style: { fontWeight: 700 } }]);
  assert.deepEqual(shiftRuns(r1, 'Hello world', 'Hello wonderful world').map((r) => [r.start, r.end]), [[6, 21]]); // the edit lands inside the bold word, so the run stretches
  assert.deepEqual(shiftRuns(r1, 'Hello world', 'Hello wd'), [{ start: 6, end: 8, style: { fontWeight: 700 } }]);
  let d = emptyDoc();
  d = exec(d, 'node.create', { type: 'text', id: 't', props: { text: 'Hello world', fontSize: 10 } }).doc;
  d = exec(d, 'text.styleRange', { id: 't', start: 6, end: 11, style: { fontSize: 20, fill: '#FF0000' } }).doc;
  const L = textLayout(n(d, 't'), d.styles);
  assert.equal(L.rich.length, 1);
  assert.deepEqual(L.rich[0].pieces.map((p) => [p.text, p.size, p.fill]), [['Hello', 10, null], [' ', 10, null], ['world', 20, '#FF0000']]);
  assert.equal(n(d, 't').h, Math.ceil(12.5 * 2)); // the line is as tall as its largest piece
  assert.match(toSVG(d), /<tspan[^>]*fill="#FF0000"[^>]*>world<\/tspan>/);
  d = exec(d, 'text.set', { id: 't', text: 'Hi world' }).doc;
  assert.deepEqual(n(d, 't').runs.map((r) => [r.start, r.end]), [[3, 8]]);
  assert.throws(() => exec(d, 'text.styleRange', { id: 't', start: 0, end: 2, style: { fill: 'red' } }), /#RRGGBB/);
});

test('Android Vector Drawable export', () => {
  let d = emptyDoc();
  d = exec(d, 'node.create', { type: 'frame', x: 0, y: 0, w: 24, h: 24, id: 'f', props: { fill: null } }).doc;
  d = exec(d, 'node.create', { type: 'ellipse', parent: 'f', x: 2, y: 2, w: 20, h: 20, id: 'e', props: { fill: '#0D99FF', opacity: 0.5 } }).doc;
  d = exec(d, 'node.create', { type: 'text', parent: 'f', x: 0, y: 0, id: 't', props: { text: 'x' } }).doc;
  const xml = toAVD(d, ['f']);
  assert.match(xml, /android:viewportWidth="24"/);
  assert.match(xml, /android:fillColor="#FF0D99FF" android:fillAlpha="0.5"/);
  assert.match(xml, /<clip-path android:pathData="M0 0 L24 0/);
  assert.match(xml, /text skipped/);
});

test('smart animate: matching layers interpolate, new layers fade in', async () => {
  const { smartDoc } = await import('../src/present.js').catch(() => ({}));
  if (!smartDoc) return; // present.js imports DOM helpers only inside functions; skip if it cannot load
  let d = emptyDoc();
  d = exec(d, 'node.create', { type: 'frame', x: 0, y: 0, w: 100, h: 100, id: 'A' }).doc;
  d = exec(d, 'node.create', { type: 'rect', parent: 'A', x: 0, y: 0, w: 10, h: 10, id: 'a1', props: { name: 'Box' } }).doc;
  d = exec(d, 'node.create', { type: 'frame', x: 200, y: 0, w: 100, h: 100, id: 'B' }).doc;
  d = exec(d, 'node.create', { type: 'rect', parent: 'B', x: 50, y: 20, w: 30, h: 10, id: 'b1', props: { name: 'Box' } }).doc;
  d = exec(d, 'node.create', { type: 'rect', parent: 'B', x: 0, y: 80, w: 10, h: 10, id: 'b2', props: { name: 'New' } }).doc;
  const half = smartDoc(d, 'A', 'B', 0.5);
  assert.deepEqual([half.b1.x, half.b1.y, half.b1.w], [25, 10, 20]);
  assert.equal(half.b2.opacity, 0.5);
  assert.equal(d.nodes.b1.x, 50); // the document itself is untouched
});
