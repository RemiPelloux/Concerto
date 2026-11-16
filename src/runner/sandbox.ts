import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isSea } from "node:sea";
import { gitEnv } from "#src/runner/env.js";
import { PROVIDER_HOSTS, startProxy } from "#src/runner/proxy.js";

/** Inside the Linux sandbox, the agent's proxy is this local port, relayed to Concerto's socket. */
export const INNER_PORT = 18_080;

/** What a sandboxed call needs: hosts beyond the providers, home paths to hide, where to report refusals. */
export type SandboxSpec = { allowHosts: string[]; hide: string[]; writable: string[]; blocked: (host: string) => void };
export type Launch = { bin: string; args: string[]; env: Record<string, string>; close: () => void };

/** Credentials an agent never needs: hidden from every sandboxed process. */
const SECRET_PATHS = [".ssh", ".aws", ".gnupg", ".kube", ".docker", ".config/gh", ".azure", ".config/gcloud", ".netrc", ".git-credentials", ".npmrc", ".pypirc"];
/** Where the agent CLIs keep their logins, sessions and caches: writable in the sandbox. */
const AGENT_PATHS = [".claude", ".claude.json", ".codex", ".pi", ".gemini", ".cursor", ".config/opencode", ".local/share/opencode", ".local/state/opencode", ".config/goose", ".local/share/goose", ".cache", ".npm"];

const home = (p: string) => join(homedir(), p);
const present = (paths: readonly string[]) => paths.map(home).filter((p) => existsSync(p));

/** The repository's shared git folder: a worktree's index and refs live there. */
function gitCommonDir(cwd: string): string | null {
  try {
    return resolve(cwd, execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd, env: gitEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
  } catch {
    return null;
  }
}

/** How to run Concerto itself inside the sandbox, for the relay: the executable, or Node and the script (CONCERTO_RELAY_COMMAND under a test runner). */
function self(): string[] {
  if (process.env.CONCERTO_RELAY_COMMAND) return JSON.parse(process.env.CONCERTO_RELAY_COMMAND) as string[];
  return isSea() ? [process.execPath] : [process.execPath, ...process.execArgv, process.argv[1] ?? ""];
}

export function hasBubblewrap(): boolean {
  return spawnSync("bwrap", ["--ro-bind", "/", "/", "--unshare-net", "true"], { stdio: "ignore" }).status === 0;
}

/** bubblewrap: the system read-only, the story's folders writable, secrets hidden, no network but the relay. */
export function bwrapArgs(at: { cwd: string; writable: string[]; hidden: string[]; runtime: string }): string[] {
  const args = ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp", "--unshare-net", "--unshare-pid", "--die-with-parent"];
  [...new Set([at.cwd, ...at.writable, at.runtime])].forEach((p) => args.push("--bind", p, p));
  at.hidden.forEach((p) => args.push(...(existsSync(join(p, ".")) ? ["--tmpfs", p] : ["--ro-bind", "/dev/null", p])));
  return [...args, "--chdir", at.cwd];
}

/** sandbox-exec on macOS: no network but the local proxy, no writes outside the story's folders, secrets unreadable. */
export function seatbeltProfile(at: { writable: string[]; hidden: string[] }): string {
  const sub = (p: string) => `(subpath "${p.replace(/"/g, '\\"')}")`;
  return [
    "(version 1)", "(allow default)",
    "(deny network-outbound)", '(allow network-outbound (remote ip "localhost:*") (remote unix-socket))',
    `(deny file-read* ${at.hidden.map(sub).join(" ")})`,
    "(deny file-write*)",
    `(allow file-write* ${[...at.writable, "/private/tmp", "/private/var/folders", "/dev"].map(sub).join(" ")})`,
  ].join("\n");
}

function proxyEnv(url: string): Record<string, string> {
  return { HTTPS_PROXY: url, HTTP_PROXY: url, https_proxy: url, http_proxy: url, ALL_PROXY: url, NO_PROXY: "", no_proxy: "", NODE_USE_ENV_PROXY: "1" };
}

/**
 * Wraps an agent CLI in the platform's sandbox, with Concerto's allow-listing proxy as its only
 * way out. Throws where no sandbox exists: a run that asked for one never runs without it.
 */
export async function sandboxed(job: { bin: string; args: string[]; cwd: string }, spec: SandboxSpec): Promise<Launch> {
  const runtime = mkdtempSync(join(tmpdir(), "concerto-sandbox-"));
  spec.writable.forEach((dir) => mkdirSync(dir, { recursive: true }));
  const rule = { patterns: [...PROVIDER_HOSTS, ...spec.allowHosts], blocked: spec.blocked };
  const writable = [...present(AGENT_PATHS), ...spec.writable, ...[gitCommonDir(job.cwd)].filter((d): d is string => d !== null)];
  const hidden = present([...SECRET_PATHS, ...spec.hide]);
  if (process.platform === "linux") {
    if (!hasBubblewrap()) throw new Error("The sandbox needs bubblewrap (bwrap) with user namespaces; install it, or set sandbox.enabled to false.");
    const socket = join(runtime, "proxy.sock");
    const { server } = await startProxy(socket, rule);
    const close = () => (server.close(), rmSync(runtime, { recursive: true, force: true }));
    const relay = [...self(), "--sandbox-forward", String(INNER_PORT), socket, "--", job.bin, ...job.args];
    return { bin: "bwrap", args: [...bwrapArgs({ cwd: job.cwd, writable, hidden, runtime }), "--", ...relay], env: proxyEnv(`http://127.0.0.1:${INNER_PORT}`), close };
  }
  if (process.platform === "darwin") {
    const { server, port } = await startProxy(0, rule);
    const close = () => (server.close(), rmSync(runtime, { recursive: true, force: true }));
    return { bin: "sandbox-exec", args: ["-p", seatbeltProfile({ writable: [job.cwd, ...writable, runtime], hidden }), job.bin, ...job.args], env: proxyEnv(`http://127.0.0.1:${port}`), close };
  }
  rmSync(runtime, { recursive: true, force: true });
  throw new Error("The sandbox runs on Linux (bubblewrap) and macOS (sandbox-exec); on this system set sandbox.enabled to false or run Concerto in its Docker image.");
}

/**
 * A check command (the tests, or an acceptance command the scorer wrote) in the sandbox with no
 * network at all: the folder writable, the system read-only, credentials hidden.
 */
export function sandboxCommand(command: string, at: { cwd: string; hide: string[] }): { bin: string; args: string[] } {
  const writable = [...present(AGENT_PATHS), ...[gitCommonDir(at.cwd)].filter((d): d is string => d !== null)];
  const hidden = present([...SECRET_PATHS, ...at.hide]);
  if (process.platform === "linux") {
    if (!hasBubblewrap()) throw new Error("The sandbox needs bubblewrap (bwrap) with user namespaces; install it, or set sandbox.enabled to false.");
    return { bin: "bwrap", args: [...bwrapArgs({ cwd: at.cwd, writable, hidden, runtime: at.cwd }), "--", "sh", "-c", command] };
  }
  if (process.platform === "darwin") return { bin: "sandbox-exec", args: ["-p", seatbeltProfile({ writable: [at.cwd, ...writable], hidden }), "sh", "-c", command] };
  throw new Error("The sandbox runs on Linux (bubblewrap) and macOS (sandbox-exec).");
}
