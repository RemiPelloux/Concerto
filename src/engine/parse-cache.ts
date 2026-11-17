import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ReadCache } from "#src/engine/read-cache.js";

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

/** Include identity and change time so same-size edits with restored mtimes invalidate. */
function stampOf(path: string): string | null {
  try {
    const s = statSync(path, { bigint: true });
    return `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
  } catch {
    return null;
  }
}

/** One source file as the import graph needs it: its line count and the imports it names. */
export type Parsed = { stamp: string; lines: number; specifiers: string[] };

/**
 * The import graph's parse of every source file, kept between runs in .concerto/cache/: a file
 * whose size and modification time did not change is not read again.
 */
export class ParseCache {
  readonly reads = new ReadCache();
  private entries: Record<string, Parsed>;
  private dirty = false;

  constructor(private readonly file: string) {
    try {
      this.entries = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, Parsed>) : {};
    } catch {
      this.entries = {};
    }
  }

  static for(cwd: string): ParseCache {
    return new ParseCache(join(cwd, ".concerto", "cache", "imports.json"));
  }

  /** The cached parse when the file is unchanged, otherwise `parse()`'s, remembered. */
  get(cwd: string, path: string, parse: () => Omit<Parsed, "stamp">): Omit<Parsed, "stamp"> {
    const stamp = stampOf(join(cwd, path));
    if (!stamp) return parse();
    const hit = this.entries[path];
    if (hit?.stamp === stamp) return hit;
    const fresh = { stamp, ...parse() };
    this.entries[path] = fresh;
    this.dirty = true;
    return fresh;
  }

  save(): void {
    if (!this.dirty) return;
    mkdirSync(dirname(this.file), { recursive: true, mode: DIR_MODE });
    writeFileSync(this.file, JSON.stringify(this.entries), { mode: FILE_MODE });
    this.dirty = false;
  }
}
