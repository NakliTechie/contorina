// The app's only storage surface (NakliOS transport-adapter pattern, docs/app-contract.md).
// Hosted with storage: documents live in apps/figger/documents/ on the person's Folder or Crate through
// naklios.fs. Standalone: File System Access pickers (download/upload fallback) plus a working copy
// in this browser's localStorage. Both expose the same interface.
const DIR = 'documents/';
const WORKING = 'working.figger.json';
const LS_KEY = 'figger.working';
const nak = () => globalThis.naklios;
export const EXT = '.figger.json';

export function safeName(name) {
  return (String(name || 'Untitled').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim().slice(0, 80) || 'Untitled') + EXT;
}

function hostStore() {
  const fs = nak().fs;
  return {
    kind: 'host',
    label: () => { const c = nak().capabilities; const b = (c.fsBackends || []).find((x) => x.id === c.fsBackend); return b ? `${b.label}${b.name ? ' · ' + b.name : ''}` : 'NakliOS storage'; },
    async loadWorking() { return (await fs.exists(WORKING)) ? fs.read(WORKING) : null; },
    async saveWorking(text) { await fs.write(WORKING, text); },
    async list() { return (await fs.list(DIR)).map((f) => (typeof f === 'string' ? f : f.path || f.name)).filter((p) => p.endsWith(EXT)).map((p) => p.replace(/^.*\//, '')); },
    async read(file) { return fs.read(DIR + file); },
    async write(file, text) { await fs.write(DIR + file, text); return file; },
    async remove(file) { await fs.delete(DIR + file); },
    pickers: false,
  };
}

function localStore() {
  let handle = null;
  const hasFSA = typeof showSaveFilePicker === 'function';
  const types = [{ description: 'Figger document', accept: { 'application/json': [EXT, '.json'] } }];
  return {
    kind: 'local',
    label: () => 'This browser',
    async loadWorking() { try { return localStorage.getItem(LS_KEY); } catch { return null; } },
    async saveWorking(text) { try { localStorage.setItem(LS_KEY, text); } catch (e) { if (text.length > 4e6) throw new Error('Document is too large for the browser copy; save it to a file'); throw e; } },
    pickers: true,
    hasHandle: () => !!handle,
    forget() { handle = null; },
    async openPicked() {
      if (typeof showOpenFilePicker === 'function') {
        const [h] = await showOpenFilePicker({ types, multiple: false });
        handle = h;
        const f = await h.getFile();
        return { name: f.name, text: await f.text() };
      }
      const f = await new Promise((resolve, reject) => {
        const input = Object.assign(document.createElement('input'), { type: 'file', accept: `${EXT},.json,application/json` });
        input.onchange = () => (input.files[0] ? resolve(input.files[0]) : reject(new Error('No file chosen')));
        input.click();
      });
      handle = null;
      return { name: f.name, text: await f.text() };
    },
    async savePicked(name, text, { as = false } = {}) {
      if (hasFSA) {
        if (!handle || as) handle = await showSaveFilePicker({ suggestedName: safeName(name), types });
        const w = await handle.createWritable();
        await w.write(text);
        await w.close();
        return handle.name;
      }
      download(new Blob([text], { type: 'application/json' }), safeName(name));
      return safeName(name);
    },
  };
}

export function pickStore() {
  const n = nak();
  return n && n.capabilities.hosted && n.capabilities.fs ? hostStore() : localStore();
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
