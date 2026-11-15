import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expandHome } from "#src/config/load.js";
import type { SkillRule } from "#src/config/types.js";

/** Skill rules with their paths resolved and checked once, so routing never touches the disk. */
export class Skills {
  private readonly rules: { always: boolean; tags: ReadonlySet<string>; paths: string[] }[];

  constructor(rules: SkillRule[], cwd: string) {
    this.rules = rules.map((r) => ({
      always: r.tags.includes("*"),
      tags: new Set(r.tags),
      paths: r.paths.map((p) => resolve(cwd, expandHome(p))).filter((p) => existsSync(p)),
    }));
  }

  /** Rules tagged "*" always apply; the others match on story tags. */
  for(tags: readonly string[]): string[] {
    const paths = this.rules.filter((r) => r.always || tags.some((t) => r.tags.has(t))).flatMap((r) => r.paths);
    return [...new Set(paths)];
  }
}
