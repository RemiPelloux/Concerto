import { packageVersion } from "#src/config/root.js";
import { loadConfig } from "#src/config/load.js";
import { serve } from "#src/mcp/server.js";
import { concertoTools } from "#src/mcp/tools.js";
import { loadCatalog } from "#src/models/catalog.js";
import { runModel } from "#src/runner/index.js";

/**
 * `concerto --mcp`: Concerto as an MCP server on stdio, for Claude Code, Codex, Cursor or any
 * MCP client. Each call loads the config of the project it names, so one server serves many.
 * Nothing but protocol messages goes to stdout.
 */
export async function runMcp(): Promise<void> {
  const version = packageVersion();
  const opener = async (cwd: string) => {
    const config = loadConfig(cwd);
    return { config, catalog: await loadCatalog(config), runner: runModel };
  };
  await serve({ name: "concerto", version, tools: concertoTools(opener), input: process.stdin, output: process.stdout });
}
