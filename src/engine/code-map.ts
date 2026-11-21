import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ImportGraph } from "#src/engine/import-graph.js";

/** The most imported files listed: the code a change is most likely to reach. */
const HUBS = 12;
/** Fewer importers than this and a file is no hub: listing it would only be noise. */
const MIN_HUB_IMPORTERS = 3;
/** Importers named per planned file before the rest are counted. */
const NAMED_IMPORTERS = 3;
const FILE_MODE = 0o600;

function trace(graph: ImportGraph, file: string): string {
  const from = graph.importersOf(file);
  if (from.length === 0) return `- ${file} · imported by nothing`;
  const named = from.slice(0, NAMED_IMPORTERS).join(", ");
  return `- ${file} · imported by ${named}${from.length > NAMED_IMPORTERS ? ` and ${from.length - NAMED_IMPORTERS} more` : ""}`;
}

/**
 * A map of the code from the import graph, no model involved: the files the most code depends
 * on, then, for each file the plan touches, who imports it. Agents start from it instead of
 * exploring the repository with their own tools.
 */
export function codeMap(graph: ImportGraph, planFiles: readonly string[]): string {
  const ranked = graph.ranked().filter((h) => h.importers >= MIN_HUB_IMPORTERS).slice(0, HUBS);
  const hubs = ranked.map((h) => `- ${h.file} · ${graph.lines(h.file)} lines · imported by ${h.importers}`);
  const traced = [...new Set(planFiles)].map((f) => trace(graph, f));
  return [
    "## Code map (from the import graph; also in .concerto/code-map.md)",
    ...(hubs.length ? ["Most imported files, where a change reaches the most code:", ...hubs] : []),
    ...(traced.length ? ["Files the plan touches, and what imports them:", ...traced] : []),
  ].join("\n");
}

/** Writes the map to .concerto/code-map.md and returns the path. */
export function saveCodeMap(cwd: string, map: string): string {
  const dir = join(cwd, ".concerto");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "code-map.md");
  writeFileSync(path, `${map}\n`, { mode: FILE_MODE });
  return path;
}
