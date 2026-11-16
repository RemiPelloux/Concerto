import { describe, expect, it } from "vitest";
import { hunksOf } from "#src/engine/review-work.js";
import { findSecrets, scrub } from "#src/engine/secrets.js";
import { headline, readTag } from "#src/orchestrator/briefs.js";
import { parsePlan } from "#src/orchestrator/plan.js";
import { aiderParser } from "#src/runner/aider.js";
import { parseClaudeLine } from "#src/runner/claude.js";
import { codexParser } from "#src/runner/codex.js";
import { cursorParser } from "#src/runner/cursor.js";
import { parseLine, type RunEvent } from "#src/runner/events.js";
import { geminiParser } from "#src/runner/gemini.js";
import { gooseParser } from "#src/runner/goose.js";
import { opencodeParser } from "#src/runner/opencode.js";
import { target } from "#src/runner/proxy.js";
import { sideBySide } from "#src/ui/side-by-side.js";

const RUNS = 3000;

/** A small seeded generator (mulberry32): the same inputs on every run, so a failure can be replayed. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KEYS = ["type", "message", "content", "text", "usage", "item", "part", "event", "tool_call", "result", "stats", "status", "subtype", "role", "args", "input", "tokens", "id", "command", "error", "stories", "summary"];
const WORDS = ["assistant", "user", "tool_use", "text", "result", "message_end", "item.completed", "turn.completed", "step_finish", "tool_call", "started", "complete", "success", "error", "VERDICT:", "STATUS:", "{", "}", "@@", "+++ b/x", "-", "+", "\u0000", "💥", "\n"];

/** Random JSON-ish values, nested, mixing the keys and words the parsers look for. */
function value(r: () => number, depth: number): unknown {
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)] as T;
  const kind = Math.floor(r() * (depth > 3 ? 4 : 7));
  if (kind === 0) return pick(WORDS);
  if (kind === 1) return Math.floor(r() * 1e9) * (r() < 0.2 ? -1 : 1);
  if (kind === 2) return r() < 0.5 ? null : r() < 0.5;
  if (kind === 3) return "x".repeat(Math.floor(r() * 300));
  if (kind === 4) return Array.from({ length: Math.floor(r() * 4) }, () => value(r, depth + 1));
  return Object.fromEntries(Array.from({ length: Math.floor(r() * 5) }, () => [pick(KEYS), value(r, depth + 1)]));
}

/** A line as a CLI might print it: valid JSON, truncated JSON, or plain noise. */
function line(r: () => number): string {
  const json = JSON.stringify(value(r, 0)) ?? "";
  const roll = r();
  if (roll < 0.6) return json;
  if (roll < 0.8) return json.slice(0, Math.floor(r() * json.length));
  return Array.from({ length: Math.floor(r() * 12) }, () => WORDS[Math.floor(r() * WORDS.length)]).join(" ");
}

/** Every event a parser returns must be one Concerto knows, with the fields the UI reads. */
function wellFormed(e: RunEvent | null): boolean {
  if (e === null) return true;
  if (e.kind === "text") return typeof e.delta === "string";
  if (e.kind === "tool") return typeof e.name === "string" && typeof e.detail === "string";
  if (e.kind === "error") return typeof e.message === "string";
  return e.kind === "turn" && typeof e.text === "string" && Object.values(e.usage).every((n) => Number.isFinite(n));
}

describe("fuzzing what models and CLIs send back", () => {
  it("never throws on any backend's event lines, and returns only well-formed events", () => {
    const parsers: [string, () => (l: string) => RunEvent | null][] = [
      ["pi", () => parseLine], ["claude", () => parseClaudeLine], ["codex", codexParser], ["gemini", geminiParser],
      ["cursor", cursorParser], ["opencode", opencodeParser], ["goose", gooseParser], ["aider", aiderParser],
    ];
    for (const [name, make] of parsers) {
      const r = rng(name.length * 7919);
      const parse = make();
      for (let i = 0; i < RUNS; i += 1) {
        const input = line(r);
        let event: RunEvent | null = null;
        expect(() => (event = parse(input)), `${name}: ${input}`).not.toThrow();
        expect(wellFormed(event), `${name}: ${input}`).toBe(true);
      }
    }
  });

  it("the plan parser accepts a valid plan or throws a plain Error, nothing else", () => {
    const r = rng(42);
    for (let i = 0; i < RUNS; i += 1) {
      const reply = r() < 0.5 ? line(r) : `Here is the plan:\n${JSON.stringify({ summary: value(r, 2), stories: value(r, 1) })}`;
      try {
        const plan = parsePlan(reply);
        expect(Array.isArray(plan.stories) && plan.stories.length > 0, reply).toBe(true);
      } catch (error) {
        expect(error, reply).toBeInstanceOf(Error);
      }
    }
  });

  it("tags, diffs, hunks, secrets and proxy requests survive any text", () => {
    const r = rng(7);
    for (let i = 0; i < RUNS; i += 1) {
      const text = Array.from({ length: 1 + Math.floor(r() * 8) }, () => line(r)).join("\n");
      expect(() => [readTag(text, "VERDICT"), headline(text, "STATUS"), sideBySide(text), hunksOf(text), findSecrets(text), scrub(text), target(text)]).not.toThrow();
    }
  });
});
