import { parseLine } from "./events.js";
import { runJsonl } from "./spawn.js";
import type { Runner, RunRequest } from "./types.js";

export function piBin(): string {
  return process.env.CONCERTO_PI_BIN || "pi";
}

export function buildArgs(req: RunRequest): string[] {
  const args = ["-p", "--mode", "json", "--model", req.model, "--thinking", req.effort];
  args.push("--system-prompt", req.systemFile, "--no-context-files", "--no-skills");
  args.push(...(req.tools.length > 0 ? ["--tools", req.tools.join(",")] : ["--no-tools"]));
  req.skills.forEach((path) => args.push("--skill", path));
  if (req.session) args.push("--session-dir", req.session.dir, "--session-id", req.session.id);
  else args.push("--no-session");
  args.push(req.prompt);
  return args;
}

/** Any provider logged into pi: Anthropic, OpenAI, DeepSeek, Grok, custom endpoints. */
export const runPi: Runner = (req, onEvent) =>
  runJsonl({ bin: piBin(), args: buildArgs(req), cwd: req.cwd, signal: req.signal, parse: parseLine }, onEvent);
