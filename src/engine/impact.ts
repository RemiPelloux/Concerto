import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join, posix } from "node:path";
import { promisify } from "node:util";
import { childEnv } from "../runner/env.js";
import { asArray, asRecord, parseJsonLine, str } from "../runner/json.js";
import { ImportGraph, isTestFile } from "./import-graph.js";

const run = promisify(execFile);
const EXPLAIN_TIMEOUT_MS = 30_000;
const EXPLAIN_CONCURRENCY = 4;
const MAX_FILES_PER_STORY = 20;
const LISTED_TESTS = 10;
/** Shorter stems ("db", "api") match too much to be a safe correction. */
const MIN_STEM = 4;

/** What a story reaches: the files it changes, who imports them, and the tests that cover them. */
export type Impact = {
  files: string[];
  newFiles: number;
  dependents: number;
  tests: string[];
  source: "smarttest" | "imports" | "none";
};

export const NO_IMPACT: Impact = { files: [], newFiles: 0, dependents: 0, tests: [], source: "none" };

/** Repository-relative, normalized, no `..`: the scorer's paths are model output. */
export function safePaths(paths: readonly string[]): string[] {
  const clean = paths.map((p) => posix.normalize(p.trim().replace(/^\.\//, "")));
  return [...new Set(clean)].filter((p) => p && !p.startsWith("/") && !p.split("/").includes("..")).slice(0, MAX_FILES_PER_STORY);
}

/** "src/engine/condense.ts" -> "condense"; "tests/a.test.ts" -> "a". */
function stem(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  return base.replace(/\.(?:test|spec)(?=\.)/, "").replace(/\.[^.]+$/, "").replace(/[^a-z0-9]/g, "");
}

function sharedSegments(a: string, b: string): number {
  const bs = new Set(b.split("/"));
  return a.split("/").filter((s) => bs.has(s)).length;
}

/**
 * Models misremember paths ("src/runner/condenser.ts" for "src/engine/condense.ts"). A path
 * that does not exist is matched to an existing file with the same stem, or a stem one is a
 * prefix of, in the same test/source kind; the closest directory wins. No match: a new file.
 */
export class PathMatcher {
  private readonly byStem = new Map<string, string[]>();

  constructor(private readonly known: ReadonlySet<string>) {
    known.forEach((f) => this.byStem.set(stem(f), [...(this.byStem.get(stem(f)) ?? []), f]));
  }

  match(path: string): string | null {
    if (this.known.has(path)) return path;
    const wanted = stem(path);
    if (wanted.length < MIN_STEM) return null;
    const stems = [wanted, ...[...this.byStem.keys()].filter((s) => s.length >= MIN_STEM && (wanted.startsWith(s) || s.startsWith(wanted)))];
    const candidates = stems.flatMap((s) => this.byStem.get(s) ?? []).filter((f) => isTestFile(f) === isTestFile(path));
    return candidates.sort((a, b) => sharedSegments(b, path) - sharedSegments(a, path))[0] ?? null;
  }
}

function smarttestBin(cwd: string): string | null {
  const bin = join(cwd, "node_modules", ".bin", "smarttest");
  return existsSync(bin) ? bin : null;
}

/** `smarttest explain <file> --json`: the tests protecting one file, through every import path. */
async function explain(bin: string, cwd: string, file: string): Promise<string[]> {
  try {
    const { stdout } = await run(bin, ["explain", file, "--json"], { cwd, timeout: EXPLAIN_TIMEOUT_MS, env: childEnv() });
    const report = parseJsonLine(stdout.trim()) ?? {};
    return asArray(report.tests).map((t) => str(asRecord(t).test)).filter(Boolean);
  } catch {
    return [];
  }
}

/** Each distinct file is explained once for the whole plan, a few at a time. */
async function explainAll(bin: string, cwd: string, files: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const queue = [...files];
  const worker = async (): Promise<void> => {
    for (let f = queue.shift(); f !== undefined; f = queue.shift()) out.set(f, await explain(bin, cwd, f));
  };
  await Promise.all(Array.from({ length: EXPLAIN_CONCURRENCY }, worker));
  return out;
}

export type ImpactInput = { cwd: string; repoFiles: readonly string[]; stories: { id: string; files: string[] }[] };

/**
 * The blast radius of every story in one pass: one import graph for the run, one SmartTest
 * call per distinct file. Tests come from SmartTest when the repository has it, otherwise
 * from the import graph.
 */
export async function analyzeImpact(input: ImpactInput): Promise<Map<string, Impact>> {
  const known = new Set(input.repoFiles);
  const matcher = new PathMatcher(known);
  const stories = input.stories.map((s) => ({ id: s.id, files: [...new Set(s.files.map((f) => matcher.match(f) ?? f))] }));
  const graph = new ImportGraph(input.cwd, input.repoFiles);
  const bin = smarttestBin(input.cwd);
  const existing = [...new Set(stories.flatMap((s) => s.files).filter((f) => known.has(f)))];
  const explained = bin ? await explainAll(bin, input.cwd, existing.filter((f) => !isTestFile(f))) : new Map<string, string[]>();
  const entries = stories.map((s): [string, Impact] => {
    if (s.files.length === 0) return [s.id, NO_IMPACT];
    const present = s.files.filter((f) => known.has(f));
    const reached = graph.dependentsOf(present);
    const fromGraph = [...present, ...reached].filter(isTestFile);
    const fromSmarttest = present.flatMap((f) => explained.get(f) ?? []);
    const tests = [...new Set(bin ? [...fromSmarttest, ...present.filter(isTestFile)] : fromGraph)];
    const dependents = reached.filter((f) => !isTestFile(f)).length;
    return [s.id, { files: s.files, newFiles: s.files.length - present.length, dependents, tests, source: bin ? "smarttest" : "imports" }];
  });
  return new Map(entries);
}

/** The tests worth running first, for the builder and the critic. */
export function impactBrief(impact: Impact): string {
  if (impact.files.length === 0) return "";
  const tests = impact.tests.slice(0, LISTED_TESTS);
  const more = impact.tests.length > LISTED_TESTS ? ` and ${impact.tests.length - LISTED_TESTS} more` : "";
  return [
    "## Blast radius (estimated before the build)",
    `Files: ${impact.files.join(", ")}${impact.newFiles ? ` (${impact.newFiles} new)` : ""}`,
    `Imported by ${impact.dependents} other files.`,
    tests.length > 0 ? `Tests that cover them, run these first: ${tests.join(", ")}${more}` : "No existing test covers these files: add one.",
  ].join("\n");
}
