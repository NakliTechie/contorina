// Present mode: plays the prototype. A top-level frame fills the window; layers with a `proto`
// interaction respond to click, hover or press; overlays draw over the current frame; Escape exits.
import { drawNodes } from './render.js';
import { hitChain } from './hit.js';
import { worldMatrix, apply, inv } from './geom.js';
import { h } from './ui/dom.js';

export function startPresentation(doc, startId, { onExit } = {}) {
  const frames = doc.children.filter((id) => doc.nodes[id] && doc.nodes[id].type === 'frame' && doc.nodes[id].visible !== false);
  let current = startId && doc.nodes[startId] && !doc.nodes[startId].parent ? startId : doc.flowStart && doc.nodes[doc.flowStart] ? doc.flowStart : frames[0];
  if (!current) throw new Error('Add a top-level frame to present');
  const history = [];
  let overlay = null, anim = null, hoverTarget = null;
  const canvas = h('canvas');
  const caption = h('div.present-caption');
  const root = h('div.present', { tabindex: '0', role: 'dialog', 'aria-label': 'Prototype presentation' }, canvas, caption,
    h('button.present-close', { type: 'button', title: 'Exit (Escape)', on: { click: () => exit() } }, '×'));
  document.body.appendChild(root);
  root.focus();
  const ctx = canvas.getContext('2d');

  function fit(id) {
    const n = doc.nodes[id];
    const W = root.clientWidth, H = root.clientHeight;
    const k = Math.min(W / n.w, H / n.h, 4) * 0.94;
    return { k, x: (W - n.w * k) / 2, y: (H - n.h * k) / 2 };
  }
  function paintFrame(id, alpha = 1, dx = 0) {
    const n = doc.nodes[id];
    const v = fit(id);
    const dpr = devicePixelRatio || 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    // Draw the frame at its own origin: undo its canvas position.
    ctx.setTransform(dpr * v.k, 0, 0, dpr * v.k, dpr * (v.x + dx), dpr * v.y);
    drawNodes(ctx, doc, [id], {}, [1, 0, 0, 1, -n.x, -n.y], 1);
    ctx.restore();
  }
  function render() {
    const dpr = devicePixelRatio || 1;
    canvas.width = root.clientWidth * dpr;
    canvas.height = root.clientHeight * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1E1E1E';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (anim) {
      const t = Math.min(1, (performance.now() - anim.t0) / anim.dur);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const W = root.clientWidth;
      if (anim.kind === 'dissolve') { paintFrame(anim.from, 1); paintFrame(anim.to, e); }
      else if (anim.kind.startsWith('slide')) {
        const dir = anim.kind === 'slide-right' ? -1 : 1;
        paintFrame(anim.from, 1, -dir * W * e);
        paintFrame(anim.to, 1, dir * W * (1 - e));
      } else paintFrame(anim.to);
      if (t < 1) requestAnimationFrame(render); else anim = null;
    } else paintFrame(current);
    if (overlay) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
      paintFrame(overlay);
    }
    caption.textContent = `${doc.nodes[current].name}${overlay ? ' · ' + doc.nodes[overlay].name : ''} · ${frames.indexOf(current) + 1}/${frames.length} · Esc exits, ← back`;
  }
  function go(target, transition = 'instant', duration = 300) {
    if (!doc.nodes[target] || target === current) return;
    history.push(current);
    const from = current;
    current = target;
    overlay = null;
    anim = transition === 'instant' ? null : { kind: transition, from, to: target, t0: performance.now(), dur: Math.max(16, duration) };
    render();
  }
  function back() {
    if (overlay) { overlay = null; render(); return; }
    const prev = history.pop();
    if (prev) { const from = current; current = prev; anim = { kind: 'slide-right', from, to: prev, t0: performance.now(), dur: 250 }; render(); }
  }
  // Which layer (with an interaction) is under a window point, in the visible frame.
  function protoAt(clientX, clientY, trigger) {
    const id = overlay || current;
    const n = doc.nodes[id];
    const v = fit(id);
    const r = root.getBoundingClientRect();
    const p = { x: (clientX - r.left - v.x) / v.k + n.x, y: (clientY - r.top - v.y) / v.k + n.y };
    const chain = hitChain({ ...doc, children: [id] }, p, 2);
    for (let i = chain.length - 1; i >= 0; i--) {
      const pr = doc.nodes[chain[i]].proto;
      if (pr && (pr.trigger || 'click') === trigger) return pr;
    }
    if (overlay && !chain.length && trigger === 'click') return { action: 'close' };
    return null;
  }
  function run(pr) {
    if (!pr) return;
    if (pr.action === 'navigate') go(pr.target, pr.transition, pr.duration);
    else if (pr.action === 'overlay') { overlay = pr.target; render(); }
    else if (pr.action === 'back') back();
    else if (pr.action === 'close') { overlay = null; render(); }
    else if (pr.action === 'url' && /^https?:\/\//.test(pr.url)) window.open(pr.url, '_blank', 'noopener');
  }
  root.addEventListener('click', (e) => { if (!e.target.closest('button')) run(protoAt(e.clientX, e.clientY, 'click')); });
  root.addEventListener('pointerdown', (e) => run(protoAt(e.clientX, e.clientY, 'press')));
  root.addEventListener('pointermove', (e) => {
    const pr = protoAt(e.clientX, e.clientY, 'hover');
    root.style.cursor = pr || protoAt(e.clientX, e.clientY, 'click') ? 'pointer' : 'default';
    if (pr && pr !== hoverTarget) { hoverTarget = pr; run(pr); } else if (!pr) hoverTarget = null;
  });
  const keys = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') exit();
    else if (e.key === 'ArrowLeft' || e.key === 'Backspace') back();
    else if (e.key === 'ArrowRight' || e.key === ' ') { const i = frames.indexOf(current); if (i < frames.length - 1) go(frames[i + 1], 'slide-left'); }
  };
  root.addEventListener('keydown', keys);
  const ro = new ResizeObserver(render);
  ro.observe(root);
  function exit() { ro.disconnect(); root.remove(); onExit && onExit(); }
  render();
  return { go, back, exit, get current() { return current; }, get overlay() { return overlay; } };
}
