import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigSchema, type ConcertoConfig } from "./types.js";

const BUNDLED = fileURLToPath(new URL("../../concerto.config.json", import.meta.url));

export function expandHome(path: string): string {
  return path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : path;
}

export function configPath(cwd: string): string {
  const fromEnv = process.env.CONCERTO_CONFIG;
  if (fromEnv) return resolve(cwd, fromEnv);
  const candidates = [resolve(cwd, "concerto.config.json"), resolve(homedir(), ".config", "concerto", "config.json")];
  return candidates.find((p) => existsSync(p)) ?? BUNDLED;
}

export function loadConfig(cwd: string): ConcertoConfig {
  const raw: unknown = JSON.parse(readFileSync(configPath(cwd), "utf8"));
  return ConfigSchema.parse(raw);
}

export function packageRoot(): string {
  return fileURLToPath(new URL("../..", import.meta.url));
}
