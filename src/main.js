// Figger boot: the command runner, app-level commands, keys, toolbar, storage and the two agent doors
// (window.figger in the page, the NakliOS common rail when hosted). Both doors call the same registry.
import './commands.js';
import './commands-vector.js';
import './commands-layer4.js';
import './commands-layer5.js';
import { startPresentation } from './present.js';
import { toPDF } from './pdf.js';
import { toRaster } from './export.js';
import { createVectorTools } from './pen.js';
import { setImageReadyHandler } from './paint.js';
import { register, run, setRunner, manifest, comboOf, findByKey, checkParams, get, all, keyLabel, isMac } from './registry.js';
import { state, commit, preview, setSelection, undo, redo, replaceDoc, notify, subscribe, canUndo, canRedo, nextFrame } from './store.js';
import { Tx, validateDoc, topmost, emptyDoc, descendants, hasLayout } from './doc.js';
import { resolve } from './resolve.js';
import { worldBox, unionBoxes, worldMatrix, apply, round2 } from './geom.js';
import { createCanvas } from './canvas.js';
import { createLayers } from './ui/layers.js';
import { createProps } from './ui/props.js';
import { openPalette } from './ui/palette.js';
import { fieldKey } from './ui/numfield.js';
import { dialog, confirmDialog, toast } from './ui/dialog.js';
import { h, clear } from './ui/dom.js';
import { toSVG, toPNG } from './export.js';
import { pickStore, download, safeName, EXT } from './storage.js';
import { connectHost, applyHostTheme, hosted } from './host.js';
import { seedDoc } from './seed.js';

const VERSION = '0.1.0';
const app = { lastFrameMs: 0, pointerWorld: null };
let store = null, saver = null;
const env = () => ({ selection: state.selection.slice(), state });
const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

// ---- runner ---------------------------------------------------------------------------------------
function report(e) { if (e && e.name !== 'AbortError') toast(e.message || String(e), 'error'); }
setRunner((c, params, opts = {}) => {
  const agent = opts.source === 'agent';
  if (c.personOnly && agent) throw new Error(`${c.id} needs a person (it opens a file picker); agents use doc.get and doc.load`);
  if (agent) checkParams(c, params);
  if (c.when && !c.when()) return undefined;
  if (c.doc) {
    const tx = new Tx(state.doc);
    let r;
    try {
      r = c.doc(tx, params, env());
      if (r === false) return undefined;
      resolve(tx);
    } catch (e) {
      if (agent) throw e;
      report(e);
      return undefined;
    }
    commit(tx.doc, r && r.select, c.label);
    saver && saver.markDirty();
    return r ? r.value : undefined;
  }
  try {
    const v = c.run(params, env(), opts);
    if (v && typeof v.then === 'function' && !agent) return v.catch((e) => { report(e); });
    return v;
  } catch (e) {
    if (agent) throw e;
    report(e);
    return undefined;
  }
});

// A gesture previews a command on a fixed base document and commits it once (one undo step).
app.gesture = () => {
  const base = state.doc, baseSel = state.selection.slice();
  let touched = false;
  return {
    preview(id, params) {
      const c = get(id);
      const tx = new Tx(base);
      try {
        const r = c.doc(tx, params, { selection: baseSel, state });
        if (r === false) { if (touched) preview(base, baseSel); return; }
        resolve(tx);
        preview(tx.doc, r && r.select);
        touched = true;
      } catch { /* an invalid intermediate state is skipped; the commit reports errors */ }
    },
    commit(id, params) {
      state.doc = base;
      state.selection = baseSel;
      run(id, params);
    },
    cancel() { if (touched) preview(base, baseSel); },
  };
};
app.run = (id, params, opts) => run(id, params, opts);
app.isMod = (e) => (isMac ? e.metaKey : e.ctrlKey);
app.redraw = () => notify('overlay');
app.confirm = confirmDialog;
app.storageLabel = () => (store ? store.label() : '…');
app.liveNode = (id) => state.doc.nodes[id];

// ---- app commands -----------------------------------------------------------------------------------
let clip = null;
const selOrAll = (p) => (p.ids && p.ids.length ? p.ids : state.selection.length ? state.selection : state.doc.children);

function copyTree(ids) {
  const doc = state.doc;
  const roots = topmost(doc, ids).filter((id) => doc.nodes[id] && !doc.nodes[id].src);
  if (!roots.length) return null;
  const nodes = {}, styles = {};
  const take = (id) => {
    const n = doc.nodes[id];
    nodes[id] = { ...n };
    for (const k of ['fillStyle', 'strokeStyle', 'textStyle']) if (n[k] && doc.styles[n[k]]) styles[n[k]] = doc.styles[n[k]];
    if (n.children && n.type !== 'instance') n.children.forEach(take);
    if (n.type === 'instance') nodes[id].children = [];
  };
  roots.forEach(take);
  for (const r of roots) {
    const n = doc.nodes[r];
    const o = n.parent ? apply(worldMatrix(doc, n.parent), { x: n.x, y: n.y }) : { x: n.x, y: n.y };
    nodes[r] = { ...nodes[r], parent: null, x: round2(o.x), y: round2(o.y) };
  }
  return { rootIds: roots, nodes, styles };
}

register(
  { id: 'edit.undo', label: 'Undo', group: 'Edit', keys: ['Mod+Z'], scope: 'write', run: () => { const l = undo(); if (l) toast(`Undo ${l}`); saver?.markDirty(); return !!l; } },
  { id: 'edit.redo', label: 'Redo', group: 'Edit', keys: ['Shift+Mod+Z', 'Mod+Y'], scope: 'write', run: () => { const l = redo(); if (l) toast(`Redo ${l}`); saver?.markDirty(); return !!l; } },
  { id: 'select.set', label: 'Select layers', group: 'Select', hidden: true, params: { ids: { type: 'array', required: true } }, run: (p) => { setSelection(p.ids); return state.selection.slice(); } },
  { id: 'select.all', label: 'Select all', group: 'Select', keys: ['Mod+A'], run: () => {
    const s = state.selection[0] && state.doc.nodes[state.selection[0]];
    setSelection(s && s.parent ? state.doc.nodes[s.parent].children : state.doc.children);
  } },
  { id: 'select.none', label: 'Select none', group: 'Select', run: () => setSelection([]) },
  { id: 'select.parent', label: 'Select parent', group: 'Select', keys: ['Shift+Enter', 'Escape'], run: () => {
    const s = state.selection.map((id) => state.doc.nodes[id]).filter(Boolean);
    const parents = [...new Set(s.map((n) => n.parent).filter(Boolean))];
    setSelection(parents);
  } },
  { id: 'select.children', label: 'Select children', group: 'Select', keys: ['Enter'], run: () => {
    const s = state.selection.map((id) => state.doc.nodes[id]).filter(Boolean);
    if (s.length === 1 && s[0].type === 'text') { app.startTextEdit(s[0].id); return; }
    const kids = s.flatMap((n) => n.children || []);
    if (kids.length) setSelection(kids);
  } },
  { id: 'edit.copy', label: 'Copy', group: 'Edit', keys: ['Mod+C'], noRail: true, run: () => {
    clip = copyTree(state.selection);
    if (clip) { clip.pasted = 0; try { navigator.clipboard?.writeText(JSON.stringify({ figger: 1, ...clip })); } catch {} }
  } },
  { id: 'edit.cut', label: 'Cut', group: 'Edit', keys: ['Mod+X'], noRail: true, run: () => { run('edit.copy'); run('edit.delete'); } },
  { id: 'edit.paste', label: 'Paste', group: 'Edit', keys: ['Mod+V'], noRail: true, run: async () => {
    let tree = clip;
    if (!tree) {
      let text = '';
      try { text = await navigator.clipboard.readText(); } catch {}
      try { const t = JSON.parse(text); if (t && t.figger) tree = t; } catch {}
      if (!tree && text && (await importText(text, 'Pasted SVG'))) return;
    }
    if (!tree) return;
    const target = state.selection.length === 1 && state.doc.nodes[state.selection[0]]?.type === 'frame' && !state.doc.nodes[state.selection[0]].src ? state.selection[0] : null;
    tree.pasted = (tree.pasted || 0) + 1;
    let dx = 0, dy = 0;
    // Copied roots carry canvas coordinates; into a frame they keep their place on screen (unrotated frames).
    if (target) { const pm = worldMatrix(state.doc, target); dx = -pm[4]; dy = -pm[5]; }
    else { dx = 10 * tree.pasted; dy = 10 * tree.pasted; }
    run('node.insertTree', { tree, parent: target, dx, dy });
  } },
  { id: 'view.zoomIn', label: 'Zoom in', group: 'View', keys: ['Mod+='], run: () => app.canvas.zoomAt(app.canvas.center(), state.view.zoom * 1.25) },
  { id: 'view.zoomOut', label: 'Zoom out', group: 'View', keys: ['Mod+-'], run: () => app.canvas.zoomAt(app.canvas.center(), state.view.zoom / 1.25) },
  { id: 'view.zoom100', label: 'Zoom to 100%', group: 'View', keys: ['Shift+0'], run: () => app.canvas.zoomAt(app.canvas.center(), 1) },
  { id: 'view.fit', label: 'Zoom to fit', group: 'View', keys: ['Shift+1'], run: () => app.canvas.fitBox(unionBoxes(state.doc.children.filter((id) => state.doc.nodes[id].visible !== false).map((id) => worldBox(state.doc, id))), 1) },
  { id: 'view.fitSelection', label: 'Zoom to selection', group: 'View', keys: ['Shift+2'], run: () => { if (state.selection.length) app.canvas.fitBox(unionBoxes(state.selection.map((id) => worldBox(state.doc, id))), 8); } },
  ...[['select', 'Move and select', 'V'], ['frame', 'Frame', 'F'], ['rect', 'Rectangle', 'R'], ['ellipse', 'Ellipse', 'O'], ['line', 'Line', 'L'],
    ['polygon', 'Polygon', 'Shift+P'], ['star', 'Star', 'Shift+S'], ['pen', 'Pen', 'P'], ['pencil', 'Pencil', 'Shift+L'], ['text', 'Text', 'T'], ['hand', 'Hand (pan)', 'H']].map(([t, label, k]) => ({
    id: 'tool.' + t, label: `Tool: ${label}`, group: 'Tools', keys: [k], noRail: true, run: () => { app.vectorTools?.exit(); state.tool = t; notify('tool'); },
  })),
  { id: 'file.placeImage', label: 'Place image…', group: 'Insert', keys: ['Shift+Mod+K'], personOnly: true, run: () => pickImage() },
  { id: 'vector.editPath', label: 'Edit path', group: 'Edit', noRail: true, run: () => { const id = state.selection[0]; if (id) app.vectorTools.editPath(id); } },
  { id: 'palette.open', label: 'Search commands', group: 'Help', keys: ['Mod+K', 'Mod+/'], noRail: true, run: () => openPalette(app) },
  { id: 'help.shortcuts', label: 'Keyboard shortcuts', group: 'Help', keys: ['Shift+/'], noRail: true, run: () => showShortcuts() },
  { id: 'component.goToMain', label: 'Go to main component', group: 'Components', run: () => {
    const n = state.doc.nodes[state.selection[0]];
    if (!n || n.type !== 'instance' || !state.doc.nodes[n.mainId]) return;
    setSelection([n.mainId]);
    run('view.fitSelection');
  } },
  { id: 'doc.get', label: 'Get document', group: 'File', hidden: true, description: 'Return the whole document as JSON plus the current selection.', run: () => ({ doc: structuredClone(state.doc), selection: state.selection.slice() }) },
  {
    id: 'doc.load', label: 'Replace document', group: 'File', hidden: true, scope: 'destructive',
    description: 'Replace the open document with a Figger document object (undoable).',
    params: { doc: { type: 'object', required: true } },
    doc(tx, p) {
      const d = validateDoc(structuredClone(p.doc));
      tx.doc.name = d.name; tx.doc.children = d.children.slice(); tx.doc.nodes = { ...d.nodes }; tx.doc.styles = { ...d.styles }; tx.doc.assets = { ...d.assets };
      for (const k of ['pages', 'page', 'variables']) { if (d[k] === undefined) delete tx.doc[k]; else tx.doc[k] = structuredClone(d[k]); }
      tx.own = new Set();
      return { select: [] };
    },
  },
  {
    id: 'export.svg', label: 'Export SVG', group: 'Export', keys: ['Shift+Mod+E'],
    description: 'Export the given layers (default: selection, else everything) as an SVG string; download saves a file.',
    params: { ids: { type: 'array' }, download: { type: 'boolean' } },
    run: (p, e, o) => {
      const svg = toSVG(state.doc, selOrAll(p));
      if (p.download || (o && o.source !== 'agent' && p.download !== false)) download(new Blob([svg], { type: 'image/svg+xml' }), safeName(state.doc.name).replace(EXT, '.svg'));
      return svg;
    },
  },
  {
    id: 'export.png', label: 'Export PNG (2x)', group: 'Export', keys: ['Shift+Mod+P'],
    description: 'Export the given layers (default: selection, else everything) as a PNG; returns a data URL; download saves a file.',
    params: { ids: { type: 'array' }, scale: { type: 'number' }, download: { type: 'boolean' } },
    run: async (p, e, o) => {
      const blob = await toPNG(state.doc, selOrAll(p), p.scale || 2);
      if (p.download || (o && o.source !== 'agent' && p.download !== false)) { download(blob, safeName(state.doc.name).replace(EXT, '.png')); return { bytes: blob.size }; }
      return await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
    },
  },
  ...[['jpg', 'image/jpeg', 'JPG'], ['webp', 'image/webp', 'WebP']].map(([ext, type, label]) => ({
    id: 'export.' + ext, label: `Export ${label} (2x)`, group: 'Export',
    description: `Export the given layers (default: selection, else everything) as ${label}; returns a data URL; download saves a file.`,
    params: { ids: { type: 'array' }, scale: { type: 'number' }, quality: { type: 'number' }, download: { type: 'boolean' } },
    run: async (p, e, o) => {
      const blob = await toRaster(state.doc, selOrAll(p), { scale: p.scale || 2, type, quality: p.quality ?? 0.9 });
      if (p.download || (o && o.source !== 'agent' && p.download !== false)) { download(blob, safeName(state.doc.name).replace(EXT, '.' + ext)); return { bytes: blob.size }; }
      return await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
    },
  })),
  {
    id: 'export.pdf', label: 'Export PDF', group: 'Export', keys: ['Shift+Mod+F'],
    description: 'Export the given layers (default: selection, else every top-level layer), one page each, as a vector PDF; returns base64 for agents; download saves a file.',
    params: { ids: { type: 'array' }, download: { type: 'boolean' } },
    run: async (p, e, o) => {
      const ids = selOrAll(p);
      const images = await jpegAssets(state.doc, ids);
      const bytes = toPDF(state.doc, ids, { images });
      if (p.download || (o && o.source !== 'agent' && p.download !== false)) { download(new Blob([bytes], { type: 'application/pdf' }), safeName(state.doc.name).replace(EXT, '.pdf')); return { bytes: bytes.length }; }
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    },
  },
  {
    id: 'code.show', label: 'Show code (HTML, React, CSS)', group: 'Export', keys: ['Alt+Mod+C'], noRail: true,
    run: () => showCode(),
  },
  { id: 'view.inspect', label: 'Toggle inspect mode', group: 'View', keys: ['Shift+D'], noRail: true, run: () => { state.inspect = !state.inspect; notify('selection', 'inspect'); } },
  {
    id: 'present.start', label: 'Present prototype', group: 'Prototype', keys: ['Alt+Mod+Enter'], noRail: true,
    run: () => {
      const sel = state.selection.map((id) => state.doc.nodes[id]).find((n) => n && !n.parent && n.type === 'frame');
      app.presentation = startPresentation(state.doc, sel && sel.id, { onExit: () => { app.presentation = null; app.focusCanvas(); } });
    },
  },
  { id: 'file.import', label: 'Import SVG or Figma JSON…', group: 'File', keys: ['Shift+Mod+I'], personOnly: true, run: () => pickImport() },
  { id: 'file.new', label: 'New document', group: 'File', scope: 'destructive', personOnly: true, run: async () => {
    if (!(await confirmDialog('Start a new document?', 'The open document is replaced. Undo brings it back while this tab stays open.', 'New document'))) return;
    run('doc.load', { doc: emptyDoc() });
    store.forget?.();
    state.savedName = null;
  } },
  { id: 'file.open', label: 'Open…', group: 'File', keys: ['Mod+O'], personOnly: true, run: () => openFile() },
  { id: 'file.save', label: 'Save', group: 'File', keys: ['Mod+S'], personOnly: true, run: () => saveFile(false) },
  { id: 'file.saveAs', label: 'Save as…', group: 'File', keys: ['Shift+Mod+S'], personOnly: true, run: () => saveFile(true) },
);

async function loadText(text, name) {
  const d = validateDoc(JSON.parse(text));
  run('doc.load', { doc: d });
  state.savedName = name || null;
  run('view.fit');
  toast(`Opened ${name || d.name}`);
}
async function openFile() {
  if (store.pickers) { const f = await store.openPicked(); await loadText(f.text, f.name); return; }
  const files = await store.list();
  if (!files.length) { toast('No saved documents in this storage yet'); return; }
  const pick = await dialog({ title: 'Open a document', body: `From ${store.label()}`, buttons: [...files.map((f) => ({ label: f.replace(EXT, ''), value: f })), { label: 'Cancel', value: null, cancel: true }] });
  if (pick) await loadText(await store.read(pick), pick);
}
async function saveFile(as) {
  const text = JSON.stringify(state.doc);
  let name;
  if (store.pickers) name = await store.savePicked(state.doc.name, text, { as });
  else {
    name = safeName(state.doc.name);
    // Another document already has this name: ask before replacing it.
    if (name !== state.savedName && (await store.list()).includes(name)
      && !(await confirmDialog(`Replace “${name}”?`, `A document with this name is already saved in ${store.label()}.`, 'Replace', true))) return;
    await store.write(name, text);
  }
  state.savedName = name;
  state.dirty = false;
  notify('file');
  toast(`Saved ${name}`);
}

// JPEG bytes of every image asset the export uses, for the PDF writer.
async function jpegAssets(doc, ids) {
  const used = new Set();
  const walk = (id) => { const n = doc.nodes[id]; if (!n) return; for (const p of [].concat(n.fill || [])) if (p && p.type === 'image') used.add(p.asset); (n.children || []).forEach(walk); };
  ids.forEach(walk);
  const out = {};
  for (const aid of used) {
    const a = doc.assets[aid];
    if (!a) continue;
    try {
      const bm = await createImageBitmap(await (await fetch(`data:${a.mime};base64,${a.data}`)).blob());
      const c = new OffscreenCanvas(bm.width, bm.height);
      const x = c.getContext('2d');
      x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, bm.width, bm.height); x.drawImage(bm, 0, 0);
      out[aid] = { jpeg: new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer()), w: bm.width, h: bm.height };
      bm.close();
    } catch { /* an undecodable image prints as grey */ }
  }
  return out;
}

async function importText(text, name, at) {
  const c = at || app.viewCenter();
  if (/^\s*(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(text)) {
    const id = run('import.svg', { svg: text, x: Math.round(c.x), y: Math.round(c.y), name: (name || 'SVG').replace(/\.svg$/i, '') });
    if (id) toast(`Imported ${name || 'SVG'}`);
    return true;
  }
  let json = null;
  try { json = JSON.parse(text); } catch { return false; }
  if (json && (json.document || json.nodes) && !json.children) {
    const n = run('import.figma', { json });
    if (n) toast(`Imported ${n} page${n === 1 ? '' : 's'} from Figma JSON`);
    return true;
  }
  return false;
}
function pickImport() {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: '.svg,image/svg+xml,.json,application/json' });
    input.onchange = async () => {
      const f = input.files[0];
      if (f && !(await importText(await f.text(), f.name))) toast(`${f.name} is not SVG or Figma JSON`, 'error');
      resolve();
    };
    input.click();
  });
}

function showCode() {
  const ids = state.selection.length ? state.selection.slice() : state.doc.children.slice();
  let format = 'html';
  const pre = h('pre.code');
  const set = (f) => { format = f; pre.textContent = run('export.code', { ids, format: f }); tabs.forEach((t) => t.classList.toggle('on', t.dataset.f === f)); };
  const tabs = [['html', 'HTML + CSS'], ['react', 'React'], ['css', 'CSS (first layer)']].map(([f, l]) => { const b = h('button', { type: 'button', on: { click: () => set(f) } }, l); b.dataset.f = f; return b; });
  const close = () => { d.close(); d.remove(); };
  const d = h('dialog.dlg.wide', h('h2', 'Code'), h('div.seg', tabs), pre,
    h('div.dlg-buttons',
      h('button', { type: 'button', on: { click: async () => { try { await navigator.clipboard.writeText(pre.textContent); toast('Copied'); } catch { toast('Copy failed; select the text instead', 'error'); } } } }, 'Copy'),
      h('button', { type: 'button', on: { click: () => download(new Blob([pre.textContent], { type: 'text/plain' }), safeName(state.doc.name).replace(EXT, format === 'react' ? '.jsx' : format === 'css' ? '.css' : '.html')) } }, 'Download'),
      h('button.primary', { type: 'button', on: { click: close } }, 'Close')));
  d.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.appendChild(d);
  d.showModal();
  set('html');
}

async function readImage(file) {
  if (!/^image\//.test(file.type)) throw new Error(`${file.name} is not an image`);
  const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
  const dims = await createImageBitmap(file).then((b) => { const d = { w: b.width, h: b.height }; b.close(); return d; }).catch(() => ({ w: 200, h: 200 }));
  return { mime: file.type, data, name: file.name.replace(/\.[^.]+$/, ''), ...dims };
}
async function placeImageFile(file, at) {
  const img = await readImage(file);
  const asset = run('asset.add', img);
  const c = at || app.viewCenter();
  const w = Math.min(img.w, 1200), h = (img.h * w) / img.w;
  run('image.place', { asset, x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w, h });
}
function pickImage() {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml' });
    input.onchange = async () => { if (input.files[0]) await placeImageFile(input.files[0]).catch(report); resolve(); };
    input.click();
  });
}
app.placeImageFile = placeImageFile;
app.readImage = readImage;

function showShortcuts() {
  const rows = all().filter((c) => c.keys.length && !c.hidden).map((c) => h('tr', h('td', c.label), h('td', c.keys.map((k) => h('kbd', keyLabel(k))))));
  const d = h('dialog.dlg.wide', h('h2', 'Keyboard shortcuts'), h('div.shortcuts', h('table', rows)),
    h('p.ps-note', 'Canvas: Space-drag or middle-drag pans; Ctrl/⌘+wheel or pinch zooms; Shift constrains; Alt draws from the centre; Alt-hover measures; ⌘/Ctrl-click selects deep; arrows nudge (Shift ×10).'),
    h('div.dlg-buttons', h('button.primary', { type: 'button', on: { click: () => { d.close(); d.remove(); } } }, 'Close')));
  d.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.appendChild(d);
  d.showModal();
}

// ---- keys -----------------------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open], .palette, .present')) return;
  if (isTyping(e.target)) return;
  if (fieldKey(e)) return;
  if (app.vectorTools && app.vectorTools.active) {
    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); app.vectorTools.exit(); return; }
    if ((e.key === 'Backspace' || e.key === 'Delete') && app.vectorTools.deleteSelected()) { e.preventDefault(); return; }
  }
  if (e.code === 'Space') { if (!state.space) { state.space = true; app.canvas.el.style.cursor = 'grab'; } e.preventDefault(); return; }
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (arrows[e.key] && !e.metaKey && !e.ctrlKey && state.selection.length) {
    e.preventDefault();
    const k = e.shiftKey ? 10 : 1;
    run('node.nudge', { dx: arrows[e.key][0] * k, dy: arrows[e.key][1] * k });
    return;
  }
  const c = findByKey(comboOf(e));
  if (!c) return;
  if (c.id === 'select.parent' && e.key === 'Escape' && !state.selection.some((id) => state.doc.nodes[id]?.parent)) { e.preventDefault(); setSelection([]); state.tool = 'select'; notify('tool'); return; }
  e.preventDefault();
  run(c.id);
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') { state.space = false; app.canvas.el.style.cursor = 'default'; } });
window.addEventListener('blur', () => { state.space = false; });

// ---- shell ----------------------------------------------------------------------------------------
function buildToolbar(bar) {
  const tools = [['select', '↖', 'V'], ['frame', '#', 'F'], ['rect', '▢', 'R'], ['ellipse', '○', 'O'], ['line', '╱', 'L'], ['polygon', '△', '⇧P'], ['star', '☆', '⇧S'], ['pen', '✒', 'P'], ['pencil', '✎', '⇧L'], ['text', 'T', 'T'], ['hand', '✋', 'H']];
  const toolBtns = tools.map(([t, icon, k]) => h('button.tool', { type: 'button', title: `${get('tool.' + t).label.replace('Tool: ', '')} (${k})`, 'aria-label': get('tool.' + t).label, dataset: null, on: { click: () => run('tool.' + t) } }, icon));
  toolBtns.forEach((b, i) => { b.dataset.tool = tools[i][0]; });
  const menuBtn = h('button.menu-btn', { type: 'button', 'aria-haspopup': 'menu', title: 'Menu', on: { click: (e) => { e.stopPropagation(); toggleMenu(menuBtn); } } }, '☰');
  const name = h('input.doc-name', { type: 'text', 'aria-label': 'Document name', spellcheck: false, on: { keydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); }, change: (e) => run('doc.rename', { name: e.target.value }) } });
  const undoB = h('button.icon', { type: 'button', title: `Undo (${keyLabel('Mod+Z')})`, 'aria-label': 'Undo', on: { click: () => run('edit.undo') } }, '↶');
  const redoB = h('button.icon', { type: 'button', title: `Redo (${keyLabel('Shift+Mod+Z')})`, 'aria-label': 'Redo', on: { click: () => run('edit.redo') } }, '↷');
  const zoom = h('button.zoom', { type: 'button', title: 'Zoom to 100% (Shift+0); Shift+1 fits', on: { click: () => run('view.zoom100') } }, '100%');
  const pal = h('button.icon', { type: 'button', title: `Search commands (${keyLabel('Mod+K')})`, on: { click: () => run('palette.open') } }, `${keyLabel('Mod+K')}`);
  bar.append(h('div.tb-left', menuBtn, h('span.brand', 'Figger'), h('div.tools', { role: 'toolbar', 'aria-label': 'Tools' }, toolBtns)), h('div.tb-mid', name), h('div.tb-right', undoB, redoB, zoom, pal));
  subscribe((what) => {
    toolBtns.forEach((b) => b.classList.toggle('on', b.dataset.tool === state.tool));
    if (document.activeElement !== name) name.value = state.doc.name;
    zoom.textContent = Math.round(state.view.zoom * 100) + '%';
    undoB.disabled = !canUndo();
    redoB.disabled = !canRedo();
  });
}

function toggleMenu(anchor) {
  const open = document.querySelector('.menu');
  if (open) { open.remove(); return; }
  const groups = ['File', 'Export', 'Edit', 'Arrange', 'Layout', 'Components', 'Styles', 'Select', 'View', 'Help'];
  const menu = h('div.menu', { role: 'menu' });
  for (const g of groups) {
    const cs = all().filter((c) => c.group === g && !c.hidden && !c.id.startsWith('tool.'));
    if (!cs.length) continue;
    menu.append(h('div.menu-group', g));
    for (const c of cs) menu.append(h('button.menu-item', { type: 'button', role: 'menuitem', on: { click: () => { menu.remove(); run(c.id); } } }, h('span', c.label), c.keys[0] ? h('kbd', keyLabel(c.keys[0])) : null));
  }
  const r = anchor.getBoundingClientRect();
  menu.style.left = r.left + 'px';
  menu.style.top = r.bottom + 4 + 'px';
  document.body.appendChild(menu);
  setTimeout(() => window.addEventListener('pointerdown', function off(e) { if (!menu.contains(e.target)) { menu.remove(); window.removeEventListener('pointerdown', off); } }), 0);
}

function buildStatus(bar) {
  const left = h('span.st-left'), right = h('span.st-right');
  bar.append(left, right);
  const tick = () => {
    const n = state.selection.length;
    left.textContent = n ? `${n} selected` + (n === 1 ? ` · ${state.doc.nodes[state.selection[0]]?.name || ''}` : '') : `${Object.keys(state.doc.nodes).length} layers`;
    right.textContent = `${saver && saver.dirty ? 'Saving…' : 'Saved'} to ${store ? store.label() : '…'}${state.savedName ? ' · ' + state.savedName : ''}`;
  };
  subscribe(tick);
  setInterval(tick, 1500);
}

// ---- storage ----------------------------------------------------------------------------------------
function startSaver() {
  const save = async () => { await store.saveWorking(JSON.stringify(state.doc)); notify('file'); };
  const n = globalThis.naklios;
  if (n && n.fs && n.fs.autosave) saver = n.fs.autosave({ save, delay: 1000, onError: (e) => toast(`Saving failed: ${e.message}`, 'error') });
  else {
    let t = null;
    saver = { dirty: false, markDirty() { this.dirty = true; clearTimeout(t); t = setTimeout(async () => { try { await save(); this.dirty = false; } catch (e) { toast(`Saving failed: ${e.message}`, 'error'); } }, 1000); }, flush: async () => save() };
  }
}

async function loadWorking() {
  let text = null;
  try { text = await store.loadWorking(); } catch (e) { toast(`Could not read the saved copy: ${e.message}`, 'error'); }
  if (text) {
    try { replaceDoc(validateDoc(JSON.parse(text))); return true; } catch (e) { toast(`Saved copy is unreadable (${e.message}); starting fresh`, 'error'); }
  }
  replaceDoc(seedDoc());
  return false;
}

let backendKey = null;
const keyOfBackend = () => { const c = globalThis.naklios?.capabilities; return c && c.hosted && c.fs ? 'host:' + (c.fsBackend || '') : 'local'; };
async function onCapabilities() {
  const k = keyOfBackend();
  if (k === backendKey) return;
  // Each storage location keeps its own documents; switching copies nothing.
  if (saver && saver.dirty) { try { await saver.flush(); } catch {} }
  backendKey = k;
  store = pickStore();
  await loadWorking();
  run('view.fit');
}

function waitForHostStorage(ms) {
  const n = globalThis.naklios;
  if (!n || !n.capabilities.hosted || window.parent === window || n.capabilities.fs) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    n.onCapabilitiesChange(() => { if (n.capabilities.fs) { clearTimeout(t); resolve(); } });
  });
}

// ---- boot -----------------------------------------------------------------------------------------
async function boot() {
  const root = document.getElementById('app');
  const bar = h('header.toolbar');
  const wrap = h('div.canvas-wrap', { tabindex: '0', 'aria-label': 'Canvas' }, h('canvas'));
  const layers = h('aside.layers');
  const props = h('aside.props', { 'aria-label': 'Properties' });
  const status = h('footer.status');
  clear(root).append(bar, h('div.main', layers, wrap, props), status);
  app.canvas = createCanvas(wrap, app);
  app.vectorTools = createVectorTools(app.canvas, app);
  setImageReadyHandler(() => app.canvas.requestRender());
  app.focusCanvas = () => wrap.focus({ preventScroll: true });
  app.viewCenter = () => app.canvas.toWorld(app.canvas.center().x, app.canvas.center().y);
  buildToolbar(bar);
  buildStatus(status);
  createLayers(layers, app);
  createProps(props, app);

  connectHost({ run: (id, p, o) => run(id, p, o), onTheme: applyHostTheme, onCapabilities: () => onCapabilities(), title: 'Figger' });
  await waitForHostStorage(1500);
  backendKey = keyOfBackend();
  store = pickStore();
  startSaver();
  await loadWorking();
  nextFrame(() => run('view.fit'));
  subscribe((what) => { if (what.has('doc') && !what.has('preview')) document.title = `${state.doc.name} · Figger`; });

  // Drop a .figger.json file anywhere to open it.
  window.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    e.preventDefault();
    if (/^image\//.test(f.type)) {
      const r = app.canvas.el.getBoundingClientRect();
      try { await placeImageFile(f, app.canvas.toWorld(e.clientX - r.left, e.clientY - r.top)); } catch (err) { report(err); }
      return;
    }
    try {
      const text = await f.text();
      const r = app.canvas.el.getBoundingClientRect();
      if (!/\.figger\.json$/i.test(f.name) && (await importText(text, f.name, app.canvas.toWorld(e.clientX - r.left, e.clientY - r.top)))) return;
      await loadText(text, f.name);
    } catch (err) { toast(`Could not open ${f.name}: ${err.message}`, 'error'); }
  });
}

// The in-page agent face. Same registry, same checks as the NakliOS rail.
globalThis.figger = Object.freeze({
  version: VERSION,
  commands: () => manifest(),
  run: (id, params) => run(id, params || {}, { source: 'agent' }),
  state: () => structuredClone({ doc: state.doc, selection: state.selection, view: state.view }),
  help: () => 'figger.commands() lists every command with its params and scope; figger.run(id, params) runs one. Person-only commands (file pickers) are refused; use doc.get and doc.load.',
});

boot().catch((e) => { console.error(e); toast(`Figger failed to start: ${e.message}`, 'error'); });
