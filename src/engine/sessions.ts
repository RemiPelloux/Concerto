import type { ModelInfo } from "../models/types.js";
import { RESUMABLE } from "../runner/index.js";
import { hashParts } from "./hash.js";

export type SessionHandle = { dir: string; id: string; resume: boolean; sent: ReadonlySet<string> };

/**
 * Warm sessions per run. A session belongs to one key (a story, the conductor) and one model:
 * falling back to another model starts a new one. Tracks which prompt segments each session
 * has already seen, so later turns only send what is new.
 */
export class Sessions {
  private readonly sent = new Map<string, Set<string>>();

  constructor(
    readonly dir: string,
    private readonly runId: string,
  ) {}

  open(key: string, model: ModelInfo): SessionHandle | undefined {
    if (!RESUMABLE.has(model.parsed.backend)) return undefined;
    const id = `${this.runId}-${key.replace(/[^\w-]/g, "_")}-${hashParts([model.ref])}`;
    const known = this.sent.get(id);
    return { dir: this.dir, id, resume: known !== undefined, sent: known ?? new Set() };
  }

  /** Called after a successful turn: the session now holds these segments. */
  record(handle: SessionHandle, hashes: readonly string[]): void {
    const set = this.sent.get(handle.id) ?? new Set<string>();
    hashes.forEach((h) => set.add(h));
    this.sent.set(handle.id, set);
  }
}
