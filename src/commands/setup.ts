import { reachableRefs } from "#src/models/discover.js";
import type { ConcertoConfig } from "#src/config/types.js";
import { catalogFrom } from "#src/models/catalog.js";
import { healthPath, saveHealth, type Health } from "#src/models/health.js";
import { runModel } from "#src/runner/index.js";
import { parseRef } from "#src/runner/types.js";
import { detect, type Detection } from "#src/setup/detect.js";
import { organigramLines } from "#src/setup/organigram.js";
import { probeModels } from "#src/setup/probe.js";
import { sourceLines } from "#src/setup/sources.js";
import { buildUserConfig, candidateRefs, ROUTINGS, writeUserConfig, type Routing } from "#src/setup/user-config.js";

const out = (line: string) => process.stdout.write(`${line}\n`);

export function parseRouting(value: string | undefined): Routing {
  if (value === undefined) return "subscriptions";
  if (value in ROUTINGS) return value as Routing;
  throw new Error(`--routing must be one of: ${Object.keys(ROUTINGS).join(", ")}.`);
}

/** Installed and logged in, so worth one probe each: the bundled models plus every linked one. */
export async function probeTargets(detection: Detection): Promise<string[]> {
  const candidates = candidateRefs(detection);
  const reachable = await reachableRefs(candidates.map(parseRef));
  return candidates.filter((ref) => reachable.has(ref));
}

/** Probes, saves the results to the health file and returns the refs that answered. */
export async function probeAndSave(refs: string[], onResult?: (ref: string, ok: boolean) => void): Promise<Set<string>> {
  const results: Health = await probeModels(refs, { runner: runModel, onResult });
  saveHealth(results);
  return new Set(Object.entries(results).filter(([, c]) => c.ok).map(([ref]) => ref));
}

/** Configured models whose CLI or provider is installed: the ones worth a probe. */
export async function installedTargets(config: ConcertoConfig): Promise<string[]> {
  const refs = Object.keys(config.models);
  const reachable = await reachableRefs(refs.map(parseRef));
  return refs.filter((ref) => reachable.has(ref));
}

export async function runProbe(config: ConcertoConfig): Promise<void> {
  const refs = Object.keys(config.models);
  const targets = await installedTargets(config);
  out(`Probing ${targets.length} installed models (${refs.length - targets.length} not installed), one tiny prompt each...`);
  const working = await probeAndSave(targets, (ref, ok) => out(`${ok ? "ok  " : "FAIL"} ${ref}`));
  out(`${working.size} of ${targets.length} answered. Failed models are skipped for 24 hours: ${healthPath()}`);
}

/** `--init`: the onboarding screen in a terminal, or a direct write in scripts and CI. */
export async function runInit(routing: string | undefined): Promise<void> {
  if (process.stdin.isTTY && routing === undefined) return (await import("#src/ui/launch.js")).runOnboarding();
  const detection = await detect();
  const targets = await probeTargets(detection);
  process.stderr.write(`Probing ${targets.length} models, one tiny prompt each...\n`);
  const working = await probeAndSave(targets, (ref, ok) => process.stderr.write(`${ok ? "ok  " : "FAIL"} ${ref}\n`));
  const config = buildUserConfig(detection, parseRouting(routing), working);
  const path = writeUserConfig(config);
  out(`Saved ${working.size} of ${targets.length} models that answered to ${path} (${parseRouting(routing)} first).`);
  organigramLines(catalogFrom(config), config).forEach(out);
}

export type AutoConfig = { config: ConcertoConfig; path: string; sources: string[] };

/**
 * `/config auto`: reads every source on this machine (Claude Code, Codex and its servers, pi and
 * its providers, API keys), tests each model, and saves the organigram as the personal config.
 */
export async function autoConfig(prefer: readonly string[], onResult: (ref: string, ok: boolean) => void): Promise<AutoConfig> {
  const detection = await detect();
  const working = await probeAndSave(await probeTargets(detection), onResult);
  const built = buildUserConfig(detection, "subscriptions", working);
  const config = prefer.length > 0 ? { ...built, prefer: [...prefer] } : built;
  return { config, path: writeUserConfig(config), sources: sourceLines(detection) };
}
