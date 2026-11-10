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
const { all, inputSchema } = await import('./src/registry.js');
const commands = all().map((c) => ({ name: c.id, description: c.description || c.label, scope: c.scope, input: inputSchema(c) }));
const manifest = {
  accepts: [{ action: 'open', label: 'Open in Figger', extensions: ['.figger.json'] }],
  commands,
  _note: 'Document commands only; view, selection and file commands register at run time from the same registry.',
};
writeFileSync('commands.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(`index.html ${(html.length / 1024).toFixed(1)} KB · commands.json ${commands.length} document commands`);
