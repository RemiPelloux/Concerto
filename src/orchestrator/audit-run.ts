import { AuditLog, auditPath, type AuditEntry } from "#src/engine/audit.js";
import type { Concert } from "#src/orchestrator/concert.js";

const logs = new WeakMap<Concert, AuditLog>();

/** Adds an action to this run's audit log, `.concerto/audit/<run>.jsonl`; a log that cannot be written never stops the run. */
export function audit(c: Concert, entry: AuditEntry): void {
  try {
    const log = logs.get(c) ?? new AuditLog(auditPath(c.cwd, c.runId));
    logs.set(c, log);
    log.record(entry);
  } catch {
    // A read-only project still runs; the session log keeps what happened.
  }
}
