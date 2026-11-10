// Snapping a moving box to the edges and centres of other boxes, and measurement between boxes. Pure.
const xs = (b) => [b.x, b.x + b.w / 2, b.x + b.w];
const ys = (b) => [b.y, b.y + b.h / 2, b.y + b.h];

export function snapBox(box, targets, threshold) {
  let bestX = null, bestY = null;
  for (const t of targets) {
    for (const a of xs(box)) for (const b of xs(t)) {
      const d = b - a;
      if (Math.abs(d) <= threshold && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, at: b };
    }
    for (const a of ys(box)) for (const b of ys(t)) {
      const d = b - a;
      if (Math.abs(d) <= threshold && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, at: b };
    }
  }
  const dx = bestX ? bestX.d : 0, dy = bestY ? bestY.d : 0;
  const moved = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
  const guides = [];
  if (bestX) {
    const hits = targets.filter((t) => xs(t).some((v) => Math.abs(v - bestX.at) < 0.01));
    const all = [moved, ...hits];
    guides.push({ x1: bestX.at, x2: bestX.at, y1: Math.min(...all.map((b) => b.y)), y2: Math.max(...all.map((b) => b.y + b.h)) });
  }
  if (bestY) {
    const hits = targets.filter((t) => ys(t).some((v) => Math.abs(v - bestY.at) < 0.01));
    const all = [moved, ...hits];
    guides.push({ y1: bestY.at, y2: bestY.at, x1: Math.min(...all.map((b) => b.x)), x2: Math.max(...all.map((b) => b.x + b.w)) });
  }
  return { dx, dy, guides };
}

// Distances from box a to box b (Alt-hover measuring). Returns line segments with lengths.
export function measure(a, b) {
  const lines = [];
  const inside = a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
  const cy = a.y + a.h / 2, cx = a.x + a.w / 2;
  if (inside) {
    lines.push({ x1: b.x, y1: cy, x2: a.x, y2: cy }, { x1: a.x + a.w, y1: cy, x2: b.x + b.w, y2: cy });
    lines.push({ x1: cx, y1: b.y, x2: cx, y2: a.y }, { x1: cx, y1: a.y + a.h, x2: cx, y2: b.y + b.h });
  } else {
    if (b.x >= a.x + a.w) lines.push({ x1: a.x + a.w, y1: cy, x2: b.x, y2: cy });
    else if (b.x + b.w <= a.x) lines.push({ x1: b.x + b.w, y1: cy, x2: a.x, y2: cy });
    if (b.y >= a.y + a.h) lines.push({ x1: cx, y1: a.y + a.h, x2: cx, y2: b.y });
    else if (b.y + b.h <= a.y) lines.push({ x1: cx, y1: b.y + b.h, x2: cx, y2: a.y });
  }
  return lines.map((l) => ({ ...l, len: Math.round(Math.hypot(l.x2 - l.x1, l.y2 - l.y1) * 100) / 100 })).filter((l) => l.len > 0);
}
