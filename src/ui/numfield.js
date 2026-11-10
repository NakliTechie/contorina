// Number fields that behave the way Blender draws them (behaviours only, written fresh):
// drag the label to scrub with a hidden cursor, Shift for precision, Ctrl to snap, Ctrl+wheel steps,
// Backspace over the field resets, and the input takes typed maths (2*pi, min(4, 3), x+10).
import { h } from './dom.js';
import { evalExpr } from '../expr.js';

let hovered = null;
export function fieldKey(e) {
  if (!hovered || e.key !== 'Backspace' || document.activeElement === hovered.input) return false;
  e.preventDefault();
  hovered.reset();
  return true;
}

// opts: { label, title, get() -> number | null (mixed), apply(value, phase: 'preview'|'commit'|'cancel'),
//         step = 1, min, max, def = 0, unit, decimals = 2 }
export function numberField(opts) {
  const step = opts.step ?? 1;
  const dec = opts.decimals ?? 2;
  const clamp = (v) => Math.min(opts.max ?? Infinity, Math.max(opts.min ?? -Infinity, v));
  const fmt = (v) => (v == null ? '' : String(Math.round(v * 10 ** dec) / 10 ** dec));
  const input = h('input', { type: 'text', inputmode: 'decimal', spellcheck: false, 'aria-label': opts.title || opts.label });
  const lab = h('span.nf-label', { title: `${opts.title || opts.label}: drag to change (Shift fine, Ctrl snap)` }, opts.label);
  const el = h('label.nf', lab, input, opts.unit ? h('span.nf-unit', opts.unit) : null);
  const api = {
    el, input,
    update() {
      if (document.activeElement === input || api.dragging) return;
      const v = opts.get();
      input.value = fmt(v);
      input.placeholder = v == null ? 'Mixed' : '';
    },
    reset() { opts.apply(clamp(opts.def ?? 0), 'commit'); api.update(); },
    dragging: false,
  };
  el.addEventListener('pointerenter', () => { hovered = api; });
  el.addEventListener('pointerleave', () => { if (hovered === api) hovered = null; });

  lab.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const v0 = opts.get() ?? 0;
    let acc = 0, value = v0, moved = false;
    api.dragging = true;
    lab.setPointerCapture(e.pointerId);
    try { lab.requestPointerLock?.({ unadjustedMovement: true })?.catch?.(() => {}); } catch {}
    const move = (ev) => {
      acc += ev.movementX || 0;
      if (!moved && Math.abs(acc) < 2) return;
      moved = true;
      let v = v0 + acc * step * (ev.shiftKey ? 0.1 : 1);
      if (ev.ctrlKey || ev.metaKey) v = Math.round(v / (step * 10)) * step * 10;
      value = clamp(Math.round(v * 10 ** dec) / 10 ** dec);
      input.value = fmt(value);
      opts.apply(value, 'preview');
    };
    const up = () => {
      lab.removeEventListener('pointermove', move);
      lab.removeEventListener('pointerup', up);
      lab.removeEventListener('pointercancel', up);
      if (document.pointerLockElement === lab) document.exitPointerLock();
      api.dragging = false;
      if (moved) opts.apply(value, 'commit');
      else input.focus(), input.select();
      api.update();
    };
    lab.addEventListener('pointermove', move);
    lab.addEventListener('pointerup', up);
    lab.addEventListener('pointercancel', up);
  });

  const commitTyped = () => {
    const text = input.value.trim();
    if (!text) { api.update(); return; }
    try {
      const cur = opts.get() ?? 0;
      const v = clamp(evalExpr(text, { x: cur, value: cur }));
      opts.apply(Math.round(v * 10 ** dec) / 10 ** dec, 'commit');
      input.classList.remove('bad');
    } catch (err) {
      input.classList.add('bad');
      input.title = err.message;
      return;
    }
    api.update();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { commitTyped(); input.blur(); }
    else if (e.key === 'Escape') { input.classList.remove('bad'); input.blur(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const v = clamp((opts.get() ?? 0) + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
      opts.apply(v, 'commit');
      input.value = fmt(v);
    }
  });
  input.addEventListener('blur', () => { if (!input.classList.contains('bad')) api.update(); });
  input.addEventListener('change', commitTyped);
  el.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const v = clamp((opts.get() ?? 0) + (e.deltaY < 0 ? 1 : -1) * step * (e.shiftKey ? 0.1 : 1));
    opts.apply(v, 'commit');
    input.value = fmt(v);
  }, { passive: false });
  api.update();
  return api;
}

// Toggles you can drag across to set them all to the first one's new value (layers eye and lock).
let sweep = null;
window.addEventListener('pointerup', () => { sweep = null; });
export function sweepToggle(el, get, set) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const v = !get();
    sweep = { v, done: new Set([el]) };
    set(v);
  });
  el.addEventListener('pointerenter', () => {
    if (!sweep || sweep.done.has(el)) return;
    sweep.done.add(el);
    if (get() !== sweep.v) set(sweep.v);
  });
}
