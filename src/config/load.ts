import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigSchema, type ConcertoConfig } from "./types.js";

const BUNDLED = fileURLToPath(new URL("../../concerto.config.json", import.meta.url));

export function expandHome(path: string): string {
  return path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : path;
}

export function bundledConfigPath(): string {
  return BUNDLED;
}

/** Where onboarding writes the personal config: `$XDG_CONFIG_HOME/concerto/config.json`. */
export function userConfigPath(): string {
  return resolve(process.env.XDG_CONFIG_HOME || resolve(homedir(), ".config"), "concerto", "config.json");
}

/** `$CONCERTO_CONFIG`, then `./concerto.config.json`, then the user config, then the bundled one. */
export function configPath(cwd: string): string {
  const fromEnv = process.env.CONCERTO_CONFIG;
  if (fromEnv) return resolve(cwd, fromEnv);
  const candidates = [resolve(cwd, "concerto.config.json"), userConfigPath()];
  return candidates.find((p) => existsSync(p)) ?? BUNDLED;
}

/** First launch: nothing but the bundled config would load. */
export function isFirstLaunch(cwd: string): boolean {
  return configPath(cwd) === BUNDLED;
}

/** Validates a config object; errors name the file and the path of each bad field. */
export function parseConfig(raw: unknown, source: string): ConcertoConfig {
  const parsed = ConfigSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`);
  throw new Error(`invalid config in ${source}:\n${issues.join("\n")}`);
}

export function readConfigFile(path: string): ConcertoConfig {
  return parseConfig(JSON.parse(readFileSync(path, "utf8")), path);
}

export function loadConfig(cwd: string): ConcertoConfig {
  return readConfigFile(configPath(cwd));
}

export function packageRoot(): string {
  return fileURLToPath(new URL("../..", import.meta.url));
}
