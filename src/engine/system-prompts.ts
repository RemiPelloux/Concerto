import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { packageRoot } from "../config/load.js";
import type { Role } from "../config/types.js";
import { hashParts } from "./hash.js";

const GUIDELINES = join(".pelloux", "GUIDELINES.md");
const SEPARATOR = "\n\n---\n\n";
const ROLE_FILES: Record<Role, string[]> = {
  conductor: ["conductor.md"],
  scorer: ["scorer.md"],
  soloist: ["builder.md"],
  section: ["builder.md", "section.md"],
  critic: ["critic.md"],
};
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * One byte-stable system prompt file per role, written once and memoized.
 *
 * Provider prompt caches match on an exact prefix, so everything here is static: the shared
 * guidelines first (the same bytes for every role), then the role brief, then the toolchain
 * notes for this repository. Dates, paths and story text belong in the message, after it.
 */
export class SystemPrompts {
  private readonly files = new Map<Role, string>();
  private readonly guidelines: string;

  constructor(
    private readonly cwd: string,
    private readonly notes: string,
  ) {
    const path = [join(cwd, GUIDELINES), join(packageRoot(), GUIDELINES)].find((p) => existsSync(p));
    this.guidelines = path ? readFileSync(path, "utf8") : "";
  }

  file(role: Role): string {
    const known = this.files.get(role);
    if (known) return known;
    const brief = ROLE_FILES[role].map((f) => readFileSync(join(packageRoot(), "prompts", f), "utf8")).join("\n\n");
    const body = [this.guidelines, brief, this.notes].filter(Boolean).join(SEPARATOR);
    const dir = join(this.cwd, ".concerto", "prompts");
    const file = join(dir, `${role}-${hashParts([body])}.md`);
    if (!existsSync(file)) {
      mkdirSync(dir, { recursive: true, mode: DIR_MODE });
      writeFileSync(file, body, { mode: FILE_MODE });
      chmodSync(file, FILE_MODE);
    }
    this.files.set(role, file);
    return file;
  }
}
