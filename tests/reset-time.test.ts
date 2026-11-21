import { describe, expect, it } from "vitest";
import { resetAt } from "#src/models/reset-time.js";
import { blocked, pauseOnLimit } from "#src/models/quota.js";
import { tempDir } from "#tests/fixtures.js";
import { join } from "node:path";

/** 2026-11-16 14:00 UTC is 15:00 in Paris, a Monday. */
const NOW = Date.UTC(2026, 10, 16, 14, 0);
const at = (iso: string) => new Date(iso).getTime();

describe("the reset time a limit message names", () => {
  it("reads Claude Code's 5-hour limit: later today in the named zone", () => {
    expect(resetAt("You've hit your 5-hour limit · resets 6:40pm (Europe/Paris)", NOW)).toBe(at("2026-11-16T17:40:00Z"));
  });

  it("rolls over to tomorrow when the time has already passed today", () => {
    expect(resetAt("You've hit your 5-hour limit · resets 9am (Europe/Paris)", NOW)).toBe(at("2026-11-17T08:00:00Z"));
  });

  it("reads a weekly limit with a weekday", () => {
    expect(resetAt("You've hit your weekly limit · resets Thu 10am (Europe/Paris)", NOW)).toBe(at("2026-11-19T09:00:00Z"));
  });

  it("follows the zone's own offset, not the machine's", () => {
    expect(resetAt("resets 6:40pm (America/New_York)", NOW)).toBe(at("2026-11-16T23:40:00Z"));
  });

  it("keeps the wall-clock hour across a daylight-saving change", () => {
    // Paris leaves summer time in the night of 2026-10-25: 9am that day is 08:00 UTC, not 07:00.
    expect(resetAt("resets 9am (Europe/Paris)", Date.UTC(2026, 9, 24, 20, 0))).toBe(at("2026-10-25T08:00:00Z"));
  });

  it("returns null when no reset time is named, or the zone is unknown", () => {
    expect(resetAt("You've hit your usage limit.", NOW)).toBeNull();
    expect(resetAt("resets 6pm (Not/AZone)", NOW)).toBeNull();
  });
});

describe("pausing on Claude Code's limit message", () => {
  it("recognises it as a limit and pauses the account until the reset", () => {
    const path = join(tempDir(), "usage.jsonl");
    const message = "claude exited 1: You've hit your 5-hour limit · resets 6:40pm (Europe/Paris)";
    expect(pauseOnLimit("claude-code", message, path)).toBe(true);
    expect(blocked("claude-code", undefined, path)).toMatch(/^rate-limited until/);
  });
});
