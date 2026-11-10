#!/usr/bin/env node
// Draws marketing/spike-chart.svg from spike/result-*.json (newest). Rerun after a new spike run.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const file = readdirSync('spike').filter((f) => /^result-.*\.json$/.test(f)).sort().pop();
const r = JSON.parse(readFileSync('spike/' + file, 'utf8'));
const bars = [
  ['Full render, 10k layers', r.fullRenderMedianMs],
  ['Move one layer, full redraw', r.moveOneLayerFullRedrawMedianMs],
  ['Move one layer, dirty rectangle', r.moveOneLayerDirtyRectMedianMs],
  ['Edit one layer (document copy)', r.editOneLayerTxMedianMs],
];
const W = 720, H = 60 + bars.length * 44, left = 250, max = Math.max(...bars.map((b) => b[1])) * 1.15;
const x = (v) => left + ((W - left - 40) * v) / max;
const budget = x(16.7);
let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif" font-size="13">\n<rect width="${W}" height="${H}" fill="#fff"/>\n`;
s += `<text x="16" y="24" font-weight="600" fill="#1e1e1e">Canvas2D renderer spike, median of ${r.runs} runs (ms, lower is better)</text>\n`;
bars.forEach(([label, v], i) => {
  const y = 44 + i * 44;
  s += `<text x="16" y="${y + 18}" fill="#1e1e1e">${label}</text><rect x="${left}" y="${y + 4}" width="${x(v) - left}" height="20" rx="3" fill="#0D99FF"/><text x="${x(v) + 6}" y="${y + 19}" fill="#1e1e1e">${v}</text>\n`;
});
s += `<line x1="${budget}" y1="40" x2="${budget}" y2="${H - 10}" stroke="#F24822" stroke-dasharray="4 3"/><text x="${budget + 4}" y="${H - 12}" fill="#F24822" font-size="11">16.7 ms (one frame at 60 Hz)</text>\n</svg>\n`;
writeFileSync('marketing/spike-chart.svg', s);
console.log('marketing/spike-chart.svg from', file);
