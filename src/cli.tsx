#!/usr/bin/env node
import { render } from "ink";
import { parseArgs } from "node:util";
import { loadConfig } from "./config/load.js";
import { ROLES, type ConcertoConfig } from "./config/types.js";
import { runHeadless } from "./headless.js";
import { loadCatalog } from "./models/catalog.js";
import { modelForRole, reviewerFor, routeStory } from "./models/router.js";
import type { ModelInfo } from "./models/types.js";
import { createConcert } from "./orchestrator/concert.js";
import { scoreRequest } from "./orchestrator/score.js";
import { runModel } from "./runner/index.js";
import { Store } from "./state/store.js";
import { App } from "./ui/App.js";

const USAGE = `concerto [request]

  --plan      score the request into user stories, print JSON and exit
  --run       score and perform without the TUI, printing the log (scripts, CI)
  --yes       perform the plan right after scoring, without the confirm step
  --models    print every reachable model, the role defaults and sample routes
  -h, --help  this help`;
const SAMPLES = [
  { label: "score 20", score: 20, tags: [] },
  { label: "score 60", score: 60, tags: [] },
  { label: "score 90", score: 90, tags: [] },
  { label: "ui, score 20", score: 20, tags: ["ui"] },
];
const COLUMN = 34;
const OPTIONS = {
  plan: { type: "boolean" },
  run: { type: "boolean" },
  yes: { type: "boolean" },
  models: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

type Setup = { config: ConcertoConfig; catalog: ModelInfo[]; store: Store; cwd: string };

function priceLabel(m: ModelInfo): string {
  return m.price ? `$${m.price.input}/$${m.price.output}` : "no price";
}

function printModels({ catalog, config }: Setup): void {
  const out = (line: string) => process.stdout.write(`${line}\n`);
  catalog.forEach((m) => out(`model  ${m.ref.padEnd(COLUMN)} tier ${m.tier}  ${priceLabel(m)}  x${m.costFactor}`));
  ROLES.forEach((r) => out(`role   ${r.padEnd(COLUMN)} ${modelForRole(catalog, config, r).ref}`));
  SAMPLES.forEach((s) => {
    const a = routeStory(s, catalog, config);
    out(`story  ${s.label.padEnd(COLUMN)} ${a.rule}: ${a.model.ref} (${a.effort}), reviewed by ${reviewerFor(s.tags, catalog, config).ref}`);
  });
}

async function setup(): Promise<Setup> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const catalog = await loadCatalog(config);
  const store = new Store();
  ROLES.forEach((role) => store.role(role, { model: modelForRole(catalog, config, role).ref }));
  return { config, catalog, store, cwd };
}

async function printPlan(s: Setup, request: string): Promise<void> {
  const plan = await scoreRequest(createConcert({ ...s, runner: runModel }), request);
  process.stdout.write(`${JSON.stringify({ ...plan, routing: s.store.get().stories }, null, 2)}\n`);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: OPTIONS });
  if (values.help) return void process.stdout.write(`${USAGE}\n`);
  const s = await setup();
  const request = positionals.join(" ").trim();
  if (values.models) return printModels(s);
  if ((values.plan || values.run) && !request) throw new Error("--plan and --run need a request.");
  if (values.plan) return printPlan(s, request);
  if (values.run) return runHeadless(createConcert({ ...s, runner: runModel }), request);
  const deps = { ...s, runner: runModel, autoPerform: Boolean(values.yes), initialRequest: request };
  await render(<App {...deps} />).waitUntilExit();
}

main().catch((error: unknown) => {
  process.stderr.write(`concerto: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
