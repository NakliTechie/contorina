// The one command registry. Menus, keys, the palette, the window.contorina agent face and the
// NakliOS common rail all dispatch these ids, so every action has one implementation.
//
// A command is { id, label, group, params, keys, scope, personOnly, hidden, doc | run }.
//   doc(tx, params, env)  edits the document through a Tx; the runner resolves, commits and records undo.
//                         Return false for a no-op, or { select, value }.
//   run(params, env)      everything else (view, selection, files); may return a value.
// scope is read | write | destructive (common rail terms). personOnly marks acts an agent may not run
// (file pickers, which need a person's gesture); the agent face refuses them explicitly.

const cmds = new Map();

export function register(...defs) {
  for (const d of defs) {
    if (!d.id || !d.label) throw new Error('Command needs id and label');
    if (cmds.has(d.id)) throw new Error(`Duplicate command ${d.id}`);
    const c = { group: 'Edit', params: {}, keys: [], scope: d.doc ? 'write' : 'read', ...d };
    c.keys = c.keys.map(normKey);
    cmds.set(d.id, c);
  }
}

// One spelling per shortcut: modifiers in the order comboOf produces them (Mod, Ctrl, Alt, Shift).
const ORDER = ['Mod', 'Ctrl', 'Alt', 'Shift'];
export function normKey(k) {
  const parts = k.split('+');
  const key = parts.pop() || '+';
  const mods = ORDER.filter((m) => parts.includes(m));
  return [...mods, key].join('+');
}
export const get = (id) => cmds.get(id);
export const all = () => [...cmds.values()];

export function manifest() {
  return all().map((c) => ({
    id: c.id, label: c.label, group: c.group, description: c.description || c.label,
    params: c.params, keys: c.keys, scope: c.scope, undoable: !!c.doc, personOnly: !!c.personOnly,
  }));
}

// JSON Schema for a command's params (the common rail's `input`).
export function inputSchema(c) {
  const properties = {}, required = [];
  for (const [k, p] of Object.entries(c.params || {})) {
    properties[k] = { type: p.type === 'any' ? undefined : p.type, description: p.desc, ...(p.enum ? { enum: p.enum } : {}) };
    if (p.required) required.push(k);
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

export function checkParams(c, params) {
  for (const [k, p] of Object.entries(c.params || {})) {
    const v = params[k];
    if (v === undefined) { if (p.required) throw new Error(`${c.id}: missing ${k}`); continue; }
    const t = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
    if (p.type && p.type !== 'any' && t !== p.type && !(t === 'null' && p.nullable)) throw new Error(`${c.id}: ${k} must be ${p.type}`);
    if (p.enum && !p.enum.includes(v)) throw new Error(`${c.id}: ${k} must be one of ${p.enum.join(', ')}`);
  }
}

let runner = null;
export function setRunner(fn) { runner = fn; }
export function run(id, params = {}, opts = {}) {
  const c = cmds.get(id);
  if (!c) throw new Error(`Unknown command ${id}`);
  return runner(c, params || {}, opts);
}

// Key strings: "Mod+Shift+K"; Mod is Cmd on macOS and Ctrl elsewhere.
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export function comboOf(e) {
  const parts = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('Mod');
  if (isMac && e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let k = e.code && e.code.startsWith('Key') ? e.code.slice(3) : e.code && e.code.startsWith('Digit') ? e.code.slice(5) : e.key;
  if (e.code === 'Slash') k = '/';
  if (e.code === 'BracketLeft') k = '[';
  if (e.code === 'BracketRight') k = ']';
  if (k === ' ') k = 'Space';
  if (k === 'Equal' || k === '+' || k === '=') k = '=';
  if (k === 'Minus' || k === '-' || k === '_') k = '-';
  if (k === 'Slash' || k === '/') k = '/';
  if (k.length === 1) k = k.toUpperCase();
  parts.push(k);
  return parts.join('+');
}
export function findByKey(combo) {
  for (const c of cmds.values()) if (c.keys.includes(combo)) return c;
  return null;
}
export function keyLabel(k) {
  if (!k) return '';
  return k.replace('Mod', isMac ? '⌘' : 'Ctrl').replace('Shift', isMac ? '⇧' : 'Shift').replace('Alt', isMac ? '⌥' : 'Alt').replace(/\+/g, isMac ? '' : '+');
}
