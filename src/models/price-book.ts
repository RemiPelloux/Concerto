import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { userConfigPath } from "#src/config/load.js";
import type { Price } from "#src/models/types.js";

/** A public catalogue of model prices in USD per million tokens, kept up to date by its community. */
export const PRICE_SOURCE = "https://models.dev/api.json";
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

const CostSchema = z.object({ input: z.number(), output: z.number(), cache_read: z.number().optional(), cache_write: z.number().optional() });
const SourceSchema = z.record(z.string(), z.object({ models: z.record(z.string(), z.object({ cost: CostSchema.optional() }).passthrough()) }).passthrough());

/** `provider -> model id -> price`, with when and where it came from. */
export type PriceBook = { fetchedAt: string; source: string; providers: Record<string, Record<string, Price>> };

export const priceBookPath = () => join(dirname(userConfigPath()), "prices.json");

function toPrice(cost: z.infer<typeof CostSchema>): Price {
  return { input: cost.input, output: cost.output, cacheRead: cost.cache_read ?? cost.input, cacheWrite: cost.cache_write ?? cost.input };
}

/** Reads the catalogue into a price book; models without a price are left out. */
export function parsePriceSource(json: unknown, fetchedAt = new Date().toISOString()): PriceBook {
  const source = SourceSchema.parse(json);
  const providers = Object.fromEntries(Object.entries(source).map(([provider, p]) => [
    provider,
    Object.fromEntries(Object.entries(p.models).flatMap(([id, m]) => (m.cost ? [[id, toPrice(m.cost)]] : []))),
  ]));
  return { fetchedAt, source: PRICE_SOURCE, providers };
}

/** `--update-prices`: fetches the catalogue and saves it next to the config, owner-only. */
export async function updatePriceBook(fetcher: typeof fetch = fetch, path = priceBookPath()): Promise<PriceBook> {
  const res = await fetcher(PRICE_SOURCE);
  if (!res.ok) throw new Error(`${PRICE_SOURCE} answered ${res.status}.`);
  const book = parsePriceSource(await res.json());
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
  writeFileSync(path, JSON.stringify(book), { mode: FILE_MODE });
  chmodSync(path, FILE_MODE);
  return book;
}

export function readPriceBook(path = priceBookPath()): PriceBook | null {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as PriceBook) : null;
  } catch {
    return null;
  }
}
