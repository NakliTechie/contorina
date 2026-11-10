// Node tests for the DOM-free core: document model, commands, layout, constraints, components,
// variants, styles, expressions, palette matching and SVG export.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.navigator ??= { platform: 'test' };
await import('../src/commands.js');
const { get, manifest, inputSchema, all, comboOf, findByKey, normKey, isMac } = await import('../src/registry.js');
const { Tx, emptyDoc, makeNode, validateDoc } = await import('../src/doc.js');
const { resolve } = await import('../src/resolve.js');
const { arrange } = await import('../src/layout.js');
const { evalExpr } = await import('../src/expr.js');
const { score, rank } = await import('../src/fuzzy.js');
const { toSVG } = await import('../src/export.js');
const { snapBox, measure } = await import('../src/snap.js');
const { seedDoc } = await import('../src/seed.js');

// Run a document command the way the app runner does: fresh Tx, command, resolve.
function exec(doc, id, params = {}, selection = []) {
  const tx = new Tx(doc);
  const r = get(id).doc(tx, params, { selection });
  if (r === false) return { doc, r };
  resolve(tx);
  return { doc: tx.doc, r };
}
const n = (doc, id) => doc.nodes[id];

test('create, set and delete leave the previous document untouched (undo snapshots)', () => {
  const d0 = emptyDoc();
  const { doc: d1 } = exec(d0, 'node.create', { type: 'rect', x: 10, y: 20, w: 30, h: 40, id: 'a' });
  assert.equal(d0.children.length, 0);
  assert.deepEqual(d1.children, ['a']);
  const { doc: d2 } = exec(d1, 'node.set', { ids: ['a'], props: { fill: '#FF0000', w: 50 } });
  assert.equal(n(d1, 'a').fill, '#D9D9D9');
  assert.equal(n(d2, 'a').fill, '#FF0000');
  assert.equal(n(d2, 'a').w, 50);
  const { doc: d3 } = exec(d2, 'edit.delete', { ids: ['a'] });
  assert.equal(d3.children.length, 0);
  assert.ok(!d3.nodes.a);
  assert.ok(d2.nodes.a);
});

test('move into and out of a frame keeps the canvas position', () => {
  let d = emptyDoc();
  d = exec(d, 'node.create', { type: 'frame', x: 100, y: 100, w: 200, h: 200, id: 'f' }).doc;
  d = exec(d, 'node.create', { type: 'rect', x: 0, y: 0, w: 20, h: 20, id: 'r' }).doc;
  d = exec(d, 'node.move', { ids: ['r'], dx: 150, dy: 150, parent: 'f' }).doc;
  assert.equal(n(d, 'r').parent, 'f');
  assert.equal(n(d, 'r').x, 50);
  assert.equal(n(d, 'r').y, 50);
  d = exec(d, 'node.move', { ids: ['r'], dx: 0, dy: 0, parent: null }).doc;
  assert.equal(n(d, 'r').parent, null);
  assert.equal(n(d, 'r').x, 150);
  assert.ok(d.children.includes('r'));
});

test('a frame refuses to move into itself or its descendants', () => {
  let d = emptyDoc();
  d = exec(d, 'node.create', { type: 'frame', x: 0, y: 0, w: 200, h: 200, id: 'f' }).doc;
  d = exec(d, 'node.create', { type: 'frame', parent: 'f', x: 10, y: 10, w: 50, h: 50, id: 'g' }).doc;
  d = exec(d, 'node.move', { ids: ['f'], dx: 5, dy: 0, parent: 'g' }).doc;
  assert.equal(n(d, 'f').parent, null);
  assert.equal(n(d, 'f').x, 5);
});

test('arrange: row with gap, padding, hug and fill', () => {
  const frame = { w: 300, h: 100, layout: { mode: 'row', gap: 10, pad: [5, 10, 5, 10], align: 'center', justify: 'start' }, sizing: { h: 'fixed', v: 'hug' } };
  const r = arrange(frame, [{ id: 'a', w: 50, h: 20 }, { id: 'b', w: 10, h: 40, sizing: { h: 'fill' } }, { id: 'c', w: 30, h: 30 }]);
  assert.equal(r.h, 50); // hug height = tallest 40 + padding 10
  const [a, b, c] = r.kids;
  assert.equal(a.x, 10);
  assert.equal(b.w, 300 - 20 - 50 - 30 - 20); // fill takes what is left
  assert.equal(b.x, 70);
  assert.equal(c.x, 70 + b.w + 10);
  assert.equal(a.y, 5 + (40 - 20) / 2);
});

test('arrange: column hug, justify between, stretch', () => {
  const frame = { w: 100, h: 200, layout: { mode: 'column', gap: 0, pad: [0, 0, 0, 0], align: 'stretch', justify: 'between' }, sizing: { h: 'fixed', v: 'fixed' } };
  const r = arrange(frame, [{ id: 'a', w: 10, h: 20 }, { id: 'b', w: 10, h: 20 }]);
  assert.equal(r.kids[0].y, 0);
  assert.equal(r.kids[1].y, 180);
  assert.equal(r.kids[0].w, 100);
  const hug = arrange({ ...frame, sizing: { h: 'hug', v: 'hug' }, layout: { ...frame.layout, gap: 5, align: 'start' } }, [{ id: 'a', w: 10, h: 20 }, { id: 'b', w: 30, h: 20 }]);
  assert.equal(hug.h, 45);
  assert.equal(hug.w, 30);
});

test('arrange: row wrap breaks lines and hugs height', () => {
  const frame = { w: 100, h: 10, layout: { mode: 'row', wrap: true, gap: 10, pad: [0, 0, 0, 0], align: 'start', justify: 'start' }, sizing: { h: 'fixed', v: 'hug' } };
  const r = arrange(frame, [1, 2, 3, 4].map((i) => ({ id: 'k' + i, w: 40, h: 20 })));
  assert.deepEqual(r.kids.map((k) => [k.x, k.y]), [[0, 0], [50, 0], [0, 30], [50, 30]]);
  assert.equal(r.h, 50);
});

test('Shift+A wraps layers in an auto-layout frame ordered by position, and layout reorders on move', () => {
  let d = emptyDoc();
  d = exec(d, 'node.create', { type: 'rect', x: 200, y: 0, w: 50, h: 50, id: 'b' }).doc;
  d = exec(d, 'node.create', { type: 'rect', x: 0, y: 0, w: 50, h: 50, id: 'a' }).doc;
  const { doc: d1, r } = exec(d, 'layout.add', { ids: ['a', 'b'] });
  const f = n(d1, r.select[0]);
  assert.equal(f.layout.mode, 'row');
  assert.deepEqual(f.children, ['a', 'b']);
  assert.equal(n(d1, 'a').x, 10);
  assert.equal(n(d1, 'b').x, 70);
  assert.equal(f.w, 130); // hug: 10 + 50 + 10 + 50 + 10
  // Drag a to the right of b: the move reorders the flow.
  const d2 = exec(d1, 'node.move', { ids: ['a'], dx: 100, dy: 0 }).doc;
  assert.deepEqual(n(d2, f.id).children, ['b', 'a']);
  assert.equal(n(d2, 'b').x, 10);
});

test('constraints move and stretch children when a frame resizes', () => {
  let d = emptyDoc();
  d = exec(d, 'node.create', { type: 'frame', x: 0, y: 0, w: 200, h: 100, id: 'f' }).doc;
  d = exec(d, 'node.create', { type: 'rect', parent: 'f', x: 150, y: 10, w: 40, h: 20, id: 'right' }).doc;
  d = exec(d, 'node.create', { type: 'rect', parent: 'f', x: 10, y: 50, w: 180, h: 20, id: 'wide' }).doc;
  d = exec(d, 'node.create', { type: 'rect', parent: 'f', x: 80, y: 40, w: 40, h: 20, id: 'mid' }).doc;
  d = exec(d, 'node.setConstraints', { ids: ['right'], h: 'right' }).doc;
  d = exec(d, 'node.setConstraints', { ids: ['wide'], h: 'leftright', v: 'bottom' }).doc;
  d = exec(d, 'node.setConstraints', { ids: ['mid'], h: 'center' }).doc;
  d = exec(d, 'node.set', { ids: ['f'], props: { w: 300, h: 150 } }).doc;
  assert.equal(n(d, 'right').x, 250);
  assert.equal(n(d, 'wide').w, 280);
  assert.equal(n(d, 'wide').y, 100);
  assert.equal(n(d, 'mid').x, 130);
});

test('instances follow their main, keep overrides, and stretch by constraints', () => {
  let d = emptyDoc();
  d = exec(d, 'node.create', { type: 'frame', x: 0, y: 0, w: 100, h: 40, id: 'm' }).doc;
  d = exec(d, 'node.create', { type: 'text', parent: 'm', x: 10, y: 10, id: 't', props: { text: 'Hi' } }).doc;
  d = exec(d, 'node.create', { type: 'rect', parent: 'm', x: 80, y: 0, w: 20, h: 40, id: 'edge' }).doc;
  d = exec(d, 'node.setConstraints', { ids: ['edge'], h: 'right' }).doc;
  d = exec(d, 'component.create', {}, ['m']).doc;
  const { doc: d1, r } = exec(d, 'component.instance', { mainId: 'm', x: 200, y: 0, id: 'i' });
  assert.equal(r.value, 'i');
  assert.ok(n(d1, 'i~t'));
  assert.equal(n(d1, 'i~t').text, 'Hi');
  // Override the text on the instance.
  let d2 = exec(d1, 'text.set', { id: 'i~t', text: 'Yo' }).doc;
  assert.equal(n(d2, 'i~t').text, 'Yo');
  assert.equal(n(d2, 't').text, 'Hi');
  // Change the main: the fill reaches the instance, the overridden text stays.
  d2 = exec(d2, 'node.set', { ids: ['t'], props: { fill: '#FF0000', text: 'Hello' } }).doc;
  assert.equal(n(d2, 'i~t').fill, '#FF0000');
  assert.equal(n(d2, 'i~t').text, 'Yo');
  // Resize the instance: the right-pinned child follows.
  d2 = exec(d2, 'node.set', { ids: ['i'], props: { w: 160 } }).doc;
  assert.equal(n(d2, 'i~edge').x, 140);
  assert.equal(n(d2, 'edge').x, 80);
  // Reset clears overrides; detach turns the instance into a plain frame.
  const d3 = exec(d2, 'instance.reset', { ids: ['i'] }).doc;
  assert.equal(n(d3, 'i~t').text, 'Hello');
  const d4 = exec(d3, 'component.detach', { ids: ['i'] }).doc;
  assert.equal(n(d4, 'i').type, 'frame');
  assert.ok(!n(d4, 'i~t').src);
  const d5 = exec(d4, 'node.set', { ids: ['t'], props: { text: 'Changed' } }).doc;
  assert.equal(n(d5, 'i~t').text, 'Hello');
});

test('variants: combine, switch a property, overrides follow by layer name', () => {
  let d = emptyDoc();
  for (const [id, name, fill] of [['p', 'State=Default', '#0D99FF'], ['h', 'State=Hover', '#0B7FD4']]) {
    d = exec(d, 'node.create', { type: 'frame', x: 0, y: 0, w: 100, h: 40, id, props: { name, fill } }).doc;
    d = exec(d, 'node.create', { type: 'text', parent: id, x: 10, y: 10, id: id + 'L', props: { text: 'Go', name: 'Label' } }).doc;
  }
  d = exec(d, 'component.create', {}, ['p', 'h']).doc;
  const { doc: d1, r } = exec(d, 'component.combineVariants', {}, ['p', 'h']);
  const set = n(d1, r.value);
  assert.ok(set.variantSet);
  assert.deepEqual(n(d1, 'h').variant, { State: 'Hover' });
  let d2 = exec(d1, 'component.instance', { mainId: 'p', x: 400, y: 0, id: 'i' }).doc;
  d2 = exec(d2, 'text.set', { id: 'i~pL', text: 'Buy' }).doc;
  d2 = exec(d2, 'instance.setVariant', { id: 'i', prop: 'State', value: 'Hover' }).doc;
  assert.equal(n(d2, 'i').mainId, 'h');
  assert.equal(n(d2, 'i').fill, '#0B7FD4');
  assert.equal(n(d2, 'i~hL').text, 'Buy');
  assert.ok(!n(d2, 'i~pL'));
});

test('styles: apply by reference, edit reaches every user, delete bakes the value', () => {
  let d = emptyDoc();
  d = exec(d, 'node.create', { type: 'rect', id: 'a' }).doc;
  d = exec(d, 'node.create', { type: 'rect', id: 'b' }).doc;
  d = exec(d, 'style.create', { type: 'color', name: 'Brand', value: '#112233', id: 'sB' }).doc;
  d = exec(d, 'node.applyStyle', { ids: ['a', 'b'], kind: 'fill', styleId: 'sB' }).doc;
  d = exec(d, 'style.update', { id: 'sB', patch: { value: '#445566' } }).doc;
  const svg = toSVG(d, ['a']);
  assert.match(svg, /fill="#445566"/);
  d = exec(d, 'style.delete', { id: 'sB' }).doc;
  assert.equal(n(d, 'b').fill, '#445566');
  assert.equal(n(d, 'b').fillStyle, undefined);
  assert.ok(!d.styles.sB);
});

test('text auto-width measures and fill-width wraps', () => {
  let d = emptyDoc();
  d = exec(d, 'node.create', { type: 'text', id: 't', props: { text: 'abcd', fontSize: 10 } }).doc;
  assert.equal(n(d, 't').w, Math.ceil(4 * 10 * 0.55));
  assert.equal(n(d, 't').h, Math.ceil(10 * 1.25));
  d = exec(d, 'text.set', { id: 't', text: 'one\ntwo' }).doc;
  assert.equal(n(d, 't').h, Math.ceil(2 * 12.5));
});

test('frame selection, ungroup and duplicate', () => {
  let d = emptyDoc();
  d = exec(d, 'node.create', { type: 'rect', x: 10, y: 10, w: 10, h: 10, id: 'a' }).doc;
  d = exec(d, 'node.create', { type: 'rect', x: 50, y: 30, w: 10, h: 10, id: 'b' }).doc;
  const { doc: d1, r } = exec(d, 'node.frameSelection', { ids: ['a', 'b'] });
  const f = n(d1, r.value);
  assert.deepEqual([f.x, f.y, f.w, f.h], [10, 10, 50, 30]);
  assert.equal(n(d1, 'b').x, 40);
  const d2 = exec(d1, 'node.ungroup', { ids: [f.id] }).doc;
  assert.equal(n(d2, 'b').x, 50);
  assert.equal(n(d2, 'b').parent, null);
  const { doc: d3, r: r3 } = exec(d2, 'edit.duplicate', { ids: ['a'] });
  assert.equal(d3.children.length, 3);
  assert.equal(n(d3, r3.value[0]).x, 20);
});

test('doc validation rejects broken files and newer formats', () => {
  assert.throws(() => validateDoc({}), /children/);
  assert.throws(() => validateDoc({ version: 99, children: [], nodes: {} }), /newer/);
  assert.throws(() => validateDoc({ children: ['x'], nodes: {} }), /Missing node/);
  const ok = validateDoc({ children: [], nodes: {} });
  assert.equal(ok.name, 'Untitled');
});

test('typed maths for number fields', () => {
  assert.equal(evalExpr('2*pi'), 2 * Math.PI);
  assert.equal(evalExpr('min(4, 3)'), 3);
  assert.equal(evalExpr('x+10', { x: 5 }), 15);
  assert.equal(evalExpr('-(2^3)/4'), -2);
  assert.throws(() => evalExpr('alert(1)'));
  assert.throws(() => evalExpr('1/0'));
});

test('palette matching: word prefixes, one typo, recent first', () => {
  assert.ok(score('ad cu', 'Add Cube') > 0);
  assert.ok(score('compnent', 'Create component') > 0);
  assert.equal(score('xyz', 'Create component'), 0);
  const items = [{ id: 'a', label: 'Zoom in' }, { id: 'b', label: 'Zoom out' }];
  assert.equal(rank('zoom', items, (i) => i.label, ['b'])[0].id, 'b');
});

test('snapping and measuring', () => {
  const r = snapBox({ x: 103, y: 0, w: 50, h: 50 }, [{ x: 0, y: 200, w: 100, h: 20 }], 5);
  assert.equal(r.dx, -3);
  assert.equal(r.guides.length, 1);
  const m = measure({ x: 0, y: 0, w: 10, h: 10 }, { x: 30, y: 0, w: 10, h: 10 });
  assert.equal(m[0].len, 20);
});

test('SVG export: frames clip, rotation becomes a matrix, text escapes', () => {
  let d = emptyDoc();
  d = exec(d, 'node.create', { type: 'frame', x: 0, y: 0, w: 100, h: 100, id: 'f' }).doc;
  d = exec(d, 'node.create', { type: 'text', parent: 'f', x: 0, y: 0, id: 't', props: { text: 'a<b & c' } }).doc;
  d = exec(d, 'node.create', { type: 'ellipse', parent: 'f', x: 10, y: 10, w: 20, h: 20, id: 'e', props: { rotation: 45 } }).doc;
  const svg = toSVG(d);
  assert.match(svg, /<clipPath/);
  assert.match(svg, /a&lt;b &amp; c/);
  assert.match(svg, /<ellipse/);
  assert.match(svg, /^<svg[^>]+width="100" height="100"/);
});

test('every command has a schema, a scope and a description for the rail', () => {
  for (const c of all()) {
    assert.ok(['read', 'write', 'destructive'].includes(c.scope), c.id);
    assert.equal(inputSchema(c).type, 'object');
  }
  const m = manifest();
  assert.ok(m.find((c) => c.id === 'edit.delete').scope === 'destructive');
});

test('the starter document resolves: two instances with an override, auto layout and styles', () => {
  const d = seedDoc();
  assert.equal(d.nodes['btnSecondary~mainButtonLabel'].text, 'Later');
  assert.equal(d.nodes['btnPrimary~mainButtonLabel'].text, 'Get started');
  assert.equal(d.nodes.btnSecondary.fill, '#F0F0F0');
  assert.ok(d.nodes.card.h > 200);
  assert.equal(d.nodes.cardImage.w, 312);
  // Round-trips through JSON.
  assert.deepEqual(validateDoc(JSON.parse(JSON.stringify(d))).children, d.children);
});

test('shortcuts with Shift and another modifier reach their command', () => {
  // Regression: "Shift+Mod+G" was registered while key events produce "Mod+Shift+G".
  for (const c of all()) for (const k of c.keys) assert.equal(normKey(k), k, `${c.id} key ${k}`);
  assert.equal(findByKey(comboOf({ [isMac ? 'metaKey' : 'ctrlKey']: true, shiftKey: true, code: 'KeyG', key: 'G' }))?.id, 'node.ungroup');
  assert.equal(findByKey(comboOf({ [isMac ? 'metaKey' : 'ctrlKey']: true, altKey: true, code: 'KeyK', key: 'k' }))?.id, 'component.create');
  assert.equal(comboOf({ shiftKey: true, code: 'Slash', key: '?' }), 'Shift+/');
});
