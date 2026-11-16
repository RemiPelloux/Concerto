import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { userConfigPath } from "#src/config/load.js";
import type { Plan } from "#src/orchestrator/plan.js";

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;

type Shape = { name: string; summary: string; stories: { title: string; points: number; tags: string[]; acceptance: string[] }[] };

/** Templates are personal and work in any repository: they live next to the config. */
export const templatesDir = () => join(dirname(userConfigPath()), "templates");

function file(name: string): string {
  if (!NAME.test(name)) throw new Error("Template names are lowercase letters, digits and dashes, 48 at most.");
  return join(templatesDir(), `${name}.json`);
}

/** Saves the waiting plan's shape: its stories' titles, points, tags and acceptance items. */
export function saveTemplate(name: string, plan: Plan): string {
  const shape: Shape = { name, summary: plan.summary, stories: plan.stories.map((s) => ({ title: s.title, points: s.points, tags: s.tags, acceptance: s.acceptance })) };
  mkdirSync(templatesDir(), { recursive: true, mode: DIR_MODE });
  writeFileSync(file(name), JSON.stringify(shape, null, 2), { mode: FILE_MODE });
  chmodSync(file(name), FILE_MODE);
  return file(name);
}

export function listTemplates(): string[] {
  return existsSync(templatesDir()) ? readdirSync(templatesDir()).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length)).sort() : [];
}

/** The template as a segment for the scorer: the shape to follow where the request fits it. */
export function templateBrief(name: string): string {
  if (!existsSync(file(name))) throw new Error(`No template "${name}". Saved: ${listTemplates().join(", ") || "none"}.`);
  const shape = JSON.parse(readFileSync(file(name), "utf8")) as Shape;
  const lines = shape.stories.map((s) => `- ${s.title} (${s.points} pts${s.tags.length ? `, ${s.tags.join(", ")}` : ""}): ${s.acceptance.join("; ")}`);
  return [`## Plan shape to follow: ${name}`, `A plan for "${shape.summary}" had these stories. Plan this request in the same shape where it fits, adapted to it:`, ...lines].join("\n");
}
