import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentBin } from "#src/runner/bins.js";
import type { RunEvent } from "#src/runner/events.js";
import { withRolePrompt, writes } from "#src/runner/skill-note.js";
import { runJsonl } from "#src/runner/spawn.js";
import { parseRef, type Runner, type RunRequest } from "#src/runner/types.js";

const FILE_MODE = 0o600;
const THOUSAND = 1000;

/**
 * Aider with one message from a file: it answers, edits and exits. It never commits (Concerto
 * merges the work), and a role that only reads runs in ask mode, which never edits.
 */
export function buildAiderArgs(req: RunRequest, messageFile: string): string[] {
  const args = ["--message-file", messageFile, "--model", parseRef(req.model).id, "--yes-always", "--no-auto-commits", "--no-dirty-commits"];
  args.push("--no-stream", "--no-pretty", "--no-check-update", "--no-show-model-warnings", "--analytics-disable", "--no-gitignore");
  return writes(req) ? args : [...args, "--chat-mode", "ask"];
}

/** Aider's `format_tokens`: 999, 1.2k, 12k. */
const tokens = (n: string, k: string | undefined) => Math.round(Number(n) * (k ? THOUSAND : 1));
const count = (line: string, label: string) => {
  const m = new RegExp(`([\\d.]+)(k?) ${label}`).exec(line);
  return m ? tokens(m[1] ?? "0", m[2]) : 0;
};

/**
 * Aider prints plain text. Its report, `Tokens: 1.2k sent, 300 cache hit, 120 received. Cost:
 * $0.01 message, $0.03 session.`, closes a turn: `sent` counts every prompt token, cached or not.
 */
export function aiderParser(): (line: string) => RunEvent | null {
  let text: string[] = [];
  return (line) => {
    if (line.startsWith("Tokens: ")) {
      const [hit, write] = [count(line, "cache hit"), count(line, "cache write")];
      const usage = { input: Math.max(0, count(line, "sent") - hit - write), output: count(line, "received"), cacheRead: hit, cacheWrite: write, cost: Number(/Cost: \$([\d.]+) message/.exec(line)?.[1] ?? 0) };
      const said = text.join("\n").trim();
      text = [];
      return { kind: "turn", usage, text: said };
    }
    if (/^Applied edit to /.test(line)) return { kind: "tool", name: "edit", detail: line.slice("Applied edit to ".length) };
    if (!line.trim() || line.startsWith("Cost: ")) return null;
    text.push(line);
    return { kind: "text", delta: line };
  };
}

export const runAider: Runner = async (req, onEvent) => {
  const dir = mkdtempSync(join(tmpdir(), "concerto-aider-"));
  const messageFile = join(dir, "message.md");
  writeFileSync(messageFile, withRolePrompt(req), { mode: FILE_MODE });
  try {
    return await runJsonl({ bin: agentBin("aider"), args: buildAiderArgs(req, messageFile), input: "", cwd: req.cwd, signal: req.signal, parse: aiderParser() }, onEvent);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
