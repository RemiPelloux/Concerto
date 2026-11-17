import { readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const MAX_CACHED_BYTES = 16_777_216;
type Entry = { stamp: string; content: Buffer };
type Pending = { stamp: string; promise: Promise<Buffer> };

function stampOf(path: string): string {
  const s = statSync(path, { bigint: true });
  return `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
}

/** Source bytes owned by one concert; validate metadata even after external builder writes. */
export class ReadCache {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Pending>();
  private bytes = 0;

  read(path: string): string {
    const key = resolve(path);
    const stamp = stampOf(key);
    const hit = this.entries.get(key);
    if (hit?.stamp === stamp) return hit.content.toString("utf8");
    this.remove(key);
    const content = readFileSync(key);
    this.remember(key, { stamp, content });
    return content.toString("utf8");
  }

  async readBuffer(path: string): Promise<Buffer> {
    const key = resolve(path);
    const stamp = stampOf(key);
    const hit = this.entries.get(key);
    if (hit?.stamp === stamp) return hit.content;
    const active = this.pending.get(key);
    if (active?.stamp === stamp) return active.promise;
    this.remove(key);
    const promise = readFile(key).then((content) => {
      if (this.pending.get(key)?.promise === promise) this.remember(key, { stamp, content });
      return content;
    }).finally(() => {
      if (this.pending.get(key)?.promise === promise) this.pending.delete(key);
    });
    this.pending.set(key, { stamp, promise });
    return promise;
  }

  private remember(key: string, entry: Entry): void {
    this.remove(key);
    if (entry.content.length > MAX_CACHED_BYTES) return;
    while (this.bytes + entry.content.length > MAX_CACHED_BYTES) this.remove(this.entries.keys().next().value!);
    this.entries.set(key, entry);
    this.bytes += entry.content.length;
  }

  private remove(key: string): void {
    this.bytes -= this.entries.get(key)?.content.length ?? 0;
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.pending.clear();
    this.bytes = 0;
  }
}
