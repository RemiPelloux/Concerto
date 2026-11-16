import { copyFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseConfig } from "#src/config/load.js";
import { CONFIG_VERSION, migrateConfig, migrateFile } from "#src/config/migrate.js";
import { EventSchema } from "#src/events.js";
import { runHeadless } from "#src/headless.js";
import { createConcert } from "#src/orchestrator/concert.js";
import type { RunRequest } from "#src/runner/types.js";
import { Store } from "#src/state/store.js";
import { apiSurface } from "#scripts/api-surface.js";
import { CATALOG, PLAN_REPLY, scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

const OLD = join(import.meta.dirname, "fixtures-configs");
afterEach(() => vi.restoreAllMocks());

describe("1.0: what stays stable", () => {
  it("keeps the public surface: removing or renaming an entry needs a major version, adding one a regenerated docs/api-surface.json", () => {
    expect(readFileSync("docs/api-surface.json", "utf8").replace(/\r\n/g, "\n")).toBe(apiSurface());
  });

  it("reads every 0.x config, from the very first, and brings it to the current version", () => {
    const files = readdirSync(OLD);
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const f of files) {
      const raw = JSON.parse(readFileSync(join(OLD, f), "utf8")) as Record<string, unknown>;
      expect(raw.version, f).toBeUndefined();
      expect(parseConfig(raw, f).version).toBe(CONFIG_VERSION);
      expect(migrateConfig(raw, f)).toMatchObject({ from: 0, config: { version: CONFIG_VERSION, models: raw.models } });
    }
  });

  it("refuses a config from a newer Concerto, and --migrate-config rewrites a file once", () => {
    expect(() => migrateConfig({ version: CONFIG_VERSION + 1 }, "x.json")).toThrow(/x\.json was written by a newer Concerto \(config version 2; this one reads up to 1\)/);
    const file = join(tempDir(), "config.json");
    copyFileSync(join(OLD, "0.19.json"), file);
    expect(migrateFile(file)).toBe(true);
    expect((JSON.parse(readFileSync(file, "utf8")) as { version: number }).version).toBe(CONFIG_VERSION);
    expect(migrateFile(file)).toBe(false);
    writeFileSync(file, JSON.stringify({ version: "one" }));
    expect(() => migrateFile(file)).toThrow(/"version" must be a whole number/);
  });

  it("sends only events of the documented format in --json", async () => {
    const is = (r: RunRequest, role: string) => r.systemFile.includes(`${role}-`);
    const runner = scriptedRunner((r) => (is(r, "scorer") ? PLAN_REPLY : is(r, "critic") ? "VERDICT: pass\nok" : is(r, "conductor") ? "VERDICT: ok\nok" : "STATUS: done\nok")).runner;
    const concert = await createConcert({ config: testConfig(), catalog: CATALOG, store: new Store(), runner, cwd: tempDir() });
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((line) => out.push(String(line)) > 0);
    await runHeadless(concert, "add a health endpoint", { log: { id: "s-1", shownPath: "log" }, json: true });
    vi.restoreAllMocks();
    const events = out.map((l) => EventSchema.parse(JSON.parse(l)));
    expect(events[0]).toMatchObject({ type: "session", format: 1 });
    expect(events.at(-1)?.type).toBe("done");
    expect(EventSchema.safeParse({ type: "pr", url: null, reason: "nothing was merged" }).success).toBe(true);
  });
});
