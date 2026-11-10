// Shared styles: colour styles ({type:'color', name, value}) and text styles ({type:'text', name, fontSize, ...}).
// Nodes refer to them by id (fillStyle, strokeStyle, textStyle); renderers and layout resolve the reference.

export const TEXT_KEYS = ['fontSize', 'fontFamily', 'fontWeight', 'lineHeight'];

export function fillOf(n, styles) {
  const s = n.fillStyle && styles[n.fillStyle];
  return s ? s.value : n.fill;
}
export function strokeOf(n, styles) {
  const s = n.strokeStyle && styles[n.strokeStyle];
  return s ? s.value : n.stroke;
}
export function textOf(n, styles) {
  const s = n.textStyle && styles[n.textStyle];
  if (!s) return n;
  const out = { ...n };
  for (const k of TEXT_KEYS) if (s[k] != null) out[k] = s[k];
  return out;
}

export const FONT_STACKS = {
  Inter: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  'System UI': "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  Serif: "Georgia, 'Times New Roman', serif",
  Mono: "ui-monospace, Menlo, Consolas, monospace",
  Devanagari: "'Noto Sans Devanagari', 'Kohinoor Devanagari', 'Nirmala UI', sans-serif",
};
export const fontStack = (family) => FONT_STACKS[family] || `${JSON.stringify(family)}, system-ui, sans-serif`;
export const fontString = (t) => `${t.fontWeight || 400} ${t.fontSize}px ${fontStack(t.fontFamily)}`;
