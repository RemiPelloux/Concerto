import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { basename } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { costCsv, costRows, costTable, isoWeek } from "#src/engine/costs.js";
import { renderDashboard } from "#src/engine/dashboard.js";
import { appendRun, readRuns, type RunRecord } from "#src/engine/run-log.js";
import { createConcert } from "#src/orchestrator/concert.js";
import { perform } from "#src/orchestrator/perform.js";
import { scoreRequest } from "#src/orchestrator/score.js";
import type { RunRequest } from "#src/runner/types.js";
import { Store } from "#src/state/store.js";
import { CATALOG, PLAN_REPLY, scriptedRunner, tempDir, testConfig } from "#tests/fixtures.js";

const DAY = 86_400_000;
const is = (r: RunRequest, role: string) => r.systemFile.includes(`${role}-`);
const passing = () => scriptedRunner((r) => (is(r, "scorer") ? PLAN_REPLY : is(r, "critic") ? "VERDICT: pass\nok" : is(r, "conductor") ? "VERDICT: ok\nok" : "STATUS: done\nok"));

async function run(cwd: string): Promise<void> {
  const c = await createConcert({ config: testConfig(), catalog: CATALOG, store: new Store(), runner: passing().runner, cwd });
  await scoreRequest(c, "add a health endpoint");
  await perform(c);
}

afterEach(() => vi.unstubAllEnvs());

describe("a week of runs, broken down without reading a log", () => {
  it("records every run, and reports cost by week, repository and model, as a table, CSV and a page", async () => {
    const [shop, blog] = [tempDir(), tempDir()];
    await run(shop);
    await run(blog);
    const recorded = readRuns();
    expect(recorded.map((r) => r.repo)).toEqual([shop, blog]);
    expect(recorded[0]?.slowest.map((s) => s.title).sort()).toEqual(["Add /health route", "Protect admin routes"]);
    const monday = Date.UTC(2026, 10, 9, 12);
    const spread: RunRecord[] = recorded.flatMap((r, i) => [0, 2, 4].map((d) => ({ ...r, at: monday + (d + i) * DAY })));
    spread.forEach(appendRun);
    const rows = costRows(readRuns().filter((r) => r.at < Date.UTC(2026, 10, 16)), monday);
    expect(new Set(rows.map((r) => r.week))).toEqual(new Set(["2026-W46"]));
    expect(new Set(rows.map((r) => basename(r.repo)))).toEqual(new Set([basename(shop), basename(blog)]));
    const [busiest = "", most] = Object.entries(recorded[0]?.models ?? {}).sort(([, a], [, b]) => b.calls - a.calls)[0] ?? [];
    expect(rows.find((r) => r.repo === shop && r.model === busiest)?.calls).toBe(3 * (most?.calls ?? 0));
    expect(rows.reduce((s, r) => s + r.costUsd, 0)).toBeCloseTo(3 * recorded.reduce((s, r) => s + r.costUsd, 0), 6);
    expect(costCsv(rows).split("\n")[0]).toBe("week,repository,model,calls,prompt_tokens,output_tokens,cost_usd");
    expect(costTable(rows)[0]).toMatch(/^2026-W46 {2}\$\d+\.\d\d$/);
    const page = renderDashboard(readRuns());
    expect(page).toContain(basename(shop));
    expect(page).toContain(busiest);
    expect(page).toContain("Add /health route");
    expect(page).toContain("2026-W46");
  });

  it("numbers weeks the ISO way across year ends", () => {
    expect(isoWeek(Date.UTC(2026, 0, 1))).toBe("2026-W01");
    expect(isoWeek(Date.UTC(2024, 11, 30))).toBe("2025-W01");
    expect(isoWeek(Date.UTC(2027, 0, 1))).toBe("2026-W53");
  });

  it("writes CSV that survives commas and quotes in a repository path", () => {
    const row = { week: "2026-W47", repo: '/srv/a,"b"', model: "x/y", calls: 1, promptTokens: 2, outputTokens: 3, costUsd: 0.5 };
    expect(costCsv([row]).split("\n")[1]).toBe('2026-W47,"/srv/a,""b""",x/y,1,2,3,0.5000');
  });
});

describe("OpenTelemetry traces", () => {
  it("sends the run, its stories and their model calls to the collector as one trace", async () => {
    const bodies: { resourceSpans: { scopeSpans: { spans: { name: string; spanId: string; parentSpanId?: string; kind: number; traceId: string; attributes: { key: string; value: Record<string, unknown> }[] }[] }[] }[] }[] = [];
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c: Buffer) => (raw += c.toString()));
      req.on("end", () => {
        if (req.url === "/v1/traces") bodies.push(JSON.parse(raw) as (typeof bodies)[number]);
        res.end("{}");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    await run(tempDir());
    server.close();
    const spans = bodies[0]?.resourceSpans[0]?.scopeSpans[0]?.spans ?? [];
    const root = spans.find((s) => s.name === "concerto.run");
    const stories = spans.filter((s) => s.name === "concerto.story");
    const chats = spans.filter((s) => s.name.startsWith("chat "));
    expect(stories.map((s) => s.parentSpanId)).toEqual([root?.spanId, root?.spanId]);
    expect(new Set(spans.map((s) => s.traceId)).size).toBe(1);
    const storyIds = new Set(stories.map((s) => s.spanId));
    expect(chats.filter((s) => storyIds.has(s.parentSpanId ?? "")).length).toBeGreaterThanOrEqual(4);
    const attrs = Object.fromEntries((chats.find((s) => storyIds.has(s.parentSpanId ?? ""))?.attributes ?? []).map((a) => [a.key, Object.values(a.value)[0]]));
    expect(attrs).toMatchObject({ "gen_ai.operation.name": "chat", "gen_ai.usage.input_tokens": "1000", "gen_ai.usage.output_tokens": "50" });
    expect(chats.every((s) => s.kind === 3)).toBe(true);
  });
});
