// The canvas: view transform, pointer tools and the screen-space overlay.
// Every change goes through a command; a drag previews the command on the gesture's base document
// and commits it once on release, so one drag is one undo step.
import { state, subscribe, notify, setSelection } from './store.js';
import { drawView } from './render.js';
import { hitChain, pick, marqueeHits, frameAt } from './hit.js';
import { worldMatrix, worldBox, unionBoxes, apply, inv, applyVec, localMatrix, mul, rad, deg, round2, IDENT } from './geom.js';
import { snapBox, measure } from './snap.js';
import { topmost, hasLayout } from './doc.js';
import { textOf, fontStack } from './styles.js';

const HANDLE = 4;
const SEL = '#0D99FF';
const COMPONENT = '#9747FF';

export function createCanvas(wrap, app) {
  const canvas = wrap.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  let size = { w: 1, h: 1 }, dpr = 1, dirty = true;
  let drag = null;
  let last = { x: 0, y: 0 };

  const toWorld = (sx, sy) => ({ x: (sx - state.view.x) / state.view.zoom, y: (sy - state.view.y) / state.view.zoom });
  const toScreen = (p) => ({ x: p.x * state.view.zoom + state.view.x, y: p.y * state.view.zoom + state.view.y });
  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  function resize() {
    const r = wrap.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    size = { w: Math.max(1, r.width), h: Math.max(1, r.height) };
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    canvas.style.width = size.w + 'px';
    canvas.style.height = size.h + 'px';
    requestRender();
  }
  new ResizeObserver(resize).observe(wrap);

  function requestRender() {
    if (dirty) return;
    dirty = true;
    requestAnimationFrame(frame);
  }
  function frame() {
    dirty = false;
    const t0 = performance.now();
    const skip = state.editing ? new Set([state.editing]) : null;
    drawView(ctx, state.doc, state.view, size, dpr, { skip, background: getComputedStyle(wrap).getPropertyValue('--canvas-bg').trim() || '#F5F5F5' });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawOverlay();
    app.lastFrameMs = performance.now() - t0;
  }
  subscribe(() => { requestRender(); positionEditor(); });
  // Measure now (a hidden page gets no frames or resize callbacks) and again on the first frame.
  resize();
  requestAnimationFrame(() => { dirty = false; resize(); });

  // ---- overlay -------------------------------------------------------------------------------
  function screenPoly(id) {
    const n = state.doc.nodes[id];
    const m = worldMatrix(state.doc, id);
    return [{ x: 0, y: 0 }, { x: n.w, y: 0 }, { x: n.w, y: n.h }, { x: 0, y: n.h }].map((p) => toScreen(apply(m, p)));
  }
  function poly(pts, color, width = 1) {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }
  function handles() {
    if (state.selection.length !== 1) return [];
    const id = state.selection[0];
    const n = state.doc.nodes[id];
    if (!n || n.src || n.locked) return [];
    const m = worldMatrix(state.doc, id);
    const pts = [];
    const H = n.type === 'line' ? [[-1, 0], [1, 0]] : [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
    for (const [hx, hy] of H) {
      const p = toScreen(apply(m, { x: (n.w * (hx + 1)) / 2, y: (n.h * (hy + 1)) / 2 }));
      pts.push({ hx, hy, ...p });
    }
    return pts;
  }
  function label(text, x, y, bg) {
    ctx.font = '11px ' + fontStack('Inter');
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x - w / 2, y - 8, w, 16, 3) : ctx.rect(x - w / 2, y - 8, w, 16);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }
  function drawOverlay() {
    const doc = state.doc;
    // Top-level frame names.
    ctx.font = '11px ' + fontStack('Inter');
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    for (const id of doc.children) {
      const n = doc.nodes[id];
      if (!n || (n.type !== 'frame' && n.type !== 'instance') || n.visible === false) continue;
      const p = toScreen(apply(worldMatrix(doc, id), { x: 0, y: 0 }));
      const comp = n.component || n.variantSet || n.type === 'instance';
      ctx.fillStyle = comp ? COMPONENT : state.selection.includes(id) ? SEL : '#7A7A7A';
      ctx.fillText((n.component ? '❖ ' : n.type === 'instance' ? '◇ ' : '') + n.name, p.x, p.y - 4);
    }
    if (state.hover && !state.selection.includes(state.hover) && doc.nodes[state.hover] && !drag) poly(screenPoly(state.hover), doc.nodes[state.hover].component || doc.nodes[state.hover].type === 'instance' ? COMPONENT : SEL, 1.5);
    for (const id of state.selection) if (doc.nodes[id]) poly(screenPoly(id), doc.nodes[id].component || doc.nodes[id].type === 'instance' ? COMPONENT : SEL, 1);
    if (state.selection.length > 1) {
      const b = unionBoxes(state.selection.filter((id) => doc.nodes[id]).map((id) => worldBox(doc, id)));
      if (b) { const a = toScreen(b), c = toScreen({ x: b.x + b.w, y: b.y + b.h }); poly([a, { x: c.x, y: a.y }, c, { x: a.x, y: c.y }], SEL, 1); }
    }
    for (const h of handles()) {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = SEL;
      ctx.lineWidth = 1;
      ctx.fillRect(h.x - HANDLE, h.y - HANDLE, HANDLE * 2, HANDLE * 2);
      ctx.strokeRect(h.x - HANDLE + 0.5, h.y - HANDLE + 0.5, HANDLE * 2 - 1, HANDLE * 2 - 1);
    }
    if (state.selection.length === 1 && doc.nodes[state.selection[0]] && (drag?.kind === 'resize' || drag?.kind === 'move' || drag?.kind === 'create')) {
      const n = doc.nodes[state.selection[0]];
      const b = worldBox(doc, n.id);
      const p = toScreen({ x: b.x + b.w / 2, y: b.y + b.h });
      label(`${round2(n.w)} × ${round2(n.h)}`, p.x, p.y + 14, SEL);
    }
    if (drag?.kind === 'rotate') {
      const n = doc.nodes[drag.id];
      const b = worldBox(doc, drag.id);
      const p = toScreen({ x: b.x + b.w / 2, y: b.y + b.h });
      label(`${round2(n.rotation || 0)}°`, p.x, p.y + 14, SEL);
    }
    ctx.strokeStyle = '#F24822';
    ctx.lineWidth = 1;
    for (const g of state.guides) {
      const a = toScreen({ x: g.x1, y: g.y1 }), b = toScreen({ x: g.x2, y: g.y2 });
      ctx.beginPath(); ctx.moveTo(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5); ctx.lineTo(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5); ctx.stroke();
    }
    if (state.measure) {
      for (const l of state.measure) {
        const a = toScreen({ x: l.x1, y: l.y1 }), b = toScreen({ x: l.x2, y: l.y2 });
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        label(String(l.len), (a.x + b.x) / 2, (a.y + b.y) / 2, '#F24822');
      }
    }
    drawGrids();
    if (app.vectorTools) app.vectorTools.overlay(ctx, toScreen);
    if (state.marquee) {
      const m = state.marquee;
      const a = toScreen(m), b = toScreen({ x: m.x + m.w, y: m.y + m.h });
      ctx.fillStyle = 'rgba(13,153,255,0.08)';
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.strokeStyle = SEL;
      ctx.strokeRect(a.x + 0.5, a.y + 0.5, b.x - a.x, b.y - a.y);
    }
  }

  // Layout grids: columns, rows or a square grid, inside every visible frame that has them.
  function drawGrids() {
    const doc = state.doc;
    for (const id in doc.nodes) {
      const n = doc.nodes[id];
      if (!n.grids || n.visible === false || n.type !== 'frame') continue;
      const m = worldMatrix(doc, id);
      const z = state.view.zoom;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr * z * m[0], dpr * z * m[1], dpr * z * m[2], dpr * z * m[3], dpr * (z * m[4] + state.view.x), dpr * (z * m[5] + state.view.y));
      ctx.beginPath(); ctx.rect(0, 0, n.w, n.h); ctx.clip();
      for (const g of n.grids) {
        if (g.visible === false) continue;
        ctx.fillStyle = g.color || 'rgba(255,0,0,0.1)';
        ctx.strokeStyle = g.color || 'rgba(255,0,0,0.1)';
        if (g.type === 'grid') {
          const sz = Math.max(1, g.size || 8);
          ctx.lineWidth = 1 / z;
          ctx.beginPath();
          for (let x = sz; x < n.w; x += sz) { ctx.moveTo(x, 0); ctx.lineTo(x, n.h); }
          for (let y = sz; y < n.h; y += sz) { ctx.moveTo(0, y); ctx.lineTo(n.w, y); }
          ctx.stroke();
          continue;
        }
        const cols = g.type === 'columns';
        const total = cols ? n.w : n.h, count = Math.max(1, g.count || 1), gut = g.gutter || 0, mar = g.margin || 0;
        const size = (total - 2 * mar - gut * (count - 1)) / count;
        for (let i = 0; i < count; i++) {
          const a = mar + i * (size + gut);
          if (cols) ctx.fillRect(a, 0, size, n.h); else ctx.fillRect(0, a, n.w, size);
        }
      }
      ctx.restore();
    }
  }

  // ---- hit helpers ---------------------------------------------------------------------------
  function handleAt(s) {
    for (const h of handles()) if (Math.abs(h.x - s.x) <= HANDLE + 2 && Math.abs(h.y - s.y) <= HANDLE + 2) return { kind: 'resize', h };
    if (state.selection.length === 1) {
      const n = state.doc.nodes[state.selection[0]];
      if (n && !n.src && !n.locked && n.type !== 'line') {
        for (const h of handles().filter((h) => h.hx && h.hy)) {
          const d = Math.hypot(h.x - s.x, h.y - s.y);
          if (d > HANDLE + 2 && d < 18) return { kind: 'rotate', h };
        }
      }
    }
    return null;
  }
  const tol = () => 3 / state.view.zoom;

  function cursorFor(s, e) {
    if (state.space || state.tool === 'hand') return drag?.kind === 'pan' ? 'grabbing' : 'grab';
    if (state.tool !== 'select') return state.tool === 'text' ? 'text' : state.tool === 'pen' || state.tool === 'pencil' ? 'crosshair' : 'crosshair';
    const h = handleAt(s);
    if (h && h.kind === 'rotate') return 'alias';
    if (h) {
      const n = state.doc.nodes[state.selection[0]];
      const a = (deg(Math.atan2(h.h.hy, h.h.hx)) + (n.rotation || 0) + 360) % 180;
      return a < 22.5 || a >= 157.5 ? 'ew-resize' : a < 67.5 ? 'nwse-resize' : a < 112.5 ? 'ns-resize' : 'nesw-resize';
    }
    return 'default';
  }

  // ---- pointer -------------------------------------------------------------------------------
  canvas.addEventListener('pointerdown', (e) => {
    if (state.editing) app.endTextEdit(true);
    // Stop the mouse-down default from moving focus after we place it (it would blur a new text editor).
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
    wrap.focus({ preventScroll: true });
    const s = local(e), w = toWorld(s.x, s.y);
    last = s;
    if (e.button === 1 || state.space || state.tool === 'hand') { drag = { kind: 'pan', s, view: { ...state.view } }; canvas.style.cursor = 'grabbing'; return; }
    if (e.button !== 0) return;
    if (app.vectorTools && app.vectorTools.down(e, s, w)) { drag = { kind: 'vector' }; return; }
    if (state.tool !== 'select') { startCreate(w, e); return; }
    const h = handleAt(s);
    if (h) { startHandle(h, w, e); return; }
    const chain = hitChain(state.doc, w, tol());
    const target = pick(state.doc, chain, state.selection, { deep: app.isMod(e) });
    // Frame background with children and not selected: marquee inside the frame.
    if (!target || (chain.length === 1 && state.doc.nodes[target].type === 'frame' && state.doc.nodes[target].children.length && !state.selection.includes(target) && !e.shiftKey && !state.doc.nodes[target].component && state.doc.nodes[target].type !== 'instance' && !state.doc.nodes[target].variantSet)) {
      drag = { kind: 'marquee', start: w, scope: target ? chain[0] : null, clickTarget: target, base: e.shiftKey ? state.selection.slice() : [] };
      if (!e.shiftKey && !target) app.run('select.set', { ids: [] });
      return;
    }
    if (e.shiftKey) {
      const next = state.selection.includes(target) ? state.selection.filter((x) => x !== target) : [...state.selection, target];
      app.run('select.set', { ids: next });
    } else if (!state.selection.includes(target)) app.run('select.set', { ids: [target] });
    const ids = topmost(state.doc, state.selection).filter((id) => !state.doc.nodes[id].src && !state.doc.nodes[id].locked);
    drag = { kind: 'move', start: w, ids, target, moved: false, shift: e.shiftKey, g: app.gesture() };
  });

  function startCreate(w, e) {
    const type = state.tool;
    const parent = frameAt(state.doc, w, null);
    const id = 'n' + Math.random().toString(36).slice(2, 10);
    drag = { kind: 'create', type, start: w, parent, id, g: app.gesture(), moved: false };
    if (type === 'text') {
      // The new text layer is a preview until its first edit commits: creating and typing is one undo step.
      drag = null;
      const p = parentLocal(parent, w);
      const g = app.gesture();
      const params = { type: 'text', parent, x: round2(p.x), y: round2(p.y - 10), id, props: { text: '' } };
      g.preview('node.create', params);
      app.run('tool.select');
      app.startTextEdit(id, { create: params, g });
    }
  }
  function parentLocal(pid, w) { return pid ? apply(inv(worldMatrix(state.doc, pid)), w) : w; }

  function startHandle(h, w, e) {
    const id = state.selection[0];
    const n = state.doc.nodes[id];
    const pmx = n.parent ? worldMatrix(state.doc, n.parent) : IDENT;
    drag = { kind: h.kind, h: h.h, id, n: { ...n }, pm: pmx, start: w, g: app.gesture(), startAngle: null };
    if (h.kind === 'rotate') {
      const c = apply(worldMatrix(state.doc, id), { x: n.w / 2, y: n.h / 2 });
      drag.c = c;
      drag.startAngle = Math.atan2(w.y - c.y, w.x - c.x);
    }
  }

  canvas.addEventListener('pointermove', (e) => {
    const s = local(e), w = toWorld(s.x, s.y);
    last = s;
    app.pointerWorld = w;
    if (app.vectorTools && app.vectorTools.move(e, s, w, !!drag)) return;
    if (!drag) { hover(s, w, e); canvas.style.cursor = cursorFor(s, e); return; }
    switch (drag.kind) {
      case 'pan':
        state.view.x = drag.view.x + (s.x - drag.s.x);
        state.view.y = drag.view.y + (s.y - drag.s.y);
        notify('view');
        break;
      case 'marquee': {
        const a = drag.start;
        state.marquee = { x: Math.min(a.x, w.x), y: Math.min(a.y, w.y), w: Math.abs(w.x - a.x), h: Math.abs(w.y - a.y) };
        if (state.marquee.w * state.view.zoom > 2 || state.marquee.h * state.view.zoom > 2) {
          const hits = marqueeHits(state.doc, drag.scope, state.marquee);
          setSelection([...new Set([...drag.base, ...hits])]);
        }
        notify('overlay');
        break;
      }
      case 'move': moveDrag(w, e); break;
      case 'create': createDrag(w, e); break;
      case 'resize': resizeDrag(w, e); break;
      case 'rotate': rotateDrag(w, e); break;
    }
  });

  function hover(s, w, e) {
    const chain = hitChain(state.doc, w, tol());
    const h = pick(state.doc, chain, state.selection, { deep: app.isMod(e) });
    let m = null;
    if (e.altKey && state.selection.length && h && !state.selection.includes(h)) {
      const a = unionBoxes(state.selection.map((id) => worldBox(state.doc, id)));
      m = measure(a, worldBox(state.doc, h));
    }
    if (h !== state.hover || (m || state.measure)) { state.hover = h; state.measure = m; notify('overlay'); }
  }

  function moveDrag(w, e) {
    let dx = w.x - drag.start.x, dy = w.y - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) * state.view.zoom < 3) return;
    if (!drag.ids.length) return;
    if (!drag.moved) { drag.moved = true; drag.base = state.doc; }
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    const base = drag.base;
    const ids = drag.ids;
    const first = base.nodes[ids[0]];
    const inFlow = first.parent && hasLayout(base.nodes[first.parent]);
    state.guides = [];
    if (!inFlow && !app.isMod(e)) {
      const box = unionBoxes(ids.map((id) => worldBox(base, id)));
      const moving = { ...box, x: box.x + dx, y: box.y + dy };
      const scope = first.parent ? base.nodes[first.parent].children : base.children;
      const set = new Set(ids);
      const targets = scope.filter((id) => !set.has(id) && base.nodes[id].visible !== false).map((id) => worldBox(base, id));
      if (first.parent) targets.push(worldBox(base, first.parent));
      const r = snapBox(moving, targets.filter((t) => Math.abs(t.x - moving.x) < 4000 && Math.abs(t.y - moving.y) < 4000), 5 / state.view.zoom);
      dx += r.dx; dy += r.dy;
      state.guides = r.guides;
    }
    dx = round2(dx); dy = round2(dy);
    // Drop target: the frame under the pointer, unless we drag a top-level frame.
    const exclude = new Set(ids);
    let parent;
    const topFrame = ids.some((id) => !base.nodes[id].parent && base.nodes[id].type === 'frame');
    if (!topFrame && !app.isMod(e)) parent = frameAt(base, w, exclude);
    else parent = first.parent ?? null;
    drag.params = { ids, dx, dy, parent };
    drag.g.preview('node.move', drag.params);
  }

  function createDrag(w, e) {
    let x0 = drag.start.x, y0 = drag.start.y, x1 = w.x, y1 = w.y;
    if (!drag.moved && Math.hypot(x1 - x0, y1 - y0) * state.view.zoom < 3) return;
    drag.moved = true;
    const p0 = parentLocal(drag.parent, drag.start), p1 = parentLocal(drag.parent, w);
    if (drag.type === 'line') {
      let dx = p1.x - p0.x, dy = p1.y - p0.y;
      let ang = Math.atan2(dy, dx);
      if (e.shiftKey) ang = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(dx, dy);
      const mx = p0.x + (Math.cos(ang) * len) / 2, my = p0.y + (Math.sin(ang) * len) / 2;
      drag.params = { type: 'line', parent: drag.parent, id: drag.id, x: round2(mx - len / 2), y: round2(my), w: round2(len), h: 0, props: { rotation: round2(deg(ang)) } };
    } else {
      let w2 = p1.x - p0.x, h2 = p1.y - p0.y;
      if (e.shiftKey) { const m = Math.max(Math.abs(w2), Math.abs(h2)); w2 = Math.sign(w2 || 1) * m; h2 = Math.sign(h2 || 1) * m; }
      let x = p0.x, y = p0.y;
      if (e.altKey) { x -= w2; y -= h2; w2 *= 2; h2 *= 2; }
      drag.params = { type: drag.type, parent: drag.parent, id: drag.id, x: round2(Math.min(x, x + w2)), y: round2(Math.min(y, y + h2)), w: Math.max(1, round2(Math.abs(w2))), h: Math.max(1, round2(Math.abs(h2))) };
    }
    drag.g.preview('node.create', drag.params);
  }

  function resizeDrag(w, e) {
    const { h, n, pm: pmx } = drag;
    const P = apply(inv(pmx), w);
    const r = rad(n.rotation || 0), c = Math.cos(r), s = Math.sin(r);
    const C = { x: n.x + n.w / 2, y: n.y + n.h / 2 };
    const rot = (v) => ({ x: c * v.x - s * v.y, y: s * v.x + c * v.y });
    const unrot = (v) => ({ x: c * v.x + s * v.y, y: -s * v.x + c * v.y });
    const fromCenter = e.altKey;
    const ah = { x: -h.hx * n.w / 2, y: -h.hy * n.h / 2 };
    const A = fromCenter ? C : { x: C.x + rot(ah).x, y: C.y + rot(ah).y };
    const d = unrot({ x: P.x - A.x, y: P.y - A.y });
    let nw = n.w, nh = n.h;
    const k = fromCenter ? 2 : 1;
    if (h.hx) nw = Math.max(1, h.hx * d.x * k);
    if (h.hy) nh = Math.max(1, h.hy * d.y * k);
    if (e.shiftKey && n.h > 0 && n.type !== 'line') {
      const ratio = n.w / n.h;
      if (h.hx && h.hy) { if (nw / nh > ratio) nh = nw / ratio; else nw = nh * ratio; }
      else if (h.hx) nh = nw / ratio;
      else nw = nh * ratio;
    }
    nw = round2(nw); nh = n.type === 'line' ? 0 : round2(nh);
    // The anchor (opposite edge or corner) stays put; on an edge handle the other axis stays centred.
    const off = rot({ x: (h.hx * nw) / 2, y: (h.hy * nh) / 2 });
    const nc = fromCenter ? C : { x: A.x + off.x, y: A.y + off.y };
    const props = { x: round2(nc.x - nw / 2), y: round2(nc.y - nh / 2), w: nw, h: nh };
    drag.params = { ids: [drag.id], props };
    drag.g.preview('node.set', drag.params);
  }

  function rotateDrag(w, e) {
    const a = Math.atan2(w.y - drag.c.y, w.x - drag.c.x);
    let r = (drag.n.rotation || 0) + deg(a - drag.startAngle);
    r = ((r + 180) % 360 + 360) % 360 - 180;
    if (e.shiftKey) r = Math.round(r / 15) * 15;
    drag.params = { ids: [drag.id], props: { rotation: round2(r) } };
    drag.g.preview('node.set', drag.params);
  }

  canvas.addEventListener('pointerup', (e) => {
    const d = drag;
    drag = null;
    if (d && d.kind === 'vector') { app.vectorTools.up(e, local(e), toWorld(local(e).x, local(e).y)); return; }
    state.guides = [];
    canvas.style.cursor = 'default';
    if (!d) return;
    if (d.kind === 'marquee') {
      const tiny = !state.marquee || (state.marquee.w * state.view.zoom < 3 && state.marquee.h * state.view.zoom < 3);
      state.marquee = null;
      if (tiny && d.clickTarget) app.run('select.set', { ids: [d.clickTarget] });
      else if (!tiny) app.run('select.set', { ids: state.selection });
      notify('overlay');
      return;
    }
    if (d.kind === 'move') {
      if (d.moved && d.params) d.g.commit('node.move', d.params);
      else { d.g.cancel(); if (!d.shift && state.selection.length > 1 && d.target) app.run('select.set', { ids: [d.target] }); }
      return;
    }
    if (d.kind === 'create') {
      if (!d.moved) {
        const p = parentLocal(d.parent, d.start);
        const def = d.type === 'line' ? { w: 100, h: 0 } : { w: 100, h: 100 };
        d.params = { type: d.type, parent: d.parent, id: d.id, x: round2(p.x - (d.type === 'line' ? 0 : def.w / 2)), y: round2(p.y - def.h / 2), ...def };
      }
      d.g.commit('node.create', d.params);
      app.run('tool.select');
      return;
    }
    if ((d.kind === 'resize' || d.kind === 'rotate') && d.params) { d.g.commit('node.set', d.params); return; }
    if (d.g) d.g.cancel();
  });

  canvas.addEventListener('dblclick', (e) => {
    const s = local(e), w = toWorld(s.x, s.y);
    if (app.vectorTools && app.vectorTools.dblclick(e, s, w)) return;
    const chain = hitChain(state.doc, w, tol());
    const target = pick(state.doc, chain, state.selection, { drill: true });
    if (!target) return;
    const n = state.doc.nodes[target];
    if (n.type === 'text' && state.selection.includes(target)) { app.startTextEdit(target); return; }
    if ((n.type === 'vector' || n.type === 'polygon' || n.type === 'star') && state.selection.includes(target) && app.vectorTools) { app.vectorTools.editPath(target); return; }
    app.run('select.set', { ids: [target] });
    if (n.type === 'text') app.startTextEdit(target);
  });

  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const s = local(e);
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0025) * (e.ctrlKey && !e.metaKey ? 4 : 1));
      zoomAt(s, state.view.zoom * factor);
    } else {
      const k = e.deltaMode ? 20 : 1;
      state.view.x -= (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k;
      state.view.y -= (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k;
      notify('view');
    }
  }, { passive: false });

  function zoomAt(s, z) {
    z = Math.min(256, Math.max(0.02, z));
    const w = toWorld(s.x, s.y);
    state.view.zoom = z;
    state.view.x = s.x - w.x * z;
    state.view.y = s.y - w.y * z;
    notify('view');
  }
  function fitBox(b, maxZoom = 1) {
    if (!b) { state.view = { x: size.w / 2, y: size.h / 2, zoom: 1 }; notify('view'); return; }
    const pad = 60;
    const z = Math.min(maxZoom, (size.w - pad * 2) / Math.max(1, b.w), (size.h - pad * 2) / Math.max(1, b.h));
    state.view.zoom = Math.max(0.02, z);
    state.view.x = size.w / 2 - (b.x + b.w / 2) * state.view.zoom;
    state.view.y = size.h / 2 - (b.y + b.h / 2) * state.view.zoom;
    notify('view');
  }

  // ---- text editing --------------------------------------------------------------------------
  const editor = document.createElement('textarea');
  editor.className = 'text-editor';
  editor.spellcheck = false;
  editor.hidden = true;
  wrap.appendChild(editor);
  let editBase = null;
  function positionEditor() {
    const id = state.editing;
    if (!id || !state.doc.nodes[id]) { editor.hidden = true; return; }
    const n = state.doc.nodes[id];
    const t = textOf(n, state.doc.styles);
    const m = worldMatrix(state.doc, id);
    const z = state.view.zoom;
    const sm = mul([z, 0, 0, z, state.view.x, state.view.y], m);
    Object.assign(editor.style, {
      transform: `matrix(${sm.join(',')})`, width: Math.max(n.w, 20) + 40 + 'px', height: n.h + 'px',
      font: `${t.fontWeight} ${t.fontSize}px ${fontStack(t.fontFamily)}`, lineHeight: t.fontSize * (t.lineHeight || 1.25) + 'px',
      color: n.fill || '#000', textAlign: t.align || 'left',
    });
    if (n.autoSize !== 'width') editor.style.width = n.w + 'px';
    editor.hidden = false;
  }
  app.startTextEdit = (id, fresh = null) => {
    const n = state.doc.nodes[id];
    if (!n || n.type !== 'text') return;
    state.editing = id;
    editBase = { id, text: n.text, fresh, g: fresh ? fresh.g : null };
    editor.value = n.text;
    positionEditor();
    editor.focus();
    if (!fresh) editor.select();
    notify('overlay');
  };
  editor.addEventListener('input', () => {
    if (!state.editing) return;
    // Live size update without history: the commit below records one undo step.
    const id = state.editing;
    const g = editBase.g || (editBase.g = app.gesture());
    if (editBase.fresh) g.preview('node.create', { ...editBase.fresh.create, props: { text: editor.value || ' ' } });
    else g.preview('text.set', { id, text: editor.value || ' ' });
  });
  app.endTextEdit = (commit = true) => {
    const id = state.editing;
    if (!id) return;
    state.editing = null;
    editor.hidden = true;
    const g = editBase.g || app.gesture();
    const text = editor.value;
    if (editBase.fresh) {
      if (commit && text.trim()) g.commit('node.create', { ...editBase.fresh.create, props: { text } });
      else g.cancel();
    } else if (commit && text !== editBase.text) g.commit('text.set', { id, text });
    else g.cancel();
    if (commit && !text.trim()) app.run('select.set', { ids: [] });
    editBase = null;
    wrap.focus({ preventScroll: true });
    notify('overlay');
  };
  editor.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); app.endTextEdit(true); }
  });
  editor.addEventListener('blur', () => { if (state.editing) app.endTextEdit(true); });

  return {
    requestRender, zoomAt, fitBox, toWorld, toScreen, local,
    center: () => ({ x: size.w / 2, y: size.h / 2 }),
    viewportWorld: () => ({ ...toWorld(0, 0), w: size.w / state.view.zoom, h: size.h / state.view.zoom }),
    lastPointer: () => last,
    el: canvas,
  };
}
