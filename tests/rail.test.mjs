// The NakliOS common rail (rules from naklios sys/host/catalog.mjs, relayed by the naklios session on
// 2026-11-11): at most 64 commands per app; names /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*){0,3}$/; each
// with a description, a scope of read, write or destructive, and an object input schema.
// Also live boolean groups.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

await import('../src/main.js'); // registers every command; starts no UI without a DOM
const { railEntries, railCommands, RAIL_LIMIT } = await import('../src/host.js');
const { all, get } = await import('../src/registry.js');
const { Tx, emptyDoc } = await import('../src/doc.js');
const { resolve } = await import('../src/resolve.js');
const { toSVG } = await import('../src/export.js');

const NAME = /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*){0,3}$/;

test('rail entries fit the host catalog rules and cover every agent command once', () => {
  const entries = railEntries();
  assert.ok(entries.length <= RAIL_LIMIT && RAIL_LIMIT === 64, `${entries.length} entries`);
  const seen = new Map();
  for (const e of entries) {
    assert.match(e.name, NAME);
    assert.ok(e.description.length > 0);
    assert.ok(['read', 'write', 'destructive'].includes(e.scope));
    assert.equal(e.input.type, 'object');
    for (const id of e.commands) { assert.ok(!seen.has(id), `${id} in ${seen.get(id)} and ${e.name}`); seen.set(id, e.name); assert.equal(get(id).scope, e.scope); }
  }
  const agentCommands = all().filter((c) => !c.personOnly && !c.noRail).map((c) => c.id);
  assert.deepEqual([...seen.keys()].sort(), agentCommands.sort());
  assert.ok(entries.some((e) => e.name === 'help.read'));
});

test('commands.json matches what the page registers', () => {
  const m = JSON.parse(readFileSync(new URL('../commands.json', import.meta.url), 'utf8'));
  assert.deepEqual(m.commands.map((c) => c.name).sort(), railEntries().map((e) => e.name).sort());
  assert.deepEqual(m.accepts[0].extensions, ['.figger.json']);
});

test('a rail entry runs only its own commands, and help.read describes them', async () => {
  const calls = [];
  const cmds = railCommands(async (id, params, o) => { calls.push([id, params, o.source]); return 'ran'; });
  const layout = cmds.find((c) => c.name === 'layout.write');
  assert.equal(await layout.handler({ command: 'layout.add', params: { mode: 'row' } }), 'ran');
  assert.deepEqual(calls[0], ['layout.add', { mode: 'row' }, 'agent']);
  await assert.rejects(layout.handler({ command: 'edit.delete' }), /not a layout.write command/);
  const help = cmds.find((c) => c.name === 'help.read');
  const one = await help.handler({ command: 'node.create' });
  assert.equal(one.params.properties.type.enum.includes('rect'), true);
});

test('live boolean groups keep editable children and recompute their outline', () => {
  const exec = (doc, id, p, selection = []) => { const tx = new Tx(doc); const r = get(id).doc(tx, p, { selection, state: { doc } }); resolve(tx); return { doc: tx.doc, r }; };
  let d = emptyDoc();
  d = exec(d, 'node.create', { type: 'rect', x: 0, y: 0, w: 100, h: 100, id: 'a' }).doc;
  d = exec(d, 'node.create', { type: 'rect', x: 50, y: 0, w: 100, h: 100, id: 'b' }).doc;
  const { doc: d1, r } = exec(d, 'boolean.group', { ids: ['a', 'b'], op: 'union' });
  const g = d1.nodes[r.value];
  assert.deepEqual([g.type, g.x, g.w, g.children.length], ['boolean', 0, 150, 2]);
  // Move an operand: the outline follows; the children stay layers.
  let d2 = exec(d1, 'node.set', { ids: ['b'], props: { x: 100 } }).doc;
  assert.equal(d2.nodes[r.value].w, 200);
  d2 = exec(d2, 'boolean.setOp', { ids: [r.value], op: 'intersect' }).doc;
  assert.equal(d2.nodes[r.value].d, '');
  d2 = exec(d2, 'node.set', { ids: ['b'], props: { x: 60 } }).doc;
  assert.equal(d2.nodes[r.value].w, 40);
  assert.equal(toSVG(d2).match(/<path/g).length, 1); // exported as one shape, not its operands
  const flat = exec(d2, 'node.flatten', { ids: [r.value] });
  const v = flat.doc.nodes[flat.r.select[0]];
  assert.equal(v.type, 'vector');
  assert.ok(!flat.doc.nodes.a && !flat.doc.nodes.b);
});
