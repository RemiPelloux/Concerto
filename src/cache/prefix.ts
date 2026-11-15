import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { packageRoot } from "../config/load.js";
import type { Role } from "../config/types.js";
import { hashParts } from "./hash.js";

const GUIDELINES = join(".pelloux", "GUIDELINES.md");

function firstExisting(paths: string[]): string | null {
  return paths.find((p) => existsSync(p)) ?? null;
}

function rolePrompt(role: Role): string {
  return readFileSync(join(packageRoot(), "prompts", `${role}.md`), "utf8");
}

/**
 * Builds the system prompt for a role as one byte-stable file.
 *
 * Provider prompt caches match on an exact prefix, so everything here is static: the shared
 * guidelines first (same bytes for every role), then the role brief. Nothing dynamic such as
 * dates, paths or story text goes in; that belongs in the user message, after the cached prefix.
 */
export function systemPromptFile(role: Role, cwd: string): string {
  const guidelinesPath = firstExisting([join(cwd, GUIDELINES), join(packageRoot(), GUIDELINES)]);
  const guidelines = guidelinesPath ? readFileSync(guidelinesPath, "utf8") : "";
  const body = [guidelines, rolePrompt(role)].filter(Boolean).join("\n\n---\n\n");
  const dir = join(cwd, ".concerto", "prompts");
  const file = join(dir, `${role}-${hashParts([body])}.md`);
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, body);
  }
  return file;
}
