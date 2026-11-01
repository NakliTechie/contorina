# Agent notes for Figger

Tier: **Tool** (one HTML file, one human role, no server). Re-tier to Product in writing if it gains live collaboration, a second role or a server.
Direction: **Dense** (a workbench for hours of work). UI is light by default and does not follow the system dark mode.

## Rules
- One page, native ES modules in `src/`, assembled into a single `figger.html` by a build script (the Draft pattern). No CDN at runtime. Vendored libraries are pinned with licences.
- Data stays on the user's disk. No account, no telemetry.
- Every UI action is a command in one registry (id, parameter schema, undo flag). Menus, keys, the `window.figger` agent face and any MCP bridge call the same commands.
- Plan lives in `plan/` (a symlink outside git). Read `plan/pending.md` first.
- FigCraft is the reference system. Port its ideas with attribution; do not copy Figma's proprietary assets.

## Verification budget
- No tests, evals or diagnostics between implementation steps. Build the whole batch, then check once at the batch boundary. A batch is one capability family, about a day of work, and closes early past that.
- Run only the checks that cover the changed batch. Never repeat an unchanged suite.
- All generated test data goes to one temp directory (`tmp/`), capped at 5,000 files and 500 MB, preferring one aggregate file to many, deleted on success, failure and interrupt.
- One diagnostic batch per failure. No new diagnostic script without a written hypothesis.
- No new process tooling (receipts, provenance, locks) until a feature it gates exists.
- Log anything over 50 MB or 1,000 files when it is created, so `/tidy-nt` can clear it.
