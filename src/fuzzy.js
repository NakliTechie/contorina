// Command-palette matching: every query word must match a distinct label word by prefix,
// by substring, or (for words of 3+ letters) with one typo. "ad cu" finds "Add Cube".
function oneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export function score(query, label) {
  const q = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!q.length) return 1;
  const words = label.toLowerCase().split(/[\s\-_/.:()]+/).filter(Boolean);
  const used = new Set();
  let s = 0;
  for (const t of q) {
    let best = 0, bi = -1;
    words.forEach((w, i) => {
      if (used.has(i)) return;
      // A typo can drop or add a letter, so compare with prefixes one shorter, equal and one longer.
      const typo = t.length >= 3 && [t.length - 1, t.length, t.length + 1].some((k) => oneEdit(t, w.slice(0, k)));
      const v = w.startsWith(t) ? 3 : w.includes(t) ? 2 : typo ? 1 : 0;
      if (v > best) { best = v; bi = i; }
    });
    if (!best) return 0;
    used.add(bi);
    s += best;
  }
  return s;
}

export function rank(query, items, labelOf, recent = []) {
  const out = [];
  for (const it of items) {
    const s = score(query, labelOf(it));
    if (!s) continue;
    const r = recent.indexOf(it.id);
    out.push({ it, s: s + (r >= 0 ? 2 - r / Math.max(1, recent.length) : 0) });
  }
  return out.sort((a, b) => b.s - a.s).map((x) => x.it);
}
