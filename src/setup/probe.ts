import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Health } from "#src/models/health.js";
import type { Runner } from "#src/runner/types.js";

const PROBE_TIMEOUT_MS = 90_000;
const DEFAULT_CONCURRENCY = 8;
const ERROR_CHARS = 160;
const PROMPT = "Reply with exactly: ok";

export type ProbeOptions = { runner: Runner; concurrency?: number; onResult?: (ref: string, ok: boolean) => void };

/** An empty scratch directory: probes must not read or touch any repository. */
function sandbox(): { cwd: string; systemFile: string } {
  const cwd = mkdtempSync(join(tmpdir(), "concerto-probe-"));
  const systemFile = join(cwd, "system.md");
  writeFileSync(systemFile, "Answer with exactly the word the user asks for, nothing else.", { mode: 0o600 });
  return { cwd, systemFile };
}

/** Provider errors echo key prefixes and client IPs; neither belongs in a file or a terminal log. */
export function redact(text: string): string {
  return text
    .replace(/\b(?:sk|pk|rk|key)-[\w*.-]{4,}/gi, "[key]")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "[ip]")
    .replace(/\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/gi, "[ip]");
}

function firstLine(error: unknown): string {
  const text = redact(error instanceof Error ? error.message : String(error));
  return text.split("\n").find((l) => l.trim())?.trim().slice(0, ERROR_CHARS) ?? "failed";
}

async function probeOne(ref: string, runner: Runner, box: { cwd: string; systemFile: string }) {
  const req = { model: ref, prompt: PROMPT, tools: [], effort: "low" as const, skills: [], ...box, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) };
  try {
    const out = await runner(req, () => undefined);
    const ok = /\bok\b/i.test(out.text);
    return { ok, checkedAt: Date.now(), error: ok ? "" : `unexpected answer: ${out.text.slice(0, ERROR_CHARS)}` };
  } catch (error) {
    return { ok: false, checkedAt: Date.now(), error: firstLine(error) };
  }
}

/**
 * Sends every model one tiny prompt through its real backend and records which ones answer.
 * Runs a few at a time; a model that errors, times out or answers something else fails.
 */
export async function probeModels(refs: readonly string[], opts: ProbeOptions): Promise<Health> {
  const box = sandbox();
  const queue = [...new Set(refs)];
  const results: Health = {};
  const worker = async (): Promise<void> => {
    for (let ref = queue.shift(); ref !== undefined; ref = queue.shift()) {
      const check = await probeOne(ref, opts.runner, box);
      results[ref] = check;
      opts.onResult?.(ref, check.ok);
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? DEFAULT_CONCURRENCY }, worker));
  return results;
}
