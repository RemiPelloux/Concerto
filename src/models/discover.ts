import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { claudeBin } from "../runner/claude.js";
import { codexBin } from "../runner/codex.js";
import { CLAUDE_CODE, CODEX } from "../runner/index.js";
import { piBin } from "../runner/pi.js";
import type { ListedModel } from "./types.js";

const run = promisify(execFile);
const KILO = 1000;
const UNIT_SCALE: Record<string, number> = { K: 1, M: KILO };
const LIST_TIMEOUT_MS = 30_000;
const CLAUDE_CONTEXT_K = 1000;
const CODEX_CONTEXT_K = 272;
const CLAUDE_MODELS = ["claude-fable-5-2", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];

export function onPath(bin: string): boolean {
  if (bin.includes("/")) return existsSync(bin);
  return (process.env.PATH ?? "").split(delimiter).some((dir) => existsSync(join(dir, bin)));
}

function parseContext(token: string): number {
  const match = /^([\d.]+)([KM])$/.exec(token);
  if (!match) return 0;
  return Number(match[1]) * (UNIT_SCALE[match[2] ?? "K"] ?? 1);
}

/** Parses the table printed by `pi --list-models`. */
export function parseListModels(text: string): ListedModel[] {
  const rows = text.split("\n").slice(1);
  return rows.flatMap((row) => {
    const [provider, id, context] = row.trim().split(/\s+/);
    if (!provider || !id || !context) return [];
    return [{ ref: `${provider}/${id}`, contextK: parseContext(context) }];
  });
}

function codexSlugs(): string[] {
  const file = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "models_cache.json");
  if (!existsSync(file)) return [];
  const data = JSON.parse(readFileSync(file, "utf8")) as { models?: { slug?: string }[] };
  return (data.models ?? []).flatMap((m) => (m.slug ? [m.slug] : []));
}

async function piModels(): Promise<ListedModel[]> {
  if (!onPath(piBin())) return [];
  const { stdout } = await run(piBin(), ["--list-models", "--offline"], { timeout: LIST_TIMEOUT_MS });
  return parseListModels(stdout);
}

/** Every model Concerto can reach right now: Claude Code, Codex and pi. */
export async function discoverModels(): Promise<ListedModel[]> {
  const claude = onPath(claudeBin()) ? CLAUDE_MODELS.map((id) => ({ ref: `${CLAUDE_CODE}/${id}`, contextK: CLAUDE_CONTEXT_K })) : [];
  const codex = onPath(codexBin()) ? codexSlugs().map((id) => ({ ref: `${CODEX}/${id}`, contextK: CODEX_CONTEXT_K })) : [];
  return [...claude, ...codex, ...(await piModels())];
}
