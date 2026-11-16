import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunRequest } from "#src/runner/types.js";

/** For CLIs without a skill flag: point the agent at the skill files it should read first. */
export function withSkillNote(prompt: string, skills: string[]): string {
  if (skills.length === 0) return prompt;
  const files = skills.map((dir) => `- ${join(dir, "SKILL.md")}`).join("\n");
  return `${prompt}\n\nBefore you start, read these skill files and follow them where they apply:\n${files}`;
}

/** For CLIs without a system prompt flag: the role prompt opens the message, still a stable prefix. */
export function withRolePrompt(req: RunRequest): string {
  return `${readFileSync(req.systemFile, "utf8")}\n\n---\n\n${withSkillNote(req.prompt, req.skills)}`;
}

/** Tools that change the folder: a role with any of them builds, the others only read. */
const WRITE_TOOLS = new Set(["edit", "write", "bash"]);

export function writes(req: RunRequest): boolean {
  return req.tools.some((t) => WRITE_TOOLS.has(t));
}
