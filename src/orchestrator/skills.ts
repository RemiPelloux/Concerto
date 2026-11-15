import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expandHome } from "../config/load.js";
import type { SkillRule } from "../config/types.js";

/** Skill folders for a story: rules tagged "*" always apply, others match on story tags. */
export function skillsFor(rules: SkillRule[], tags: string[], cwd: string): string[] {
  const wanted = new Set(tags);
  const paths = rules
    .filter((r) => r.tags.includes("*") || r.tags.some((t) => wanted.has(t)))
    .flatMap((r) => r.paths.map((p) => resolve(cwd, expandHome(p))));
  return [...new Set(paths)].filter((p) => existsSync(p));
}
