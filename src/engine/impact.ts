import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { childEnv } from "../runner/env.js";
import { asArray, asRecord, parseJsonLine, str } from "../runner/json.js";
import { ImportGraph, isCodeFile, isTestFile } from "./import-graph.js";
import { PathMatcher } from "./paths.js";
import { areaOf, churnCounts, isSensitive } from "./signals.js";

const run = promisify(execFile);
const EXPLAIN_TIMEOUT_MS = 30_000;
const EXPLAIN_CONCURRENCY = 4;
const LISTED_TESTS = 10;

/** What a story reaches in the repository, measured before it is built. */
export type Impact = {
  /** Repository paths, misremembered ones corrected; paths that match nothing are new files. */
  files: string[];
  newFiles: number;
  /** Non-test files importing the story's files directly, and through 2 to 4 hops. */
  direct: number;
  indirect: number;
  tests: string[];
  sourceFiles: number;
  /** Source files no test covers: existing ones without tests, new ones without a test file. */
  untested: number;
  lines: number;
  /** Commits that touched these files in the last 90 days. */
  churn: number;
  areas: number;
  sensitive: string[];
  source: "smarttest" | "imports" | "none";
};

export const NO_IMPACT: Impact = {
  files: [], newFiles: 0, direct: 0, indirect: 0, tests: [], sourceFiles: 0, untested: 0, lines: 0, churn: 0, areas: 0, sensitive: [], source: "none",
};

type Context = { known: ReadonlySet<string>; graph: ImportGraph; explained: Map<string, string[]> | null; churn: Map<string, number>; perFile: Map<string, string[]> };

function smarttestBin(cwd: string): string | null {
  const bin = join(cwd, "node_modules", ".bin", "smarttest");
  return existsSync(bin) ? bin : null;
}

/** `smarttest explain <file> --json`: the tests protecting one file, through every import path. */
async function explain(bin: string, cwd: string, file: string): Promise<string[]> {
  try {
    const { stdout } = await run(bin, ["explain", file, "--json"], { cwd, timeout: EXPLAIN_TIMEOUT_MS, env: childEnv() });
    return asArray((parseJsonLine(stdout.trim()) ?? {}).tests).map((t) => str(asRecord(t).test)).filter(Boolean);
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

/** Tests covering one source file: SmartTest's answer, or the tests that import it. Memoized. */
function testsFor(ctx: Context, file: string): string[] {
  const known = ctx.explained?.get(file) ?? ctx.perFile.get(file);
  if (known) return known;
  const tests = [...ctx.graph.levels([file]).keys()].filter(isTestFile);
  ctx.perFile.set(file, tests);
  return tests;
}

function reachOf(ctx: Context, present: string[]): { direct: number; indirect: number } {
  const levels = [...ctx.graph.levels(present)].filter(([f]) => !isTestFile(f));
  return { direct: levels.filter(([, hop]) => hop === 1).length, indirect: levels.filter(([, hop]) => hop > 1).length };
}

const isSource = (f: string) => isCodeFile(f) && !isTestFile(f);

function coverageOf(ctx: Context, files: string[], present: string[]): { tests: string[]; untested: number } {
  const sources = present.filter(isSource);
  const covered = sources.map((f) => testsFor(ctx, f));
  const namesTest = files.some(isTestFile);
  const newSources = files.filter((f) => !ctx.known.has(f) && isSource(f)).length;
  const untested = covered.filter((t) => t.length === 0).length + (namesTest ? 0 : newSources);
  return { tests: [...new Set([...covered.flat(), ...present.filter(isTestFile)])], untested };
}

function measure(ctx: Context, files: string[], source: Impact["source"]): Impact {
  if (files.length === 0) return NO_IMPACT;
  const present = files.filter((f) => ctx.known.has(f));
  const lines = present.reduce((sum, f) => sum + ctx.graph.lines(f), 0);
  const churn = present.reduce((sum, f) => sum + (ctx.churn.get(f) ?? 0), 0);
  const sourceFiles = files.filter(isSource).length;
  const areas = new Set(files.map(areaOf)).size;
  const extra = { lines, churn, sourceFiles, areas, sensitive: files.filter(isSensitive), source };
  return { files, newFiles: files.length - present.length, ...reachOf(ctx, present), ...coverageOf(ctx, files, present), ...extra };
}

export type ImpactInput = { cwd: string; repoFiles: readonly string[]; stories: { id: string; files: string[] }[] };

/**
 * Every story's reach in one pass: one import graph, one `git log` and one SmartTest call per
 * distinct file for the whole plan. Tests come from SmartTest when the repository has it,
 * otherwise from the import graph.
 */
export async function analyzeImpact(input: ImpactInput): Promise<Map<string, Impact>> {
  const known = new Set(input.repoFiles);
  const matcher = new PathMatcher(known);
  const stories = input.stories.map((s) => ({ id: s.id, files: [...new Set(s.files.map((f) => matcher.match(f) ?? f))] }));
  const bin = smarttestBin(input.cwd);
  const existing = [...new Set(stories.flatMap((s) => s.files))].filter((f) => known.has(f) && isSource(f));
  const [explained, churn] = await Promise.all([bin ? explainAll(bin, input.cwd, existing) : null, churnCounts(input.cwd)]);
  const ctx: Context = { known, graph: new ImportGraph(input.cwd, input.repoFiles), explained, churn, perFile: new Map() };
  return new Map(stories.map((s) => [s.id, measure(ctx, s.files, bin ? "smarttest" : "imports")]));
}

/** What the builder and the critic should know before touching anything. */
export function impactBrief(impact: Impact): string {
  if (impact.files.length === 0) return "";
  const tests = impact.tests.slice(0, LISTED_TESTS);
  const more = impact.tests.length > LISTED_TESTS ? ` and ${impact.tests.length - LISTED_TESTS} more` : "";
  return [
    "## Blast radius (measured before the build)",
    `Files: ${impact.files.join(", ")}${impact.newFiles ? ` (${impact.newFiles} new)` : ""}`,
    `Imported directly by ${impact.direct} files, indirectly by ${impact.indirect}.`,
    impact.sensitive.length > 0 ? `Sensitive: ${impact.sensitive.join(", ")}. Check the failure paths twice.` : "",
    tests.length > 0 ? `Tests that cover them, run these first: ${tests.join(", ")}${more}` : "No existing test covers these files: add one.",
    impact.untested > 0 ? `${impact.untested} source files have no covering test: add tests with the change.` : "",
  ].filter(Boolean).join("\n");
}
