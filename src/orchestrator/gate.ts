import { spawn, type ChildProcess } from "node:child_process";
import { gitEnv } from "#src/runner/env.js";

const GATE_TIMEOUT_SECONDS = 600;
const MS = 1000;
/** The end of a failing command's output is what names the failure; this much goes back. */
const OUTPUT_TAIL = 6_000;

export type GateFailure = { command: string; output: string };
type GateCall = { cwd: string; signal?: AbortSignal };

/** Kills the command and everything it started, not only the shell. */
function stop(child: ChildProcess): void {
  if (process.platform === "win32" || !child.pid) return void child.kill();
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

function runGate(command: string, call: GateCall): Promise<{ ok: boolean; output: string }> {
  return new Promise((done) => {
    const child = spawn(command, { cwd: call.cwd, shell: true, env: gitEnv(), detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const keep = (chunk: Buffer) => void (output = (output + chunk.toString()).slice(-OUTPUT_TAIL));
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    const kill = () => stop(child);
    const timer = setTimeout(() => { output += `\n[killed after ${GATE_TIMEOUT_SECONDS}s]`; kill(); }, GATE_TIMEOUT_SECONDS * MS);
    call.signal?.addEventListener("abort", kill, { once: true });
    const end = (ok: boolean, extra = "") => {
      clearTimeout(timer);
      call.signal?.removeEventListener("abort", kill);
      done({ ok, output: (output + extra).trim() });
    };
    child.on("error", (error) => end(false, `\n${error.message}`));
    child.on("close", (code) => end(code === 0, code === 0 ? "" : `\n[exit ${code ?? "killed"}]`));
  });
}

/** Runs the repository's own checks in order and stops at the first that fails. */
export async function runGates(commands: readonly string[], call: GateCall): Promise<GateFailure | null> {
  for (const command of commands) {
    const result = await runGate(command, call);
    if (!result.ok) return { command, output: result.output };
  }
  return null;
}
