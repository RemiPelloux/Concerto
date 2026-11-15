import { readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collapseRepeats, condense } from "#src/engine/condense.js";
import { cacheHitRatio, EMPTY_LEDGER, record } from "#src/engine/ledger.js";
import { summarizeDirs } from "#src/engine/repo-map.js";
import { ResponseCache } from "#src/engine/response-cache.js";
import { assemble, normalizeForKey } from "#src/engine/segments.js";
import { Sessions } from "#src/engine/sessions.js";
import { readStats, saveRun } from "#src/engine/stats.js";
import { SystemPrompts } from "#src/engine/system-prompts.js";
import { toolchainNotes } from "#src/engine/toolchain.js";
import { CATALOG, tempDir } from "#tests/fixtures.js";

const RESULT = { text: "hi", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0 }, turns: 1 };
const OWNER_ONLY = 0o600;
const PERMISSION_BITS = 0o777;

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
    expect(statSync(join(dir, `${key}.json`)).mode & PERMISSION_BITS).toBe(OWNER_ONLY);
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
    expect(statSync(critic).mode & PERMISSION_BITS).toBe(OWNER_ONLY);
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
