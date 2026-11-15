import type { RunEvent } from "../runner/events.js";
import type { Store } from "../state/store.js";

const FLUSH_MS = 150;
const MAX_LINE = 400;

/**
 * Turns one agent's event stream into readable lines for its live view. Text arrives in small
 * deltas, so lines are buffered and written to the store at most every 150 ms: the screen stays
 * live without re-rendering on every token.
 */
export class AgentFeed {
  private partial = "";
  private pending: string[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: Store,
    private readonly id: string,
  ) {}

  push(event: RunEvent): void {
    if (event.kind === "tool") this.line(`▸ ${event.name} ${event.detail}`);
    if (event.kind === "error") this.line(`✗ ${event.message}`);
    if (event.kind === "text") this.text(event.delta);
  }

  private text(delta: string): void {
    const parts = (this.partial + delta).split("\n");
    this.partial = parts.pop() ?? "";
    parts.forEach((p) => this.line(p));
    if (this.partial.length > MAX_LINE) {
      this.line(this.partial);
      this.partial = "";
    }
  }

  private line(text: string): void {
    this.pending.push(text.slice(0, MAX_LINE));
    this.timer ??= setTimeout(() => this.flush(), FLUSH_MS);
  }

  /** Writes what is buffered, the unfinished line included. Call once more when the agent ends. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const lines = this.partial ? [...this.pending, this.partial] : this.pending;
    this.partial = "";
    this.pending = [];
    if (lines.length > 0) this.store.agentLines(this.id, lines);
  }
}
