import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { bundledConfigPath, parseConfig, readConfigFile, userConfigPath } from "../config/load.js";
import type { ConcertoConfig } from "../config/types.js";
import type { Detection } from "./detect.js";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** Where calls go first when the same model is reachable several ways. */
export const ROUTINGS = {
  subscriptions: { label: "Subscriptions first", detail: "Claude Code and Codex, then proxies and API keys", prefer: ["claude-code", "codex"] },
  proxy: { label: "Proxy first", detail: "ce-* providers and Codex profiles, then subscriptions", prefer: ["ce-*", "codex@*"] },
  api: { label: "API keys first", detail: "pi providers (anthropic, openai, deepseek), then subscriptions", prefer: ["anthropic", "openai", "deepseek"] },
} as const;
export type Routing = keyof typeof ROUTINGS;

/**
 * The bundled config plus every model this machine can reach, so the file lists all linked AI
 * in one place. Routes and roles keep the bundled defaults; `prefer` follows the user's choice.
 */
export function buildUserConfig(detection: Detection, routing: Routing): ConcertoConfig {
  const base = readConfigFile(bundledConfigPath());
  const models = { ...base.models };
  detection.linked.forEach((m) => {
    models[m.ref] ??= { tier: m.tier };
  });
  return parseConfig({ ...base, models, prefer: [...ROUTINGS[routing].prefer] }, "the generated config");
}

export function writeUserConfig(config: ConcertoConfig, path = userConfigPath()): string {
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
  const comment = "Written by Concerto onboarding. Every model this machine could reach is listed; edit freely, or rerun `concerto --init`.";
  writeFileSync(path, `${JSON.stringify({ $comment: comment, ...config }, null, 2)}\n`, { mode: FILE_MODE });
  chmodSync(path, FILE_MODE);
  return path;
}
