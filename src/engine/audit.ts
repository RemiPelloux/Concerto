import { createHmac, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { userConfigPath } from "#src/config/load.js";

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const KEY_BYTES = 32;
/** A SHA-256 HMAC in hex is 64 characters; the first line chains to all zeros. */
const HMAC_HEX = 64;
const GENESIS = "0".repeat(HMAC_HEX);

/** What an agent did: a command it ran, a file it touched, a host the sandbox refused. */
export type AuditEntry = { story?: string; role: string; model: string; kind: string; detail: string };
type Line = AuditEntry & { seq: number; at: number; prev: string; mac: string };

/** This machine's audit key, made once, readable by you alone. */
function key(): Buffer {
  const path = join(dirname(userConfigPath()), "audit.key");
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
    writeFileSync(path, randomBytes(KEY_BYTES), { mode: FILE_MODE });
  }
  return readFileSync(path);
}

const sign = (k: Buffer, line: Omit<Line, "mac">) => createHmac("sha256", k).update(JSON.stringify(line)).digest("hex");

export const auditPath = (cwd: string, runId: string) => join(cwd, ".concerto", "audit", `${runId}.jsonl`);

/**
 * A run's audit log: one line per agent action, each signed with this machine's key over itself
 * and the line before it, so a line changed, removed or reordered breaks the chain.
 */
export class AuditLog {
  private prev = GENESIS;
  private seq = 0;
  private readonly key = key();

  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
  }

  record(entry: AuditEntry): void {
    const line = { seq: (this.seq += 1), at: Date.now(), ...entry, prev: this.prev };
    const mac = sign(this.key, line);
    appendFileSync(this.path, `${JSON.stringify({ ...line, mac })}\n`, { mode: FILE_MODE });
    this.prev = mac;
  }
}

/** Checks a run's log against this machine's key: every line, in order, unchanged. */
export function verifyAudit(path: string): { ok: boolean; lines: number; brokenAt?: number } {
  const k = key();
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Line);
  let prev = GENESIS;
  for (const [i, { mac, ...line }] of lines.entries()) {
    if (line.prev !== prev || line.seq !== i + 1 || sign(k, line) !== mac) return { ok: false, lines: lines.length, brokenAt: i + 1 };
    prev = mac;
  }
  return { ok: true, lines: lines.length };
}
