import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { packageRoot } from "#src/config/root.js";
import { ConfigSchema, type ConcertoConfig } from "#src/config/types.js";

const BUNDLED = join(packageRoot(), "concerto.config.json");

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

/** The personal config: `$CONCERTO_CONFIG`, then the user config, then the bundled one. */
function personalPath(cwd: string): string {
  const fromEnv = process.env.CONCERTO_CONFIG;
  if (fromEnv) return resolve(cwd, fromEnv);
  return existsSync(userConfigPath()) ? userConfigPath() : BUNDLED;
}

/** The project's own `concerto.config.json`, shared by the team; null when there is none. */
function projectPath(cwd: string): string | null {
  const path = resolve(cwd, "concerto.config.json");
  return existsSync(path) && path !== BUNDLED && path !== personalPath(cwd) ? path : null;
}

/** What the run reads: the personal config, and the project's merged over it when there is one. */
export function configPath(cwd: string): string {
  const project = projectPath(cwd);
  return project ? `${personalPath(cwd)} + ${project}` : personalPath(cwd);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** `over` on `base`: objects merge key by key, everything else (lists included) is replaced. */
export function mergeConfig(base: unknown, over: unknown): unknown {
  if (!isObject(base) || !isObject(over)) return over === undefined ? base : over;
  const keys = [...new Set([...Object.keys(base), ...Object.keys(over)])];
  return Object.fromEntries(keys.map((k) => [k, mergeConfig(base[k], over[k])]));
}

/**
 * First launch: no personal config yet, no `$CONCERTO_CONFIG`, and no project config of its own.
 * In Concerto's own repository the project file is the bundled default, which does not count.
 */
export function isFirstLaunch(cwd: string): boolean {
  const project = resolve(cwd, "concerto.config.json");
  const ownProject = existsSync(project) && project !== BUNDLED;
  return !process.env.CONCERTO_CONFIG && !ownProject && !existsSync(userConfigPath());
}

/** Validates a config object; errors name the file and the path of each bad field. */
export function parseConfig(raw: unknown, source: string): ConcertoConfig {
  const parsed = ConfigSchema.safeParse(raw);
  if (parsed.success) return checkPolicy(parsed.data, source);
  const issues = parsed.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`);
  throw new Error(`invalid config in ${source}:\n${issues.join("\n")}`);
}

/** A review the policy requires must exist as a custom review role. */
function checkPolicy(config: ConcertoConfig, source: string): ConcertoConfig {
  const reviews = new Set(config.customRoles.filter((r) => r.kind === "review").map((r) => r.name));
  const missing = config.policy.requireReview.map((r) => r.role).filter((r) => !reviews.has(r));
  if (missing.length) throw new Error(`invalid config in ${source}:\n  policy.requireReview: no custom review role named ${missing.join(", ")} in customRoles`);
  return config;
}

export function readConfigFile(path: string): ConcertoConfig {
  return parseConfig(JSON.parse(readFileSync(path, "utf8")), path);
}

/** A budget can never pass the policy's ceiling, whoever set it. */
export function withPolicy(config: ConcertoConfig): ConcertoConfig {
  const max = config.policy.maxRunUsd;
  return max === undefined ? config : { ...config, budgetUsd: Math.min(config.budgetUsd ?? max, max) };
}

/**
 * The personal config with the project's merged over it: a team commits routes, reviewers, budgets
 * and policy in `concerto.config.json`, and each person keeps their own models and logins.
 */
export function loadConfig(cwd: string): ConcertoConfig {
  const personal = personalPath(cwd);
  const project = projectPath(cwd);
  const raw = JSON.parse(readFileSync(personal, "utf8")) as unknown;
  if (!project) return withPolicy(parseConfig(raw, personal));
  return withPolicy(parseConfig(mergeConfig(raw, JSON.parse(readFileSync(project, "utf8"))), `${project} merged over ${personal}`));
}

export { packageRoot };
