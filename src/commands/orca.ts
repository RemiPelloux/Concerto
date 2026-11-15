import { asRecord, parseJsonLine, str } from "#src/runner/json.js";
import { onPath, runTool } from "#src/runner/tool.js";

const ORCA_TIMEOUT_MS = 60_000;
const NAME_WORDS = 5;
const NAME_MAX = 40;

/**
 * The Orca CLI for this session. Outside Orca's own terminals on Linux, `orca` is usually the
 * GNOME screen reader, so the app's CLI is `orca-ide` there.
 */
export function orcaBin(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ORCA_CLI_COMMAND) return env.ORCA_CLI_COMMAND;
  const insideOrca = Boolean(env.ORCA_AGENT_HOOK_PORT);
  return process.platform === "linux" && !insideOrca && onPath("orca-ide") ? "orca-ide" : "orca";
}

/** POSIX single quoting: the request becomes one literal argument, whatever it contains. */
export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** "Add CSV export to invoices." -> "concerto-add-csv-export-to-invoices" */
export function worktreeName(request: string): string {
  const words = request.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean).slice(0, NAME_WORDS);
  return `concerto-${words.join("-") || "run"}`.slice(0, NAME_MAX).replace(/-+$/, "");
}

async function orca(args: string[]): Promise<Record<string, unknown>> {
  const { stdout } = await runTool(orcaBin(), [...args, "--json"], { timeout: ORCA_TIMEOUT_MS });
  const reply = parseJsonLine(stdout.trim()) ?? {};
  if (reply.ok === false) throw new Error(`orca ${args[0]} ${args[1]} failed: ${JSON.stringify(reply.error ?? reply)}`);
  return asRecord(reply.result);
}

/**
 * `--orca`: a fresh Orca worktree of the current repository, with Concerto started in its own
 * terminal tab. Every run gets an isolated checkout, and Orca shows it next to your other work.
 */
export async function runInOrca(request: string): Promise<void> {
  const created = await orca(["worktree", "create", "--name", worktreeName(request), "--no-parent", "--comment", "Concerto run"]);
  const worktree = asRecord(created.worktree);
  const id = str(worktree.id);
  if (!id) throw new Error("Orca did not return a worktree id.");
  const command = request ? `concerto ${shellQuote(request)}` : "concerto";
  await orca(["terminal", "create", "--worktree", `id:${id}`, "--title", "Concerto", "--command", command, "--focus"]);
  process.stdout.write(`Concerto is running in Orca, in a new worktree: ${str(worktree.path) || id}\n`);
}
