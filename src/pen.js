// Vector tools on the canvas: pen (click for corners, drag for curves, click the first point to close),
// pencil (freehand, simplified), and path edit mode (drag anchors and handles; Alt breaks the handle
// pair; Delete removes the selected anchor; double-click a segment end to add a point after it).
// Every change goes through vector.create or vector.setPath, previewed during a drag, committed once.
import { state, notify } from './store.js';
import { worldMatrix, inv, apply, round2, IDENT } from './geom.js';
import { frameAt } from './hit.js';
import { parsePath, toAnchors, fromAnchors, simplify, scaleD, polygonD, starD } from './vector.js';

const ANCHOR = 4;
const SEL = '#0D99FF';

export function createVectorTools(canvas, app) {
  let pen = null;      // { parent, anchors: [{x,y,in,out}], id, g, dragging }
  let pencil = null;   // { parent, pts, id }
  let edit = null;     // { id, paths, sel: {p, i} | null, drag }

  const parentLocal = (pid, w) => (pid ? apply(inv(worldMatrix(state.doc, pid)), w) : w);
  const parentWorld = (pid) => (pid ? worldMatrix(state.doc, pid) : IDENT);
  const dOf = (anchors, closed) => fromAnchors([{ closed, nodes: anchors }]);

  // ---- pen ------------------------------------------------------------------------------------------
  function penPreview(closed = false) {
    if (!pen.anchors.length) return;
    const d = dOf(pen.anchors, closed);
    pen.g.preview('vector.create', { d, parent: pen.parent, id: pen.id, props: pen.props(closed) });
  }
  function penFinish(closed) {
    if (!pen) return;
    const p = pen;
    pen = null;
    if (p.anchors.length < 2) { p.g.cancel(); notify('overlay'); return; }
    p.g.commit('vector.create', { d: dOf(p.anchors, closed), parent: p.parent, id: p.id, props: p.props(closed) });
    app.run('tool.select');
  }

  // ---- path edit ------------------------------------------------------------------------------------
  // Anchors are kept in the layer's own units (0..w, 0..h).
  function loadEdit(id) {
    const n = state.doc.nodes[id];
    if (!n) return null;
    let d;
    if (n.type === 'vector') d = scaleD(n.d, n.w / (n.vw || n.w || 1), n.h / (n.vh || n.h || 1));
    else d = scaleD(n.type === 'polygon' ? polygonD(n.sides) : starD(n.points, n.inner), n.w, n.h);
    return { id, paths: toAnchors(parsePath(d)), sel: null, drag: null };
  }
  function toScreenLocal(id, toScreen, pt) { return toScreen(apply(worldMatrix(state.doc, id), { x: pt[0], y: pt[1] })); }
  // Anchors win over handles, so a handle lying on its own anchor never hides the anchor.
  function hitAnchor(s, toScreen) {
    if (!edit) return null;
    const near = (pt, r) => { const q = toScreenLocal(edit.id, toScreen, pt); return Math.hypot(q.x - s.x, q.y - s.y) <= r; };
    for (let p = 0; p < edit.paths.length; p++) edit.paths[p].nodes.forEach((a, i) => { if (!hit && near([a.x, a.y], ANCHOR + 3)) hit = { p, i, kind: 'anchor' }; });
    if (hit) { const h = hit; hit = null; return h; }
    for (let p = 0; p < edit.paths.length; p++) {
      for (let i = 0; i < edit.paths[p].nodes.length; i++) {
        const a = edit.paths[p].nodes[i];
        for (const kind of ['in', 'out']) if (a[kind] && near(a[kind], ANCHOR + 2)) return { p, i, kind };
      }
    }
    return null;
  }
  let hit = null;
  function editPreview(commit) {
    const d = fromAnchors(edit.paths);
    if (commit) edit.drag.g.commit('vector.setPath', { id: edit.id, d });
    else edit.drag.g.preview('vector.setPath', { id: edit.id, d });
  }
  function exitEdit() { edit = null; notify('overlay'); }

  const api = {
    get active() { return !!(pen || pencil || edit); },
    editPath(id) {
      const n = state.doc.nodes[id];
      if (!n || n.src) return;
      if (n.type !== 'vector') {
        // Polygons and stars become vectors on first edit.
        app.run('node.flatten', { ids: [id] });
        id = state.selection[0];
      }
      edit = loadEdit(id);
      notify('overlay');
    },
    exit() { if (pen) penFinish(false); if (edit) exitEdit(); },
    deleteSelected() {
      if (!edit || !edit.sel) return false;
      const path = edit.paths[edit.sel.p];
      path.nodes.splice(edit.sel.i, 1);
      if (path.nodes.length < 2) edit.paths.splice(edit.sel.p, 1);
      edit.sel = null;
      if (!edit.paths.length) { app.run('edit.delete', { ids: [edit.id] }); exitEdit(); return true; }
      app.run('vector.setPath', { id: edit.id, d: fromAnchors(edit.paths) });
      edit = loadEdit(edit.id);
      notify('overlay');
      return true;
    },
    down(e, s, w) {
      if (state.tool === 'pen') {
        if (!pen) {
          const parent = frameAt(state.doc, w, null);
          pen = {
            parent, anchors: [], id: 'n' + Math.random().toString(36).slice(2, 10), g: app.gesture(),
            props: (closed) => ({ fill: closed ? '#D9D9D9' : null, stroke: '#1E1E1E', strokeWidth: closed ? 0 : 2 }),
          };
        }
        const p = parentLocal(pen.parent, w);
        // Clicking the first anchor closes the path.
        if (pen.anchors.length > 2) {
          const f = pen.anchors[0];
          const q = app.canvas.toScreen(apply(parentWorld(pen.parent), f));
          if (Math.hypot(q.x - s.x, q.y - s.y) < 8) { penFinish(true); return true; }
        }
        pen.anchors.push({ x: round2(p.x), y: round2(p.y), in: null, out: null });
        pen.dragging = true;
        penPreview();
        notify('overlay');
        return true;
      }
      if (state.tool === 'pencil') {
        const parent = frameAt(state.doc, w, null);
        pencil = { parent, pts: [[w.x, w.y]], id: 'n' + Math.random().toString(36).slice(2, 10) };
        return true;
      }
      if (edit) {
        const h = hitAnchor(s, app.canvas.toScreen);
        if (!h) { exitEdit(); return false; }
        edit.sel = { p: h.p, i: h.i };
        const a = edit.paths[h.p].nodes[h.i];
        // Convert every pointer position with the matrix at mouse-down: previews refit the layer box,
        // and converting with the moving box would lose part of the motion.
        const toLocal = inv(worldMatrix(state.doc, edit.id));
        edit.drag = { ...h, toLocal, start: apply(toLocal, w), orig: structuredClone(a), g: app.gesture(), moved: false };
        notify('overlay');
        return true;
      }
      return false;
    },
    move(e, s, w, dragging) {
      if (pen && pen.dragging && dragging) {
        const a = pen.anchors[pen.anchors.length - 1];
        const p = parentLocal(pen.parent, w);
        if (Math.hypot(p.x - a.x, p.y - a.y) * state.view.zoom > 3) {
          a.out = [round2(p.x), round2(p.y)];
          a.in = [round2(2 * a.x - p.x), round2(2 * a.y - p.y)];
          penPreview();
        }
        return true;
      }
      if (pencil && dragging) {
        pencil.pts.push([w.x, w.y]);
        state.guides = [];
        pencil.trail = pencil.pts;
        notify('overlay');
        return true;
      }
      if (edit && edit.drag && dragging) {
        const d = edit.drag;
        const q = apply(d.toLocal, w);
        const dx = q.x - d.start.x, dy = q.y - d.start.y;
        if (!d.moved && Math.hypot(dx, dy) * state.view.zoom < 2) return true;
        d.moved = true;
        const a = edit.paths[d.p].nodes[d.i];
        const o = d.orig;
        if (d.kind === 'anchor') {
          a.x = o.x + dx; a.y = o.y + dy;
          a.in = o.in && [o.in[0] + dx, o.in[1] + dy];
          a.out = o.out && [o.out[0] + dx, o.out[1] + dy];
        } else {
          a[d.kind] = [o[d.kind][0] + dx, o[d.kind][1] + dy];
          const other = d.kind === 'in' ? 'out' : 'in';
          if (!e.altKey && o[other]) a[other] = [2 * a.x - a[d.kind][0], 2 * a.y - a[d.kind][1]];
        }
        editPreview(false);
        return true;
      }
      if (pen) { pen.hover = parentLocal(pen.parent, w); notify('overlay'); }
      return false;
    },
    up() {
      if (pen) { pen.dragging = false; return; }
      if (pencil) {
        const p = pencil;
        pencil = null;
        const eps = 1.5 / state.view.zoom;
        const pts = simplify(p.pts, eps).map(([x, y]) => { const q = parentLocal(p.parent, { x, y }); return [round2(q.x), round2(q.y)]; });
        if (pts.length >= 2) app.run('vector.create', { d: 'M' + pts.map((q) => q.join(' ')).join(' L'), parent: p.parent, id: p.id, props: { fill: null, stroke: '#1E1E1E', strokeWidth: 2, strokeJoin: 'round', strokeCap: 'round' } });
        notify('overlay');
        return;
      }
      if (edit && edit.drag) {
        const d = edit.drag;
        edit.drag = null;
        if (d.moved) { editPreview_commit(d); edit = loadEdit(edit.id); }
        else d.g.cancel();
        notify('overlay');
      }
    },
    dblclick(e, s, w) {
      if (pen) { penFinish(false); return true; }
      if (edit) {
        // Double-click an anchor: toggle it between a corner and a smooth point.
        const h = hitAnchor(s, app.canvas.toScreen);
        if (h && h.kind === 'anchor') {
          const path = edit.paths[h.p], a = path.nodes[h.i];
          if (a.in || a.out) { a.in = null; a.out = null; }
          else {
            const prev = path.nodes[(h.i - 1 + path.nodes.length) % path.nodes.length], next = path.nodes[(h.i + 1) % path.nodes.length];
            const tx = (next.x - prev.x) / 4, ty = (next.y - prev.y) / 4;
            a.in = [a.x - tx, a.y - ty]; a.out = [a.x + tx, a.y + ty];
          }
          app.run('vector.setPath', { id: edit.id, d: fromAnchors(edit.paths) });
          edit = loadEdit(edit.id);
          return true;
        }
        if (!h) {
          // Add a point on the path: insert after the nearest anchor at the clicked spot.
          const q = apply(inv(worldMatrix(state.doc, edit.id)), w);
          let best = null;
          edit.paths.forEach((path, p) => path.nodes.forEach((a, i) => {
            const b = path.nodes[(i + 1) % path.nodes.length];
            if (!path.closed && i === path.nodes.length - 1) return;
            const t = Math.max(0, Math.min(1, ((q.x - a.x) * (b.x - a.x) + (q.y - a.y) * (b.y - a.y)) / (((b.x - a.x) ** 2 + (b.y - a.y) ** 2) || 1)));
            const dd = Math.hypot(a.x + t * (b.x - a.x) - q.x, a.y + t * (b.y - a.y) - q.y);
            if (!best || dd < best.dd) best = { p, i, dd };
          }));
          if (best && best.dd * state.view.zoom < 12) {
            edit.paths[best.p].nodes.splice(best.i + 1, 0, { x: round2(q.x), y: round2(q.y), in: null, out: null });
            app.run('vector.setPath', { id: edit.id, d: fromAnchors(edit.paths) });
            edit = loadEdit(edit.id);
            return true;
          }
        }
      }
      return false;
    },
    overlay(ctx, toScreen) {
      ctx.save();
      ctx.lineWidth = 1;
      if (pen) {
        const m = parentWorld(pen.parent);
        const pts = pen.anchors.map((a) => toScreen(apply(m, a)));
        if (pen.hover && pts.length && !pen.dragging) {
          const h = toScreen(apply(m, pen.hover));
          ctx.strokeStyle = SEL; ctx.setLineDash([4, 3]);
          ctx.beginPath(); ctx.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y); ctx.lineTo(h.x, h.y); ctx.stroke();
          ctx.setLineDash([]);
        }
        pen.anchors.forEach((a, i) => {
          for (const k of ['in', 'out']) if (a[k]) { const q = toScreen(apply(m, { x: a[k][0], y: a[k][1] })); line(ctx, pts[i], q); dot(ctx, q, 3, false); }
          dot(ctx, pts[i], ANCHOR, i === 0);
        });
      }
      if (pencil && pencil.trail) {
        ctx.strokeStyle = SEL;
        ctx.beginPath();
        pencil.trail.forEach(([x, y], i) => { const q = toScreen({ x, y }); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
        ctx.stroke();
      }
      if (edit && state.doc.nodes[edit.id]) {
        const live = edit.drag ? edit : loadEdit(edit.id) || edit;
        for (const [p, path] of live.paths.entries()) path.nodes.forEach((a, i) => {
          const q = toScreenLocal(edit.id, toScreen, [a.x, a.y]);
          for (const k of ['in', 'out']) if (a[k]) { const hq = toScreenLocal(edit.id, toScreen, a[k]); line(ctx, q, hq); dot(ctx, hq, 3, false); }
          dot(ctx, q, ANCHOR, edit.sel && edit.sel.p === p && edit.sel.i === i);
        });
      }
      ctx.restore();
    },
  };
  function editPreview_commit(d) { edit.drag = d; editPreview(true); edit.drag = null; }
  return api;
}

function dot(ctx, p, r, filled) {
  ctx.beginPath();
  ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
  ctx.fillStyle = filled ? SEL : '#fff';
  ctx.strokeStyle = SEL;
  ctx.fill();
  ctx.stroke();
}
function line(ctx, a, b) {
  ctx.strokeStyle = SEL;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
}
