import type { ChildProcess, SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import crossSpawn from "cross-spawn";

const STDERR_TAIL = 2000;
const WINDOWS_EXTENSIONS = ".COM;.EXE;.BAT;.CMD";

/**
 * Starts an agent CLI. On Windows `claude`, `codex`, `pi` and `smarttest` are `.cmd` shims that
 * Node cannot start without a shell; cross-spawn finds them through PATHEXT and quotes every
 * argument for cmd.exe. Elsewhere it is plain `child_process.spawn`.
 */
export function spawnTool(bin: string, args: string[], options: SpawnOptions): ChildProcess {
  return crossSpawn(bin, args, options);
}

export type ToolCall = { cwd?: string; timeout: number; env?: NodeJS.ProcessEnv };

/** Runs a CLI to completion and returns what it printed; a non-zero exit rejects. */
export function runTool(bin: string, args: string[], call: ToolCall): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawnTool(bin, args, { cwd: call.cwd, env: call.env, timeout: call.timeout, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL)));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve({ stdout }) : reject(new Error(`${bin} exited ${code}: ${stderr.trim()}`))));
  });
}

/** The names a command can have on disk: `codex`, and on Windows also `codex.cmd`, `codex.exe`… */
function candidates(path: string, env: NodeJS.ProcessEnv): string[] {
  if (process.platform !== "win32") return [path];
  const extensions = (env.PATHEXT ?? WINDOWS_EXTENSIONS).split(";").filter(Boolean);
  return [path, ...extensions.map((ext) => path + ext.toLowerCase()), ...extensions.map((ext) => path + ext)];
}

/** Whether a command can be started: a path that exists, or a name found on PATH. */
export function onPath(bin: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (bin.includes("/") || bin.includes("\\")) return candidates(bin, env).some((p) => existsSync(p));
  const path = env.PATH ?? env.Path ?? "";
  return path.split(delimiter).some((dir) => dir && candidates(join(dir, bin), env).some((p) => existsSync(p)));
}
