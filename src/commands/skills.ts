import { cpSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { packageRoot } from "../config/load.js";

/** Where each agent looks for skills. Only directories that already exist are used. */
export function skillTargets(home = homedir()): string[] {
  const candidates = [
    process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, "skills") : join(home, ".claude", "skills"),
    join(process.env.CODEX_HOME ?? join(home, ".codex"), "skills"),
    join(home, ".pi", "agent", "skills"),
    join(home, ".agents", "skills"),
  ];
  return [...new Set(candidates)].filter((dir) => existsSync(dir));
}

export function bundledSkills(): string[] {
  const dir = join(packageRoot(), "skills");
  return existsSync(dir) ? readdirSync(dir).filter((name) => existsSync(join(dir, name, "SKILL.md"))) : [];
}

/** `--install-skills`: copies Concerto's skills into every agent found, replacing older copies. */
export function installSkills(targets = skillTargets()): void {
  const skills = bundledSkills();
  const out = (line: string) => process.stdout.write(`${line}\n`);
  if (targets.length === 0) {
    out("No agent skill folder found (~/.claude/skills, ~/.codex/skills, ~/.pi/agent/skills).");
    return;
  }
  targets.forEach((target) => {
    skills.forEach((name) => cpSync(join(packageRoot(), "skills", name), join(target, name), { recursive: true, force: true }));
    out(`${target}: ${skills.join(", ")}`);
  });
}
