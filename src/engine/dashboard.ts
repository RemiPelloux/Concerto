import { basename } from "node:path";
import { costRows, isoWeek } from "#src/engine/costs.js";
import type { RunRecord } from "#src/engine/run-log.js";

const CENTS = 2;
const PERCENT = 100;
const MS_PER_SECOND = 1000;
const BAR_WIDTH = 320;
const SLOWEST = 10;

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const usd = (n: number) => `$${n.toFixed(CENTS)}`;
const table = (head: string[], rows: string[][]) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`;

/** Rows of label, bar and value: a bar chart in plain HTML, readable without scripts. */
function bars(entries: [string, number][]): string {
  const max = Math.max(...entries.map(([, v]) => v), Number.EPSILON);
  return entries.map(([label, v]) => `<div class="bar"><span>${esc(label)}</span><i style="width:${Math.round((v / max) * BAR_WIDTH)}px"></i><b>${usd(v)}</b></div>`).join("");
}

function byRepo(runs: readonly RunRecord[]): string {
  const repos = [...new Set(runs.map((r) => r.repo))];
  return table(["Repository", "Runs", "Stories passed", "Cost"], repos.map((repo) => {
    const mine = runs.filter((r) => r.repo === repo);
    const [passed, stories] = [mine.reduce((s, r) => s + r.passed, 0), mine.reduce((s, r) => s + r.stories, 0)];
    return [esc(basename(repo)), String(mine.length), `${passed}/${stories} (${stories ? Math.round((passed / stories) * PERCENT) : 0}%)`, usd(mine.reduce((s, r) => s + r.costUsd, 0))];
  }));
}

function byModel(runs: readonly RunRecord[]): string {
  const rows = costRows(runs);
  const models = [...new Set(rows.map((r) => r.model))];
  const sum = (m: string, k: "calls" | "costUsd" | "promptTokens") => rows.filter((r) => r.model === m).reduce((s, r) => s + r[k], 0);
  return table(["Model", "Calls", "Prompt tokens", "Cost"], models.sort((a, b) => sum(b, "costUsd") - sum(a, "costUsd")).map((m) => [esc(m), String(sum(m, "calls")), String(sum(m, "promptTokens")), usd(sum(m, "costUsd"))]));
}

function slowest(runs: readonly RunRecord[]): string {
  const stories = runs.flatMap((r) => r.slowest.map((s) => ({ ...s, repo: basename(r.repo) }))).sort((a, b) => b.ms - a.ms).slice(0, SLOWEST);
  return table(["Story", "Repository", "Time", "Result"], stories.map((s) => [esc(s.title), esc(s.repo), `${Math.round(s.ms / MS_PER_SECOND)} s`, s.status]));
}

/** Every recorded run, from every repository, as one page: totals, cost per week, repositories, models, slowest stories. */
export function renderDashboard(runs: readonly RunRecord[]): string {
  const weeks = [...new Set(runs.map((r) => isoWeek(r.at)))].sort();
  const perWeek = weeks.map((w): [string, number] => [w, runs.filter((r) => isoWeek(r.at) === w).reduce((s, r) => s + r.costUsd, 0)]);
  const [passed, stories, cost] = [runs.reduce((s, r) => s + r.passed, 0), runs.reduce((s, r) => s + r.stories, 0), runs.reduce((s, r) => s + r.costUsd, 0)];
  const style = ":root{color-scheme:light dark;--fg:#1d1f24;--bg:#fbfaf7;--bar:#b8862f}@media(prefers-color-scheme:dark){:root{--fg:#e8e6e1;--bg:#17181b}}body{font:14px/1.5 system-ui,sans-serif;color:var(--fg);background:var(--bg);max-width:64rem;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%;margin-bottom:2rem}td,th{border-bottom:1px solid #8884;padding:.3rem .5rem;text-align:left}.bar{display:flex;gap:.6rem;align-items:center}.bar span{width:7rem}.bar i{display:block;height:.9rem;background:var(--bar)}";
  return [
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Concerto dashboard</title><style>${style}</style></head><body>`,
    `<h1>Concerto</h1><p>${runs.length} runs · ${passed}/${stories} stories passed · ${usd(cost)} API-equivalent</p>`,
    `<h2>Cost per week</h2>${bars(perWeek)}`,
    `<h2>Repositories</h2>${byRepo(runs)}`,
    `<h2>Models</h2>${byModel(runs)}`,
    `<h2>Slowest stories</h2>${slowest(runs)}`,
    "</body></html>",
  ].join("\n");
}
