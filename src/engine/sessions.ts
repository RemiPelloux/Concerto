import type { ModelInfo } from "#src/models/types.js";
import { RESUMABLE } from "#src/runner/index.js";
import { hashParts } from "#src/engine/hash.js";

export type SessionHandle = { dir: string; id: string; resume: boolean; sent: ReadonlySet<string> };

/**
 * Warm sessions per run. A session belongs to one key (a story, the conductor) and one model:
 * falling back to another model starts a new one. Tracks which prompt segments each session
 * has already seen, so later turns only send what is new.
 */
export class Sessions {
  private readonly sent = new Map<string, Set<string>>();
  /** How many times a session that never got going was given up, per key and model. */
  private readonly restarts = new Map<string, number>();

  constructor(
    readonly dir: string,
    private readonly runId: string,
  ) {}

  open(key: string, model: ModelInfo): SessionHandle | undefined {
    if (!RESUMABLE.has(model.parsed.backend)) return undefined;
    const base = `${this.runId}-${key.replace(/[^\w-]/g, "_")}-${hashParts([model.ref])}`;
    const restarts = this.restarts.get(base) ?? 0;
    const id = restarts ? `${base}-${restarts}` : base;
    const known = this.sent.get(id);
    return { dir: this.dir, id, resume: known !== undefined, sent: known ?? new Set() };
  }

  /**
   * Called when a turn failed. A session that already worked stays: it can be resumed. One that
   * this turn opened is given up, since the agent may have created it before failing: opening that
   * id again as new is refused ("Session ID … is already in use"), so the next turn gets a new id.
   */
  discard(handle: SessionHandle): void {
    if (handle.resume) return;
    const base = handle.id.replace(/-\d+$/, "");
    this.restarts.set(base, (this.restarts.get(base) ?? 0) + 1);
  }

  /** Called after a successful turn: the session now holds these segments. */
  record(handle: SessionHandle, hashes: readonly string[]): void {
    const set = this.sent.get(handle.id) ?? new Set<string>();
    hashes.forEach((h) => set.add(h));
    this.sent.set(handle.id, set);
  }
}
