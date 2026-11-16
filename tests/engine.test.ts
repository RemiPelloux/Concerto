import { mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { BlastRadius } from "#src/engine/blast-radius.js";
import { analyzeImpact } from "#src/engine/impact.js";
import { collapseRepeats, condense } from "#src/engine/condense.js";
import { cacheHitRatio, EMPTY_LEDGER, record } from "#src/engine/ledger.js";
import { summarizeDirs } from "#src/engine/repo-map.js";
import { ResponseCache } from "#src/engine/response-cache.js";
import { assemble, normalizeForKey } from "#src/engine/segments.js";
import { Sessions } from "#src/engine/sessions.js";
import { readStats, saveRun } from "#src/engine/stats.js";
import { SystemPrompts } from "#src/engine/system-prompts.js";
import { toolchainNotes } from "#src/engine/toolchain.js";
import { CATALOG, expectOwnerOnly, tempDir } from "#tests/fixtures.js";

const RESULT = { text: "hi", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0 }, turns: 1 };

describe("condenser", () => {
  it("strips ANSI and progress noise, collapses repeats, keeps markdown rules", () => {
    const raw = "\x1b[31mFAIL\x1b[0m src/a.test.ts\n[=====>    ] 50%\nretry\nretry\nretry\n---\nnext";
    expect(condense(raw)).toBe("FAIL src/a.test.ts\nretry  (×3)\n---\nnext");
    expect(collapseRepeats(["a", "a", "b"])).toEqual(["a  (×2)", "b"]);
  });

  it("keeps head and tail of long output and leaves code blocks untouched", () => {
    const long = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    const out = condense(long, { maxLines: 10, maxLineChars: 50, headLines: 4 });
    expect(out.split("\n")).toEqual(["line 0", "line 1", "line 2", "line 3", "… 190 lines elided …", "line 194", "line 195", "line 196", "line 197", "line 198", "line 199"]);
    const code = "see\n```\n  keep   exact\n\n\n```\ndone";
    expect(condense(code)).toBe("see\n```\n  keep   exact\n\n\n```\ndone");
  });
});

describe("prompt segments", () => {
  it("drops empty segments and what the session already has", () => {
    const segments = [{ name: "snapshot", text: "files" }, { name: "empty", text: "  " }, { name: "story", text: "do it" }];
    const first = assemble(segments);
    expect(first.prompt).toBe("files\n\ndo it");
    const second = assemble(segments, new Set([first.hashes[0]!]));
    expect(second.prompt).toBe("(Context sent earlier in this session still applies: snapshot.)\n\ndo it");
    expect(second.skippedTokens).toBe(2);
    expect(normalizeForKey(" a \n\n b ")).toBe("a b");
  });

  it("tracks sent segments per session and model, only for resumable backends", () => {
    const sessions = new Sessions("/s", "run-1");
    const model = CATALOG.get("a/brain")!;
    const first = sessions.open("conductor", model)!;
    expect(first.resume).toBe(false);
    sessions.record(first, ["h1"]);
    const again = sessions.open("conductor", model)!;
    expect(again).toMatchObject({ id: first.id, resume: true });
    expect(again.sent.has("h1")).toBe(true);
    expect(sessions.open("conductor", CATALOG.get("a/builder")!)!.id).not.toBe(first.id);
    expect(sessions.open("x", { ...model, parsed: { ...model.parsed, backend: "codex" } })).toBeUndefined();
  });
});

describe("response cache", () => {
  it("stores owner-only entries, expires them, and ignores corrupt ones", () => {
    const dir = tempDir();
    const cache = new ResponseCache({ dir, ttlHours: 1, maxEntries: 10 });
    const key = cache.key(["model", "prompt"]);
    cache.set(key, RESULT);
    expect(cache.get(key)?.text).toBe("hi");
    expectOwnerOnly(join(dir, `${key}.json`));
    expect(new ResponseCache({ dir, ttlHours: 0, maxEntries: 10 }).get(key)).toBeNull();
    writeFileSync(join(dir, `${key}.json`), "{broken");
    expect(cache.get(key)).toBeNull();
  });

  it("runs identical concurrent calls once", async () => {
    const cache = new ResponseCache({ dir: tempDir(), ttlHours: 1, maxEntries: 10 });
    let runs = 0;
    const produce = async () => {
      runs += 1;
      return RESULT;
    };
    const [a, b] = await Promise.all([cache.once("k", produce), cache.once("k", produce)]);
    expect(runs).toBe(1);
    expect([a.hit, b.hit].sort()).toEqual(["inflight", "miss"]);
    expect((await cache.once("k", produce)).hit).toBe("local");
  });

  it("prunes the oldest entries beyond the limit", () => {
    const dir = tempDir();
    const cache = new ResponseCache({ dir, ttlHours: 1, maxEntries: 2 });
    ["a", "b", "c"].forEach((k, i) => {
      cache.set(k, RESULT);
      const t = new Date(Date.now() - (3 - i) * 1000);
      utimesSync(join(dir, `${k}.json`), t, t);
    });
    expect(cache.prune()).toBe(1);
    expect(readdirSync(dir).sort()).toEqual(["b.json", "c.json"]);
  });
});

describe("system prompts, toolchain, repo map", () => {
  it("writes one byte-stable file per role with the toolchain notes last", () => {
    const cwd = tempDir();
    const prompts = new SystemPrompts(cwd, toolchainNotes({ packageManager: "pnpm", rtk: true, smarttest: true }));
    const critic = prompts.file("critic");
    expect(prompts.file("critic")).toBe(critic);
    expect(prompts.file("section")).not.toBe(prompts.file("soloist"));
    const body = readFileSync(critic, "utf8");
    expect(body).toMatch(/You are the critic/);
    expect(body.trimEnd()).toMatch(/rtk/);
    expectOwnerOnly(critic);
    expect(toolchainNotes({ packageManager: "", rtk: false, smarttest: false })).toBe("");
  });

  it("summarizes large trees by directory", () => {
    expect(summarizeDirs(["src/a.ts", "src/b.ts", "README.md"])).toEqual(["src/ (2)", "./ (1)"]);
  });
});

describe("ledger and stats", () => {
  it("prices usage, the solo baseline and cache savings", () => {
    const usage = { input: 1_000_000, output: 0, cacheRead: 1_000_000, cacheWrite: 0, cost: 0 };
    const ledger = record(EMPTY_LEDGER, { usage, price: CATALOG.get("a/swarm")!.price, brain: CATALOG.get("a/brain")!.price });
    expect(ledger.usage.cost).toBeCloseTo(0.11);
    expect(ledger.soloCost).toBeCloseTo(8.8);
    expect(ledger.cacheSaved).toBeCloseTo(0.09);
    expect(cacheHitRatio(ledger.usage)).toBe(0.5);
  });

  it("adds each run to the repository totals", () => {
    const cwd = tempDir();
    saveRun(cwd, { ...EMPTY_LEDGER, localHits: 2 });
    const after = saveRun(cwd, { ...EMPTY_LEDGER, localHits: 3, fallbacks: 1 });
    expect(after).toMatchObject({ runs: 2, ledger: { localHits: 5, fallbacks: 1 } });
    expect(readStats(cwd).runs).toBe(2);
  });
});

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, readFileSync: vi.fn(fs.readFileSync) };
});

vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, readdir: vi.fn(fs.readdir) };
});

describe("run repository scan cache", () => {
  it("reads sources once across stories and analyses, and a new run reads unchanged ones from the parse cache", async () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, "a.ts"), "export const a = 1;");
    writeFileSync(join(cwd, "a.test.ts"), 'import { a } from "./a";');
    const cache = new BlastRadius(cwd, ["a.ts", "a.test.ts"]);
    const input = { cwd, repoFiles: ["a.ts", "a.test.ts"], cache, stories: [{ id: "a", files: ["a.ts"] }, { id: "b", files: ["a.ts"] }] };
    vi.mocked(readFileSync).mockClear();
    vi.mocked(readdir).mockClear();
    const first = await analyzeImpact(input);
    const second = await analyzeImpact(input);
    expect(first.get("a")?.tests).toEqual(["a.test.ts"]);
    expect(second).toEqual(first);
    const reads = () => vi.mocked(readFileSync).mock.calls.filter(([path]) => String(path).startsWith(cwd) && !String(path).includes(".concerto"));
    expect(reads()).toHaveLength(2);
    expect(vi.mocked(readdir).mock.calls.filter(([path]) => String(path).startsWith(cwd))).toHaveLength(1);
    expect((await analyzeImpact({ ...input, cache: new BlastRadius(cwd, input.repoFiles) })).get("a")?.tests).toEqual(["a.test.ts"]);
    expect(reads()).toHaveLength(2);
  });

  it("refreshes imports, line counts and file membership after edits, additions and deletions", async () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, "a.ts"), "export const a = 1;");
    mkdirSync(join(cwd, "tests"));
    const cache = new BlastRadius(cwd, ["a.ts"]);
    const input = { cwd, repoFiles: ["a.ts"], cache, stories: [{ id: "a", files: ["a.ts"] }] };
    expect((await analyzeImpact(input)).get("a")?.tests).toEqual([]);
    writeFileSync(join(cwd, "tests/a.test.ts"), 'import { a } from "../a";');
    expect((await analyzeImpact(input)).get("a")?.tests).toEqual(["tests/a.test.ts"]);
    writeFileSync(join(cwd, "a.ts"), "export const a = 1;\nexport const b = 2;");
    expect((await analyzeImpact(input)).get("a")?.lines).toBe(2);
    writeFileSync(join(cwd, "tests/a.test.ts"), "export {};");
    expect((await analyzeImpact(input)).get("a")?.tests).toEqual([]);
    rmSync(join(cwd, "a.ts"));
    expect((await analyzeImpact(input)).get("a")?.newFiles).toBe(1);
  });
});

const coverageProcess = vi.hoisted(() => ({ enabled: false, calls: 0, fail: false }));

vi.mock("node:child_process", async (original) => {
  const cp = await original<typeof import("node:child_process")>();
  const { promisify } = await import("node:util");
  const run = promisify(cp.execFile);
  const execFile = (...args: unknown[]) => Reflect.apply(cp.execFile, undefined, args);
  Object.assign(execFile, { [promisify.custom]: async (bin: string, args: string[], options: object) => {
    if (!coverageProcess.enabled || !args.some((arg) => /[\\/]smarttest$/.test(arg))) return run(bin, args, options);
    coverageProcess.calls += 1;
    if (coverageProcess.fail) throw new Error("SmartTest unavailable");
    return { stdout: JSON.stringify({ target: args.at(-1), tests: [{ test: "a.test.ts" }] }), stderr: "" };
  } });
  return { ...cp, execFile };
});

describe("run coverage cache", () => {
  it("explains each distinct file once and refreshes coverage after repository changes", async () => {
    const cwd = tempDir();
    mkdirSync(join(cwd, "node_modules/.bin"), { recursive: true });
    const bin = join(cwd, "node_modules/.bin/smarttest");
    writeFileSync(bin, "fixture");
    writeFileSync(join(cwd, "a.ts"), "export const a = 1;");
    const cache = new BlastRadius(cwd, ["a.ts"]);
    const input = { cwd, repoFiles: ["a.ts"], cache, stories: [{ id: "a", files: ["a.ts"] }, { id: "b", files: ["a.ts"] }] };
    Object.assign(coverageProcess, { enabled: true, calls: 0, fail: false });
    try {
      expect((await analyzeImpact(input)).get("a")?.tests).toEqual(["a.test.ts"]);
      await analyzeImpact(input);
      expect(coverageProcess.calls).toBe(1);
      writeFileSync(join(cwd, "a.ts"), "export const a = 2;");
      await analyzeImpact(input);
      expect(coverageProcess.calls).toBe(2);
      coverageProcess.fail = true;
      writeFileSync(bin, "changed fixture");
      expect((await analyzeImpact(input)).get("a")?.untested).toBe(1);
    } finally {
      coverageProcess.enabled = false;
    }
  });
});
