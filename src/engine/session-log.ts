import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { gitEnv } from "#src/runner/env.js";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const KEEP = 30;
const BASE36 = 36;
const SUFFIX_BYTES = 2;
const OWN_STATE = ".concerto/";

/** Keeps `.concerto/` out of commits without touching the project's .gitignore. */
function excludeLocally(cwd: string): void {
  try {
    const path = execFileSync("git", ["rev-parse", "--git-path", "info/exclude"], { cwd, env: gitEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const file = join(cwd, path);
    const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
    if (!lines.includes(OWN_STATE)) appendFileSync(file, `${lines.at(-1) === "" || lines.length === 0 ? "" : "\n"}${OWN_STATE}\n`);
  } catch {
    // Not a git repository: nothing to exclude from.
  }
}

/** The newest `KEEP` logs stay; older ones go, with their saved session. */
function prune(dir: string): void {
  const logs = readdirSync(dir).filter((f) => f.endsWith(".log")).map((f) => join(dir, f));
  const old = logs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs).slice(KEEP);
  old.forEach((f) => [f, f.replace(/\.log$/, ".json")].forEach((path) => rmSync(path, { force: true })));
}

/**
 * One log file per launch, `.concerto/logs/<session id>.log`, owner-only: every phase, log
 * entry, agent line and error with its stack. The id appears in the status line and in crash
 * messages, so a report can always point at its log.
 */
export class SessionLog {
  static current: SessionLog | null = null;
  readonly id = `s-${Date.now().toString(BASE36)}-${randomBytes(SUFFIX_BYTES).toString("hex")}`;
  readonly path: string;

  constructor(private readonly cwd: string) {
    const dir = join(cwd, ".concerto", "logs");
    this.path = join(dir, `${this.id}.log`);
    try {
      mkdirSync(dir, { recursive: true, mode: DIR_MODE });
      prune(dir);
      excludeLocally(cwd);
    } catch {
      // A read-only project still runs; the log is then simply not written.
    }
    SessionLog.current = this;
  }

  /** The path to show people: relative to the project. */
  get shownPath(): string {
    return relative(this.cwd, this.path);
  }

  write(kind: string, text: string): void {
    try {
      const fresh = !existsSync(this.path);
      appendFileSync(this.path, `${new Date().toISOString()} [${kind}] ${text}\n`, { mode: FILE_MODE });
      if (fresh) chmodSync(this.path, FILE_MODE);
    } catch {
      // Logging must never be the reason a run fails.
    }
  }

  error(error: unknown, where: string): void {
    const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    this.write(`error ${where}`, detail);
  }
}
