// NakliOS host integration (the common rail). Figger's registry is the one source of commands:
// this module publishes it through naklios.experimental_commands.register, maps the host theme onto
// Figger's CSS tokens, and reports title and readiness. Standalone, every call is a no-op.
import { all, inputSchema } from './registry.js';

const nak = () => globalThis.naklios;
export const hosted = () => !!(nak() && nak().capabilities.hosted);

// The NakliOS host accepts at most 64 commands per app (sys/host/catalog.mjs MAX_COMMANDS), with names
// matching /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*){0,3}$/. Figger's registry has about 100, so the rail
// carries one entry per area and scope: "<area>.<scope>" with input { command, params }. Grouping by
// scope keeps the host's grant checks exact (write asks once, destructive goes to review). Person-only
// acts (file pickers) and view-only tools stay off the rail by name. "help.read" returns each command's
// own parameter schema, so an agent can look one up before calling it.
export const RAIL_LIMIT = 64;
const slug = (g) => String(g).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'misc';

export function railEntries() {
  const groups = new Map();
  for (const c of all()) {
    if (c.personOnly || c.noRail) continue;
    const scope = c.scope || (c.doc ? 'write' : 'read');
    const name = `${slug(c.group)}.${scope}`;
    if (!groups.has(name)) groups.set(name, { name, group: c.group, scope, list: [] });
    groups.get(name).list.push(c);
  }
  const entries = [...groups.values()].map((g) => ({
    name: g.name,
    scope: g.scope,
    description: `Figger ${g.group.toLowerCase()} (${g.scope}). Pass command and params; commands: ${g.list.map((c) => `${c.id} (${c.label})`).join(', ')}. Call help.read for a command's parameters.`,
    input: {
      type: 'object',
      properties: {
        command: { type: 'string', enum: g.list.map((c) => c.id), description: 'Which Figger command to run' },
        params: { type: 'object', description: 'The command\'s own parameters (see help.read)' },
      },
      required: ['command'],
    },
    commands: g.list.map((c) => c.id),
  }));
  if (!groups.has('help.read')) entries.push({ name: 'help.read', scope: 'read', description: 'List Figger commands with their parameter schemas and scopes, or describe one command.', input: { type: 'object', properties: { command: { type: 'string', description: 'A Figger command id; omit to list all' } } }, commands: [] });
  return entries;
}

export function railCommands(run) {
  return railEntries().map((e) => ({
    name: e.name,
    description: e.description,
    input: e.input,
    scope: e.scope,
    handler: async (args) => {
      args = args || {};
      if (e.name === 'help.read' && !e.commands.length) {
        const m = all().filter((c) => !c.personOnly && !c.noRail).map((c) => ({ id: c.id, label: c.label, description: c.description || c.label, scope: c.scope, params: inputSchema(c) }));
        return args.command ? m.find((c) => c.id === args.command) || { error: `No command ${args.command}` } : m;
      }
      if (!e.commands.includes(args.command)) throw new Error(`${args.command} is not a ${e.name} command`);
      const v = await run(args.command, args.params || {}, { source: 'agent' });
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
