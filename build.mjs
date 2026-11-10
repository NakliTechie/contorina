#!/usr/bin/env node
// Assemble index.html: src/shell.html (with the vendored NakliOS SDK between its markers) plus
// src/style.css and the src/ ES modules bundled by esbuild into one inline script. Nothing loads
// from the network at run time. Also writes commands.json, the NakliOS manifest of Figger's commands.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const out = await build({
  entryPoints: ['src/main.js'], bundle: true, format: 'iife', write: false, target: 'es2022',
  minify: false, legalComments: 'inline', charset: 'utf8',
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync('src/style.css', 'utf8');
const shell = readFileSync('src/shell.html', 'utf8');
if (!shell.includes('/*APP-STYLE*/') || !shell.includes('/*APP-SCRIPT*/')) throw new Error('shell.html lacks its placeholders');
const html = shell.replace('/*APP-STYLE*/', () => css).replace('/*APP-SCRIPT*/', () => js);
writeFileSync('index.html', html);

// commands.json: what NakliOS lists while Figger is closed (common rail step 2). Generated from the
// registry so the manifest cannot drift from the code.
globalThis.navigator ??= { platform: 'build' };
await import('./src/commands.js');
await import('./src/commands-vector.js');
await import('./src/commands-layer4.js');
await import('./src/commands-layer5.js');
await import('./src/commands-layer6.js');
await import('./src/main.js'); // registers the app-shell commands too; it starts no UI without a DOM
// The app shell registers view, selection and file commands too; import main's registrations by
// loading the same modules the page loads, minus the DOM. The rail entries come from host.js, so
// commands.json and the live registration cannot differ.
const { railEntries, RAIL_LIMIT } = await import('./src/host.js');
const entries = railEntries();
if (entries.length > RAIL_LIMIT) throw new Error(`The NakliOS rail takes at most ${RAIL_LIMIT} commands; Figger would register ${entries.length}`);
const commands = entries.map(({ name, description, scope, input }) => ({ name, description, scope, input }));
const manifest = {
  accepts: [{ action: 'open', label: 'Open in Figger', extensions: ['.figger.json'] }],
  commands,
};
writeFileSync('commands.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(`index.html ${(html.length / 1024).toFixed(1)} KB · commands.json ${commands.length} rail entries`);
