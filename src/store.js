// App state and undo history. Undo snapshots are whole documents; the Tx copy-on-write keeps them cheap.
import { emptyDoc } from './doc.js';

export const state = {
  doc: emptyDoc(),
  selection: [],
  tool: 'select',
  view: { x: 0, y: 0, zoom: 1 },
  hover: null,
  guides: [],
  measure: null,
  marquee: null,
  editing: null,
  dirty: false,
  savedName: null,
  space: false,
};

const past = [];
const future = [];
const LIMIT = 200;
const listeners = new Set();
let pending = new Set();
let scheduled = false;

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function notify(...what) {
  for (const w of what) pending.add(w);
  if (scheduled) return;
  scheduled = true;
  const flush = () => {
    scheduled = false;
    const p = pending;
    pending = new Set();
    for (const fn of listeners) fn(p);
  };
  if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(flush);
  else queueMicrotask(flush);
}

function cleanSelection(doc, sel) { return sel.filter((id) => doc.nodes[id]); }

export function commit(doc, selection, label) {
  past.push({ doc: state.doc, selection: state.selection, label });
  if (past.length > LIMIT) past.shift();
  future.length = 0;
  state.doc = doc;
  state.selection = cleanSelection(doc, selection || state.selection);
  state.dirty = true;
  notify('doc', 'selection');
}
export function replaceDoc(doc) {
  past.length = 0;
  future.length = 0;
  state.doc = doc;
  state.selection = [];
  state.dirty = false;
  notify('doc', 'selection', 'file');
}
export function preview(doc, selection) {
  state.doc = doc;
  if (selection) state.selection = cleanSelection(doc, selection);
  notify('doc', 'preview');
}
export function setSelection(ids) {
  const next = cleanSelection(state.doc, [...new Set(ids)]);
  if (next.length === state.selection.length && next.every((id, i) => id === state.selection[i])) return;
  state.selection = next;
  notify('selection');
}
export function undo() {
  const e = past.pop();
  if (!e) return false;
  future.push({ doc: state.doc, selection: state.selection, label: e.label });
  state.doc = e.doc;
  state.selection = cleanSelection(e.doc, e.selection);
  state.dirty = true;
  notify('doc', 'selection');
  return e.label;
}
export function redo() {
  const e = future.pop();
  if (!e) return false;
  past.push({ doc: state.doc, selection: state.selection, label: e.label });
  state.doc = e.doc;
  state.selection = cleanSelection(e.doc, e.selection);
  state.dirty = true;
  notify('doc', 'selection');
  return e.label;
}
export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;
