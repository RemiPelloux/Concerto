import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { bundledConfigPath, parseConfig, readConfigFile, userConfigPath } from "#src/config/load.js";
import type { ConcertoConfig } from "#src/config/types.js";
import { catalogFrom } from "#src/models/catalog.js";
import type { Detection } from "#src/setup/detect.js";
import { proposeRoles } from "#src/setup/organigram.js";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** Where calls go first when the same model is reachable several ways. */
export const ROUTINGS = {
  subscriptions: { label: "Subscriptions first", detail: "Claude Code and Codex, then proxies and API keys", prefer: ["claude-code", "codex"] },
  proxy: { label: "Proxy first", detail: "ce-* providers and Codex profiles, then subscriptions", prefer: ["ce-*", "codex@*"] },
  api: { label: "API keys first", detail: "pi providers (anthropic, openai, deepseek), then subscriptions", prefer: ["anthropic", "openai", "deepseek"] },
} as const;
export type Routing = keyof typeof ROUTINGS;

/** Every model worth probing: the bundled list plus whatever this machine links. */
export function candidateRefs(detection: Detection): string[] {
  return [...new Set([...Object.keys(readConfigFile(bundledConfigPath()).models), ...detection.linked.map((m) => m.ref)])];
}

/**
 * Every linked model that answered its probe, so the file lists exactly the AI that works on
 * this machine. Each role gets the best of those models (the organigram); routes keep the bundled
 * defaults (unreachable entries are skipped at run time); `prefer` follows the user's choice.
 */
export function buildUserConfig(detection: Detection, routing: Routing, working: ReadonlySet<string>): ConcertoConfig {
  const base = readConfigFile(bundledConfigPath());
  const all = { ...base.models };
  detection.linked.forEach((m) => {
    all[m.ref] ??= { tier: m.tier };
  });
  const models = Object.fromEntries(Object.entries(all).filter(([ref]) => working.has(ref)));
  const roles = proposeRoles(base.roles, catalogFrom({ ...base, models }));
  return parseConfig({ ...base, models, roles, prefer: [...ROUTINGS[routing].prefer] }, "the generated config");
}

/** The previous file is kept next to it as `config.json.bak`, so hand edits are never lost. */
export function writeUserConfig(config: ConcertoConfig, path = userConfigPath()): string {
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
  if (existsSync(path)) copyFileSync(path, `${path}.bak`);
  const comment = "Written by Concerto onboarding. Every model this machine could reach is listed; edit freely, or rerun `concerto --init` or `/config auto`.";
  writeFileSync(path, `${JSON.stringify({ $comment: comment, ...config }, null, 2)}\n`, { mode: FILE_MODE });
  chmodSync(path, FILE_MODE);
  return path;
}
