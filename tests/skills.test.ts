import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bundledSkills, installSkills, skillTargets } from "#src/commands/skills.js";
import { tempDir } from "#tests/fixtures.js";

describe("skills", () => {
  it("ships a skill set, each with a name and a description agents can match on", () => {
    const skills = bundledSkills();
    expect(skills.sort()).toEqual(["concerto", "concerto-config", "concerto-doctor"]);
    skills.forEach((name) => {
      const text = readFileSync(join("skills", name, "SKILL.md"), "utf8");
      expect(text).toMatch(new RegExp(`^---\\nname: ${name}\\ndescription: .{80,}\\n---\\n`));
    });
  });

  it("installs into the agent folders that exist, and only those", () => {
    const home = tempDir();
    mkdirSync(join(home, ".claude", "skills"), { recursive: true });
    mkdirSync(join(home, ".pi", "agent", "skills"), { recursive: true });
    const targets = skillTargets(home).filter((t) => t.startsWith(home));
    expect(targets).toEqual([join(home, ".claude", "skills"), join(home, ".pi", "agent", "skills")]);
    installSkills(targets);
    expect(readFileSync(join(home, ".pi", "agent", "skills", "concerto-doctor", "SKILL.md"), "utf8")).toContain("concerto --doctor");
  });
});
