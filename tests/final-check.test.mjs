// Regressions from the third independent check (2026-11-11, commits 2bfb89b..2f22c8c).
import test from 'node:test';
import assert from 'node:assert/strict';

await import('../src/main.js'); // every command; no UI without a DOM
const { get, run } = await import('../src/registry.js');
const { Tx, emptyDoc, validateDoc } = await import('../src/doc.js');
const { resolve } = await import('../src/resolve.js');
const { toSVG, toRaster } = await import('../src/export.js');
const { railEntries } = await import('../src/host.js');
const { worldBox } = await import('../src/geom.js');

function exec(doc, id, params = {}, selection = []) {
  const tx = new Tx(doc);
  const r = get(id).doc(tx, params, { selection, state: { doc } });
  if (r === false) return { doc, r };
  resolve(tx);
  return { doc: tx.doc, r };
}
const count = (d) => Object.keys(d.nodes).length;

test('an instance can never expand inside its own main', { timeout: 3000 }, () => {
  let d = exec(emptyDoc(), 'node.create', { type: 'frame', w: 100, h: 100, id: 'M' }).doc;
  d = exec(d, 'node.create', { type: 'rect', parent: 'M', w: 10, h: 10, id: 'k' }).doc;
  d = exec(d, 'component.create', {}, ['M']).doc;
  assert.throws(() => exec(d, 'component.instance', { mainId: 'M', parent: 'M' }), /inside its own main/);
  // A hostile file that already nests instances of M inside M loads, resolves fast and stays small.
  const raw = JSON.parse(JSON.stringify(d));
  for (let i = 0; i < 4; i++) { raw.nodes['i' + i] = { id: 'i' + i, type: 'instance', mainId: 'M', parent: 'M', x: 0, y: 0, w: 10, h: 10, children: [], overrides: {} }; raw.nodes.M.children.push('i' + i); }
  const t0 = Date.now();
  const loaded = validateDoc(raw);
  const tx = new Tx(loaded);
  resolve(tx);
  assert.ok(Date.now() - t0 < 1000);
  assert.ok(count(tx.doc) < 50, `${count(tx.doc)} nodes`);
});

test('a swap property cannot point an instance at a component that contains it', () => {
  let d = exec(emptyDoc(), 'node.create', { type: 'frame', w: 100, h: 100, id: 'icon' }).doc;
  d = exec(d, 'component.create', {}, ['icon']).doc;
  d = exec(d, 'node.create', { type: 'frame', w: 100, h: 100, x: 200, id: 'M' }).doc;
  d = exec(d, 'component.instance', { mainId: 'icon', parent: 'M', id: 'slot' }).doc;
  d = exec(d, 'component.create', {}, ['M']).doc;
  assert.throws(() => exec(d, 'component.addProp', { id: 'M', name: 'Icon', type: 'swap', target: 'slot', default: 'M' }), /itself/);
  d = exec(d, 'component.addProp', { id: 'M', name: 'Icon', type: 'swap', target: 'slot' }).doc;
  d = exec(d, 'component.instance', { mainId: 'M', id: 'i', x: 400 }).doc;
  assert.throws(() => exec(d, 'instance.setProp', { id: 'i', name: 'Icon', value: 'M' }), /itself/);
});

test('text run values are checked, so they cannot inject CSS into exported SVG', () => {
  let d = exec(emptyDoc(), 'node.create', { type: 'text', id: 't', props: { text: 'Hello' } }).doc;
  assert.throws(() => exec(d, 'text.styleRange', { id: 't', start: 0, end: 5, style: { fontWeight: '700 9px x;background:url(https://attacker.example/p)' } }), /fontWeight/);
  const raw = JSON.parse(JSON.stringify(d));
  raw.nodes.t.runs = [{ start: 0, end: 5, style: { fontWeight: '700 9px x;background:url(https://attacker.example/p)', fill: 'red;x:1' } }, null];
  assert.doesNotMatch(toSVG(validateDoc(raw)), /attacker|background/);
  assert.throws(() => exec(d, 'node.set', { ids: ['t'], props: { fontFamily: 'x;}<script>' } }), /fontFamily/);
});

test('bad effect and paint values are cleaned on write and on load', async () => {
  let d = exec(emptyDoc(), 'node.create', { type: 'rect', id: 'r' }).doc;
  const { doc: d1, r } = exec(d, 'style.create', { type: 'effect', name: 'Bad', effects: [null, { type: 'noise', size: 'abc' }, { type: 'drop', x: 'q' }] });
  assert.deepEqual(d1.styles[r.value].effects.map((e) => e.type), ['noise', 'drop']);
  d = exec(d1, 'node.applyStyle', { ids: ['r'], kind: 'effect', styleId: r.value }).doc;
  assert.doesNotThrow(() => toSVG(d));
  d = exec(d, 'node.set', { ids: ['r'], props: { fill: [{ type: 'linear', angle: 'x', stops: 'no' }, null, 'notacolour'] } }).doc;
  assert.equal(d.nodes.r.fill[0].angle, 90);
  assert.equal(d.nodes.r.fill.length, 1);
  const raw = JSON.parse(JSON.stringify(d));
  raw.styles.junk = { type: 'effect', name: 'x', effects: {} };
  raw.nodes.r.effects = 'oops';
  const v = validateDoc(raw);
  assert.deepEqual(v.styles.junk.effects, []);
  assert.deepEqual(v.nodes.r.effects, []);
});

test('live booleans: operands from another frame keep their place; nested booleans update in the same edit; unrelated edits skip them', () => {
  let d = emptyDoc();
  d = exec(d, 'node.create', { type: 'frame', x: 1000, y: 1000, w: 200, h: 200, id: 'F' }).doc;
  d = exec(d, 'node.create', { type: 'rect', parent: 'F', x: 10, y: 10, w: 20, h: 20, id: 'inF' }).doc;
  d = exec(d, 'node.create', { type: 'rect', x: 50, y: 50, w: 20, h: 20, id: 'top' }).doc;
  const before = worldBox(d, 'top');
  const g = exec(d, 'boolean.group', { ids: ['inF', 'top'], op: 'union' });
  const after = worldBox(g.doc, 'top');
  assert.deepEqual([after.x, after.y], [before.x, before.y]);

  let e = emptyDoc();
  e = exec(e, 'node.create', { type: 'rect', x: 0, y: 0, w: 10, h: 10, id: 'a' }).doc;
  e = exec(e, 'node.create', { type: 'rect', x: 5, y: 0, w: 10, h: 15, id: 'b' }).doc;
  e = exec(e, 'node.create', { type: 'rect', x: 100, y: 0, w: 10, h: 10, id: 'c' }).doc;
  const inner = exec(e, 'boolean.group', { ids: ['a', 'b'], op: 'union' });
  const outer = exec(inner.doc, 'boolean.group', { ids: [inner.r.value, 'c'], op: 'union' });
  let f = exec(outer.doc, 'node.set', { ids: ['b'], props: { h: 50 } }).doc;
  assert.equal(f.nodes[outer.r.value].h, 50);
  f = exec(f, 'node.create', { type: 'rect', x: 500, y: 500, id: 'unrelated' }).doc;
  const f2 = exec(f, 'node.set', { ids: ['unrelated'], props: { x: 600 } }).doc;
  assert.equal(f2.nodes[outer.r.value], f.nodes[outer.r.value]); // the same object: not recomputed
});

test('documents with broken structure are refused clearly; node.set cannot change structure', () => {
  const two = { children: ['a', 'b'], nodes: { a: { id: 'a', type: 'frame', x: 0, y: 0, w: 1, h: 1, children: ['c'] }, b: { id: 'b', type: 'frame', x: 0, y: 0, w: 1, h: 1, children: ['c'] }, c: { id: 'c', type: 'rect', x: 0, y: 0, w: 1, h: 1 } } };
  assert.throws(() => validateDoc(two), /two parents/);
  const loop = { children: ['a'], nodes: { a: { id: 'a', type: 'frame', x: 0, y: 0, w: 1, h: 1, children: ['b'] }, b: { id: 'b', type: 'frame', x: 0, y: 0, w: 1, h: 1, children: ['a'] } } };
  assert.throws(() => validateDoc(loop), /two parents|inside itself/);
  const rectKids = validateDoc({ children: ['r'], nodes: { r: { id: 'r', type: 'rect', x: 0, y: 0, w: 1, h: 1, children: ['z'] }, z: { id: 'z', type: 'rect', x: 0, y: 0, w: 1, h: 1 } } });
  assert.equal(rectKids.nodes.r.children, undefined);
  const d = exec(emptyDoc(), 'node.create', { type: 'rect', id: 'r' }).doc;
  assert.throws(() => exec(d, 'node.set', { ids: ['r'], props: { type: 'frame', parent: 'x' } }), /cannot change/);
});

test('the rail offers no undo or redo, and agent exports never download', async () => {
  const names = railEntries().flatMap((e) => e.commands);
  assert.ok(!names.includes('edit.undo') && !names.includes('edit.redo'));
  // In Node there is no document: a download attempt would throw. An agent call returns the SVG instead.
  const svg = await run('export.svg', { download: true }, { source: 'agent' });
  assert.match(String(svg), /^<svg/);
});
