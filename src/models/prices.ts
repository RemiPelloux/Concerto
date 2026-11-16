import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ModelRef } from "#src/runner/types.js";
import type { Price } from "#src/models/types.js";
import { readPriceBook } from "#src/models/price-book.js";

export type PriceIndex = { byRef: Map<string, Price>; byId: Map<string, Price> };

export function piAgentDir(): string {
  return process.env.PI_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

function readJson(path: string): unknown {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}

function isPriced(node: unknown): node is { id: string; cost: Price } {
  if (typeof node !== "object" || node === null) return false;
  const rec = node as Record<string, unknown>;
  return typeof rec.id === "string" && typeof rec.cost === "object" && rec.cost !== null;
}

function collect(node: unknown, provider: string, into: PriceIndex): void {
  if (isPriced(node)) {
    into.byRef.set(`${provider}/${node.id}`, node.cost);
    into.byId.set(node.id, node.cost);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  for (const [key, child] of Object.entries(node)) {
    collect(child, provider || key, into);
  }
}

function addBook(into: PriceIndex): void {
  const book = readPriceBook();
  Object.entries(book?.providers ?? {}).forEach(([provider, models]) => Object.entries(models).forEach(([id, price]) => {
    into.byRef.set(`${provider}/${id}`, price);
    into.byId.set(id, price);
  }));
}

/**
 * Prices in USD per million tokens. Read lowest priority first, each overriding the last: pi's
 * bundled registry, then the price book `--update-prices` fetched, then the models you defined in pi.
 */
export function loadPriceIndex(dir = piAgentDir()): PriceIndex {
  const index: PriceIndex = { byRef: new Map(), byId: new Map() };
  collect(readJson(join(dir, "models-store.json")), "", index);
  addBook(index);
  const custom = readJson(join(dir, "models.json")) as { providers?: unknown };
  collect(custom.providers ?? {}, "", index);
  return index;
}

/** Exact ref first, then the provider behind a profile (codex@ce-gpt -> ce-gpt), then the bare id. */
export function priceFor(index: PriceIndex, ref: ModelRef): Price | null {
  const id = ref.id.replace(/\[.*\]$/, "");
  return index.byRef.get(`${ref.prefix}/${ref.id}`) ?? index.byRef.get(`${ref.provider}/${id}`) ?? index.byId.get(id) ?? null;
}
