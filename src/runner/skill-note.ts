import { join } from "node:path";

/** For CLIs without a skill flag: point the agent at the skill files it should read first. */
export function withSkillNote(prompt: string, skills: string[]): string {
  if (skills.length === 0) return prompt;
  const files = skills.map((dir) => `- ${join(dir, "SKILL.md")}`).join("\n");
  return `${prompt}\n\nBefore you start, read these skill files and follow them where they apply:\n${files}`;
}
