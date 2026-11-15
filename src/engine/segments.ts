import { approxTokens } from "#src/engine/condense.js";
import { hashParts } from "#src/engine/hash.js";

/**
 * A piece of a user message. Callers list segments from the most stable (repository snapshot,
 * plan) to the most volatile (this story, this critique), so consecutive calls share the
 * longest possible prefix with the provider's prompt cache.
 */
export type Segment = { name: string; text: string };

export type Assembled = { prompt: string; hashes: string[]; skippedTokens: number };

const RECALL = "Context sent earlier in this session still applies";

/**
 * Joins segments into one prompt. In a resumed session, segments the model already has
 * (same name, same bytes) are left out and replaced by one line naming them.
 */
export function assemble(segments: readonly Segment[], alreadySent: ReadonlySet<string> = new Set()): Assembled {
  const present = segments.filter((s) => s.text.trim() !== "").map((s) => ({ ...s, hash: hashParts([s.name, s.text]) }));
  const skipped = present.filter((s) => alreadySent.has(s.hash));
  const kept = present.filter((s) => !alreadySent.has(s.hash));
  const recall = skipped.length > 0 ? [`(${RECALL}: ${skipped.map((s) => s.name).join(", ")}.)`] : [];
  return {
    prompt: [...recall, ...kept.map((s) => s.text)].join("\n\n"),
    hashes: present.map((s) => s.hash),
    skippedTokens: skipped.reduce((sum, s) => sum + approxTokens(s.text), 0),
  };
}

/** Whitespace-insensitive form used for cache keys, so reflowed text still hits. */
export function normalizeForKey(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
