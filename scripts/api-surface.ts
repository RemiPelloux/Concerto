/**
 * Concerto's public surface under semantic versioning: flags, slash commands, config keys, event
 * types and MCP tools. docs/api-surface.json is this, committed; a test fails when the code and the
 * file differ. Removing or renaming an entry is a breaking change and needs a major version;
 * adding one is a minor change: regenerate the file.
 *
 *   node --import tsx --conditions=source scripts/api-surface.ts > docs/api-surface.json
 */
import { USAGE } from "#src/commands/options.js";
import { ConfigSchema } from "#src/config/types.js";
import { EVENT_TYPES } from "#src/events.js";
import { concertoTools } from "#src/mcp/tools.js";
import { COMMANDS } from "#src/ui/slash.js";
import { keys } from "#scripts/reference.js";

export function apiSurface(): string {
  const unused = async () => Promise.reject(new Error("not opened"));
  const surface = {
    flags: [...USAGE.matchAll(/^ {2}(--[\w-]+)/gm)].map((m) => m[1]).sort(),
    slashCommands: COMMANDS.map((c) => `/${c.name}`).sort(),
    configKeys: keys(ConfigSchema, "").map((r) => r.path.replace(/`/g, "")),
    events: [...EVENT_TYPES],
    mcpTools: concertoTools(unused).map((t) => t.name),
    exitCodes: { "0": "the command or run succeeded", "1": "a run did not finish every story, or an error" },
  };
  return `${JSON.stringify(surface, null, 2)}\n`;
}

if (process.argv[1]?.endsWith("api-surface.ts")) process.stdout.write(apiSurface());
