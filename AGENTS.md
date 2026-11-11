# Agent notes for Contorina

Tier: **Tool** (one HTML file, one human role, no server). Re-tier to Product in writing if it gains live collaboration, a second role or a server.
Direction: **Dense** (a workbench for hours of work). UI is light by default and does not follow the system dark mode.

## Rules
- One page, native ES modules in `src/`, assembled into a single `index.html` by `node build.mjs` (esbuild, dev-only). No CDN at runtime. Vendored libraries are pinned with licences. Commit `index.html` and `commands.json` with the sources; CI fails when they differ from a fresh build.
- Contorina runs in NakliOS (set by Chirag 2026-11-11): the SDK is inlined in `src/shell.html` between the `naklios-sdk` markers (refresh with `node scripts/vendor-naklios-sdk.mjs --file src/shell.html`, never by hand); storage goes through `src/storage.js` (naklios.fs when hosted, File System Access standalone); the registry registers on the common rail in `src/host.js`. Standalone URL: contorina.naklitechie.com (assets Worker, `wrangler.jsonc`). Contract: `~/Code/naklios-universe/naklios/docs/app-contract.md`.
- Data stays on the user's disk. No account, no telemetry.
- Every UI action is a command in one registry (`src/registry.js`: id, params schema, scope read/write/destructive, personOnly). Menus, keys, the palette, the `window.contorina` agent face and the NakliOS rail call the same commands. Document commands live in `src/commands.js` and stay DOM-free so Node tests run them.
- Plan lives in `plan/` (a symlink outside git). Read `plan/pending.md` first.
- FigCraft is the reference system. Port its ideas with attribution; do not copy Figma's proprietary assets.

## Verification budget
- No tests, evals or diagnostics between implementation steps. Build the whole batch, then check once at the batch boundary. A batch is one capability family, about a day of work, and closes early past that.
- Run only the checks that cover the changed batch. Never repeat an unchanged suite.
- All generated test data goes to one temp directory (`tmp/`), capped at 5,000 files and 500 MB, preferring one aggregate file to many, deleted on success, failure and interrupt.
- One diagnostic batch per failure. No new diagnostic script without a written hypothesis.
- No new process tooling (receipts, provenance, locks) until a feature it gates exists.
- Log anything over 50 MB or 1,000 files when it is created, so `/tidy-nt` can clear it.
