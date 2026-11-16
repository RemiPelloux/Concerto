/**
 * docs/reference.md, generated from the code itself: every flag (the help text), every slash
 * command (the commands table) and every config key (the config schema). A test fails when the
 * committed page differs, so the reference cannot fall behind.
 *
 *   node --import tsx --conditions=source scripts/reference.ts > docs/reference.md
 */
import { USAGE } from "#src/commands/options.js";
import { ConfigSchema } from "#src/config/types.js";
import { COMMANDS } from "#src/ui/slash.js";

type Def = { type: string; [key: string]: unknown };
type Row = { path: string; type: string; value: string };
const def = (schema: unknown): Def => (schema as { _zod: { def: Def } })._zod.def;
const shown = (v: unknown) => (v === undefined ? "" : `\`${JSON.stringify(v)}\``);

/** A field's type in words, and the schema whose fields come under it (an object, or a map's or list's items). */
function kind(schema: unknown): { type: string; inner?: unknown; value?: unknown; optional?: boolean } {
  const d = def(schema);
  if (d.type === "default") return { ...kind(d.innerType), value: d.defaultValue };
  if (d.type === "optional") return { ...kind(d.innerType), optional: true };
  if (d.type === "object") return { type: "object", inner: schema };
  if (d.type === "record") return { type: `map of ${kind(d.valueType).type}`, inner: def(d.valueType).type === "object" ? d.valueType : undefined };
  if (d.type === "array") return { type: `list of ${kind(d.element).type}`, inner: def(d.element).type === "object" ? d.element : undefined };
  if (d.type === "enum") return { type: Object.keys(d.entries as object).map((e) => `"${e}"`).join(" \\| ") };
  if (d.type === "union") return { type: (d.options as unknown[]).map((o) => kind(o).type).join(" or ") };
  if (d.type === "literal") return { type: (d.values as unknown[]).map((v) => JSON.stringify(v)).join(" \\| ") };
  return { type: d.type };
}

/** Every key under `schema`, depth first: `sandbox.allowHosts`, `models.<ref>.tier`, `routes[].models`. */
function keys(schema: unknown, prefix: string): Row[] {
  const d = def(schema);
  const shape = d.type === "object" ? (d.shape as Record<string, unknown>) : {};
  return Object.entries(shape).flatMap(([name, field]) => {
    const k = kind(field);
    const path = `${prefix}${name}`;
    const row = { path: `\`${path}\``, type: `${k.type}${k.optional ? ", optional" : ""}`, value: shown(k.value) };
    if (!k.inner) return [row];
    const sep = k.type.startsWith("map") ? `${path}.<key>.` : k.type.startsWith("list") ? `${path}[].` : `${path}.`;
    return [row, ...keys(k.inner, sep)];
  });
}

function section(title: string, at: { intro: string; head: string; rows: string[] }): string[] {
  return [`## ${title}`, "", at.intro, "", at.head, `|${"---|".repeat(at.head.split("|").length - 2)}`, ...at.rows, ""];
}

function flagRows(): string[] {
  return USAGE.split("\n").filter((l) => l.startsWith("  --")).map((l) => {
    const [flag = "", ...rest] = l.trim().split(/\s{2,}/);
    return `| \`${flag}\` | ${rest.join(" ")} |`;
  });
}

const commandRows = () => COMMANDS.map((c) => `| \`/${c.name}${c.args ? ` ${c.args}` : ""}\` | ${c.help} |`.replace(/\|(?=[^`]*`[^`]*$)/g, "\\|"));

export function reference(): string {
  return [
    "# Reference",
    "",
    "Generated from the code by `scripts/reference.ts`; a test fails when this page and the code differ.",
    "See [recipes](recipes.md) for what to do with them, and [failures](failures.md) for every error message.",
    "",
    ...section("Flags", { intro: "`concerto [options] [request]`", head: "| Flag | What it does |", rows: flagRows() }),
    ...section("Slash commands", { intro: "Type them in the TUI's prompt; Tab completes them.", head: "| Command | What it does |", rows: commandRows() }),
    ...section("Config keys", { intro: "In `~/.config/concerto/config.json`, with a project's `concerto.config.json` merged over it.", head: "| Key | Type | Default |", rows: keys(ConfigSchema, "").map((r) => `| ${r.path} | ${r.type} | ${r.value} |`) }),
  ].join("\n");
}

if (process.argv[1]?.endsWith("reference.ts")) process.stdout.write(reference());
