import { createInterface } from "node:readline";
import { childEnv } from "#src/runner/env.js";
import type { RunEvent } from "#src/runner/events.js";
import { sandboxed, type SandboxSpec } from "#src/runner/sandbox.js";
import { spawnTool } from "#src/runner/tool.js";
import type { RunResult } from "#src/runner/types.js";
import { addUsage, ZERO_USAGE } from "#src/runner/usage.js";

const STDERR_TAIL = 2000;
const ERROR_TAIL = 400;

export type JsonlJob = {
  bin: string;
  args: string[];
  /** Sent on stdin: keeps prompts out of `ps` and past the per-argument size limit. */
  input: string;
  cwd: string;
  signal?: AbortSignal;
  parse: (line: string) => RunEvent | null;
  /** Extra environment for this CLI only, on top of Concerto's child environment. */
  env?: Record<string, string>;
  sandbox?: SandboxSpec;
};

function fold(result: RunResult, event: RunEvent): void {
  if (event.kind !== "turn") return;
  result.usage = addUsage(result.usage, event.usage);
  result.turns += 1;
  if (event.text) result.text = event.text;
}

/** Runs a CLI that prints JSON lines and folds its "turn" events into one result; in the sandbox when asked. */
export async function runJsonl(job: JsonlJob, onEvent: (e: RunEvent) => void): Promise<RunResult> {
  if (!job.sandbox) return run(job, onEvent);
  const launch = await sandboxed({ bin: job.bin, args: job.args, cwd: job.cwd }, job.sandbox);
  try {
    return await run({ ...job, bin: launch.bin, args: launch.args, env: { ...job.env, ...launch.env } }, onEvent);
  } finally {
    launch.close();
  }
}

function run(job: JsonlJob, onEvent: (e: RunEvent) => void): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawnTool(job.bin, job.args, { cwd: job.cwd, signal: job.signal, env: { ...childEnv(), ...job.env } });
    const result: RunResult = { text: "", usage: ZERO_USAGE, turns: 0 };
    let stderr = "";
    let failure = "";
    child.stderr?.on("data", (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL)));
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(job.input);
    createInterface({ input: child.stdout! }).on("line", (line) => {
      const event = job.parse(line);
      if (!event) return;
      if (event.kind === "error") failure = event.message;
      fold(result, event);
      onEvent(event);
    });
    child.on("error", reject);
    // A failure reported in the stream counts even on exit code 0, unless a later turn answered.
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`${job.bin} exited ${code}: ${failure || stderr.trim().slice(-ERROR_TAIL)}`));
      if (failure && !result.text) return reject(new Error(`${job.bin}: ${failure}`));
      resolve(result);
    });
  });
}
