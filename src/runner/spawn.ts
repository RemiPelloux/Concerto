import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { RunEvent } from "./events.js";
import type { RunResult } from "./types.js";
import { addUsage, ZERO_USAGE } from "./usage.js";

const STDERR_TAIL = 400;

export type JsonlJob = {
  bin: string;
  args: string[];
  cwd: string;
  signal?: AbortSignal;
  parse: (line: string) => RunEvent | null;
};

function fold(result: RunResult, event: RunEvent): void {
  if (event.kind !== "turn") return;
  result.usage = addUsage(result.usage, event.usage);
  result.turns += 1;
  if (event.text) result.text = event.text;
}

/**
 * Runs a CLI that prints JSON lines and folds its "turn" events into one result.
 * Stdin is closed on purpose: agent CLIs in print mode otherwise wait for piped input.
 */
export function runJsonl(job: JsonlJob, onEvent: (e: RunEvent) => void): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(job.bin, job.args, { cwd: job.cwd, signal: job.signal, stdio: ["ignore", "pipe", "pipe"] });
    const result: RunResult = { text: "", usage: ZERO_USAGE, turns: 0 };
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    createInterface({ input: child.stdout }).on("line", (line) => {
      const event = job.parse(line);
      if (!event) return;
      fold(result, event);
      onEvent(event);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(result) : reject(new Error(`${job.bin} exited ${code}: ${stderr.trim().slice(-STDERR_TAIL)}`)),
    );
  });
}
