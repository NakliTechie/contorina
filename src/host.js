// NakliOS host integration (the common rail). Figger's registry is the one source of commands:
// this module publishes it through naklios.experimental_commands.register, maps the host theme onto
// Figger's CSS tokens, and reports title and readiness. Standalone, every call is a no-op.
import { all, inputSchema } from './registry.js';

const nak = () => globalThis.naklios;
export const hosted = () => !!(nak() && nak().capabilities.hosted);

// Commands an agent can run through the rail. Person-only acts (file pickers) and pure view commands
// that only make sense with a person watching are left out by name, not by omission.
export function railCommands(run) {
  return all()
    .filter((c) => !c.personOnly && !c.noRail)
    .map((c) => ({
      name: c.id,
      description: c.description || c.label,
      input: inputSchema(c),
      scope: c.scope || (c.doc ? 'write' : 'read'),
      handler: async (args) => {
        const v = await run(c.id, args || {}, { source: 'agent' });
        return v === undefined ? { ok: true } : v;
      },
    }));
}

export function connectHost({ run, onTheme, onCapabilities, title }) {
  const n = nak();
  if (!n) return;
  try {
    n.theme.onChange((t) => onTheme(t));
    n.onCapabilitiesChange(() => onCapabilities());
    if (n.experimental_commands) n.experimental_commands.register(railCommands(run)).catch?.(() => {});
    n.ready();
    n.theme.request?.();
    n.requestCapabilities?.();
    if (title) n.title(title);
  } catch (e) {
    console.warn('[figger] NakliOS wiring failed', e);
  }
}

// Map the host theme onto Figger's chrome tokens. The canvas keeps its neutral grey so colours read true.
export function applyHostTheme(t) {
  if (!t || !t.colors) return;
  const c = t.colors, r = document.documentElement.style;
  if (c.PANEL) r.setProperty('--panel', c.PANEL);
  if (c.BODY) r.setProperty('--bg', c.BODY);
  if (c.INK) r.setProperty('--ink', c.INK);
  if (c.ROW) r.setProperty('--row', c.ROW);
  if (c.ACT) r.setProperty('--accent', c.ACT);
  document.documentElement.dataset.mood = t.mood || '';
}
