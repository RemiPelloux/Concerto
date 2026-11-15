import { reachableRefs } from "../models/discover.js";
import type { ConcertoConfig } from "../config/types.js";
import { healthPath, saveHealth, type Health } from "../models/health.js";
import { runModel } from "../runner/index.js";
import { parseRef } from "../runner/types.js";
import { detect, type Detection } from "../setup/detect.js";
import { probeModels } from "../setup/probe.js";
import { buildUserConfig, candidateRefs, ROUTINGS, writeUserConfig, type Routing } from "../setup/user-config.js";

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

/** `--probe`: tests every configured model that is installed, and records the result. */
export async function runProbe(config: ConcertoConfig): Promise<void> {
  const refs = Object.keys(config.models);
  const reachable = await reachableRefs(refs.map(parseRef));
  const targets = refs.filter((ref) => reachable.has(ref));
  out(`Probing ${targets.length} installed models (${refs.length - targets.length} not installed), one tiny prompt each...`);
  const working = await probeAndSave(targets, (ref, ok) => out(`${ok ? "ok  " : "FAIL"} ${ref}`));
  out(`${working.size} of ${targets.length} answered. Failed models are skipped for 24 hours: ${healthPath()}`);
}

/** `--init`: the onboarding screen in a terminal, or a direct write in scripts and CI. */
export async function runInit(routing: string | undefined): Promise<void> {
  if (process.stdin.isTTY && routing === undefined) return (await import("../ui/launch.js")).runOnboarding();
  const detection = await detect();
  const targets = await probeTargets(detection);
  process.stderr.write(`Probing ${targets.length} models, one tiny prompt each...\n`);
  const working = await probeAndSave(targets, (ref, ok) => process.stderr.write(`${ok ? "ok  " : "FAIL"} ${ref}\n`));
  const path = writeUserConfig(buildUserConfig(detection, parseRouting(routing), working));
  out(`Saved ${working.size} of ${targets.length} models that answered to ${path} (${parseRouting(routing)} first).`);
}
