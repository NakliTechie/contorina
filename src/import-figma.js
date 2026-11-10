// Best-effort import of Figma REST API JSON (GET /v1/files/:key, or /v1/files/:key/nodes), which is a
// public, documented format. Request geometry=paths so vectors carry their outlines. Image fills arrive
// without image bytes (the REST API serves them separately), so they import as a grey placeholder.
// Produces Figger layer specs with coordinates relative to each parent. Pure.

const hex2 = (v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0').toUpperCase();
const colorHex = (c, op = 1) => { const a = (c.a ?? 1) * op; return '#' + hex2(c.r) + hex2(c.g) + hex2(c.b) + (a < 1 ? hex2(a) : ''); };
const BLEND = { MULTIPLY: 'multiply', SCREEN: 'screen', OVERLAY: 'overlay', DARKEN: 'darken', LIGHTEN: 'lighten', COLOR_DODGE: 'color-dodge', COLOR_BURN: 'color-burn', HARD_LIGHT: 'hard-light', SOFT_LIGHT: 'soft-light', DIFFERENCE: 'difference', EXCLUSION: 'exclusion', HUE: 'hue', SATURATION: 'saturation', COLOR: 'color', LUMINOSITY: 'luminosity' };

function paintOf(p) {
  if (p.visible === false) return null;
  const op = p.opacity ?? 1;
  const stops = (p.gradientStops || []).map((s) => ({ pos: s.position, color: colorHex(s.color) }));
  const h = p.gradientHandlePositions || [];
  const base = { ...(op < 1 ? { opacity: op } : {}), ...(BLEND[p.blendMode] ? { blend: BLEND[p.blendMode] } : {}) };
  switch (p.type) {
    case 'SOLID': return op < 1 || base.blend ? { type: 'solid', color: colorHex(p.color), ...base } : colorHex(p.color);
    case 'GRADIENT_LINEAR': return { type: 'linear', angle: h.length >= 2 ? Math.round((Math.atan2(h[1].y - h[0].y, h[1].x - h[0].x) * 180) / Math.PI) : 90, stops, ...base };
    case 'GRADIENT_RADIAL': return { type: 'radial', cx: h[0]?.x ?? 0.5, cy: h[0]?.y ?? 0.5, r: h.length >= 2 ? Math.hypot(h[1].x - h[0].x, h[1].y - h[0].y) : 0.5, stops, ...base };
    case 'GRADIENT_ANGULAR': return { type: 'angular', cx: h[0]?.x ?? 0.5, cy: h[0]?.y ?? 0.5, angle: 0, stops, ...base };
    case 'GRADIENT_DIAMOND': return { type: 'diamond', cx: h[0]?.x ?? 0.5, cy: h[0]?.y ?? 0.5, r: 0.5, stops, ...base };
    case 'IMAGE': return { type: 'solid', color: '#C4C4C4', ...base };
    default: return null;
  }
}
const paintsOf = (list) => {
  const out = (list || []).map(paintOf).filter((p) => p != null);
  if (!out.length) return null;
  return out.length === 1 ? out[0] : out.map((p) => (typeof p === 'string' ? { type: 'solid', color: p } : p));
};

function effectsOf(list) {
  const out = [];
  for (const e of list || []) {
    if (e.visible === false) continue;
    if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') out.push({ type: e.type === 'DROP_SHADOW' ? 'drop' : 'inner', x: e.offset?.x || 0, y: e.offset?.y || 0, blur: e.radius || 0, spread: e.spread || 0, color: colorHex(e.color || { r: 0, g: 0, b: 0, a: 0.25 }) });
    if (e.type === 'LAYER_BLUR') out.push({ type: 'blur', radius: e.radius || 0 });
    if (e.type === 'BACKGROUND_BLUR') out.push({ type: 'bgblur', radius: e.radius || 0 });
  }
  return out.length ? out : undefined;
}

const SIZING = { FIXED: 'fixed', HUG: 'hug', FILL: 'fill' };
const JUSTIFY = { MIN: 'start', CENTER: 'center', MAX: 'end', SPACE_BETWEEN: 'between' };
const ALIGN = { MIN: 'start', CENTER: 'center', MAX: 'end', BASELINE: 'start' };
const CON_H = { LEFT: 'left', RIGHT: 'right', LEFT_RIGHT: 'leftright', CENTER: 'center', SCALE: 'scale' };
const CON_V = { TOP: 'top', BOTTOM: 'bottom', TOP_BOTTOM: 'topbottom', CENTER: 'center', SCALE: 'scale' };

// Geometry relative to the parent: relativeTransform when present, else bounding boxes.
function place(n, parentBox) {
  const size = n.size || { x: n.absoluteBoundingBox?.width || 0, y: n.absoluteBoundingBox?.height || 0 };
  const t = n.relativeTransform;
  if (t && parentBox !== null) {
    const a = t[0][0], b = t[1][0], tx = t[0][2], ty = t[1][2];
    const rot = (Math.atan2(b, a) * 180) / Math.PI;
    // Figma's transform maps the layer's top-left corner; Figger rotates about the centre.
    const r = (rot * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    const cx = tx + (c * size.x) / 2 - (s * size.y) / 2, cy = ty + (s * size.x) / 2 + (c * size.y) / 2;
    return { x: cx - size.x / 2, y: cy - size.y / 2, w: size.x, h: size.y, rotation: Math.round(rot * 100) / 100 };
  }
  const bb = n.absoluteBoundingBox || { x: 0, y: 0, width: size.x, height: size.y };
  return { x: bb.x - (parentBox ? parentBox.x : 0), y: bb.y - (parentBox ? parentBox.y : 0), w: bb.width, h: bb.height, rotation: 0 };
}

export function figmaToSpecs(json) {
  const pages = [];
  const doc = json.document || (json.nodes ? null : json);
  if (doc && doc.type === 'DOCUMENT') {
    for (const canvas of doc.children || []) pages.push({ name: canvas.name, layers: (canvas.children || []).map((c) => node(c, null)).filter(Boolean) });
  } else if (json.nodes) {
    pages.push({ name: json.name || 'Imported', layers: Object.values(json.nodes).map((v) => v && v.document && node(v.document, null)).filter(Boolean) });
  } else if (doc && doc.type === 'CANVAS') {
    pages.push({ name: doc.name, layers: (doc.children || []).map((c) => node(c, null)).filter(Boolean) });
  } else if (doc && doc.type) pages.push({ name: 'Imported', layers: [node(doc, null)].filter(Boolean) });
  else throw new Error('Not Figma REST JSON (expected document, nodes or a node)');
  return { name: json.name || 'Imported from Figma', pages };
}

function node(n, parent) {
  if (!n || !n.type) return null;
  const parentBox = parent ? parent.absoluteBoundingBox || { x: 0, y: 0 } : null;
  const g = place(n, parent ? parentBox : null);
  const common = {
    name: n.name, ...g,
    ...(n.visible === false ? { visible: false } : {}),
    ...(n.opacity != null && n.opacity < 1 ? { opacity: n.opacity } : {}),
    ...(BLEND[n.blendMode] ? { blendMode: BLEND[n.blendMode] } : {}),
    ...(effectsOf(n.effects) ? { effects: effectsOf(n.effects) } : {}),
    ...(n.constraints ? { constraints: { h: CON_H[n.constraints.horizontal] || 'left', v: CON_V[n.constraints.vertical] || 'top' } } : {}),
  };
  const fill = paintsOf(n.fills);
  const stroke = paintsOf(n.strokes);
  const strokeProps = stroke ? { stroke, strokeWidth: n.strokeWeight ?? 1, ...(n.strokeAlign === 'INSIDE' ? { strokeAlign: 'inside' } : n.strokeAlign === 'OUTSIDE' ? { strokeAlign: 'outside' } : {}), ...(n.strokeDashes ? { dash: n.strokeDashes } : {}) } : { stroke: null };
  const radius = n.rectangleCornerRadii ? n.rectangleCornerRadii.slice() : n.cornerRadius || 0;
  const sizing = (n.layoutSizingHorizontal || n.layoutSizingVertical) ? { h: SIZING[n.layoutSizingHorizontal] || 'fixed', v: SIZING[n.layoutSizingVertical] || 'fixed' } : undefined;
  switch (n.type) {
    case 'FRAME': case 'GROUP': case 'COMPONENT': case 'COMPONENT_SET': case 'INSTANCE': case 'SECTION': {
      const props = { ...common, fill: fill ?? null, ...strokeProps, radius, clip: n.type === 'GROUP' ? false : n.clipsContent !== false, ...(sizing ? { sizing } : {}) };
      if (n.layoutMode === 'HORIZONTAL' || n.layoutMode === 'VERTICAL') {
        props.layout = {
          mode: n.layoutMode === 'HORIZONTAL' ? 'row' : 'column', wrap: n.layoutWrap === 'WRAP', gap: n.itemSpacing || 0,
          pad: [n.paddingTop || 0, n.paddingRight || 0, n.paddingBottom || 0, n.paddingLeft || 0],
          align: ALIGN[n.counterAxisAlignItems] || 'start', justify: JUSTIFY[n.primaryAxisAlignItems] || 'start',
          ...(n.counterAxisSpacing != null ? { crossGap: n.counterAxisSpacing } : {}),
        };
        props.sizing = { h: SIZING[n.layoutSizingHorizontal] || (n.primaryAxisSizingMode === 'AUTO' && n.layoutMode === 'HORIZONTAL' ? 'hug' : 'fixed'), v: SIZING[n.layoutSizingVertical] || (n.primaryAxisSizingMode === 'AUTO' && n.layoutMode === 'VERTICAL' ? 'hug' : 'fixed') };
      }
      if (n.type === 'COMPONENT') props.component = true;
      if (n.type === 'COMPONENT_SET') { props.variantSet = true; props.stroke = props.stroke || '#9747FF'; props.dashed = true; }
      if (n.layoutPositioning === 'ABSOLUTE') props.absolute = true;
      return { type: 'frame', props, children: (n.children || []).map((c) => node(c, n)).filter(Boolean) };
    }
    case 'RECTANGLE': return { type: 'rect', props: { ...common, fill: fill ?? null, ...strokeProps, radius, ...(sizing ? { sizing } : {}) } };
    case 'ELLIPSE': return { type: 'ellipse', props: { ...common, fill: fill ?? null, ...strokeProps, ...(sizing ? { sizing } : {}) } };
    case 'LINE': return { type: 'line', props: { ...common, h: 0, fill: null, stroke: stroke || '#000000', strokeWidth: n.strokeWeight ?? 1 } };
    case 'TEXT': {
      const st = n.style || {};
      const auto = n.style?.textAutoResize === 'WIDTH_AND_HEIGHT' ? 'width' : n.style?.textAutoResize === 'HEIGHT' ? 'height' : 'fixed';
      return {
        type: 'text', props: {
          ...common, text: n.characters || '', fill: fill ?? '#000000', fontSize: st.fontSize || 16, fontFamily: st.fontFamily || 'Inter', fontWeight: st.fontWeight || 400,
          lineHeight: st.lineHeightPx && st.fontSize ? Math.round((st.lineHeightPx / st.fontSize) * 1000) / 1000 : 1.25,
          align: { CENTER: 'center', RIGHT: 'right' }[st.textAlignHorizontal] || 'left', autoSize: auto,
          ...(st.letterSpacing ? { letterSpacing: st.letterSpacing } : {}),
          ...(st.textDecoration === 'UNDERLINE' ? { decoration: 'underline' } : st.textDecoration === 'STRIKETHROUGH' ? { decoration: 'strike' } : {}),
          ...(st.textCase === 'UPPER' ? { textCase: 'upper' } : st.textCase === 'LOWER' ? { textCase: 'lower' } : {}),
          ...(sizing ? { sizing } : {}),
        },
      };
    }
    default: {
      // VECTOR, BOOLEAN_OPERATION, STAR, REGULAR_POLYGON: outlines from fillGeometry/strokeGeometry.
      const geo = (n.fillGeometry && n.fillGeometry.length ? n.fillGeometry : n.strokeGeometry) || [];
      if (!geo.length) return { type: 'rect', props: { ...common, fill: fill ?? '#D9D9D9', ...strokeProps } };
      // Geometry paths are in the layer's own units, so the layer box is the path's view box.
      const d = geo.map((x) => x.path).join(' ');
      const filled = !!(n.fillGeometry && n.fillGeometry.length);
      const paint = filled ? { fill: fill ?? null, ...strokeProps } : { fill: stroke || '#000000', stroke: null }; // stroke outlines are filled shapes
      return { type: 'vector', props: { ...common, d, vw: g.w || 1, vh: g.h || 1, ...paint, fillRule: geo[0].windingRule === 'EVENODD' ? 'evenodd' : 'nonzero' } };
    }
  }
}
