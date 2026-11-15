#!/usr/bin/env node
import { render } from "ink";
import { parseArgs } from "node:util";
import { clearCache, printModels, printStats } from "./commands/info.js";
import { runInit, runOnboarding, runProbe } from "./commands/setup.js";
import { isFirstLaunch, loadConfig } from "./config/load.js";
import { ROLES, type ConcertoConfig } from "./config/types.js";
import { runHeadless } from "./headless.js";
import { loadCatalog, type Catalog } from "./models/catalog.js";
import { roleChain } from "./models/router.js";
import { createConcert } from "./orchestrator/concert.js";
import { scoreRequest } from "./orchestrator/score.js";
import { runModel } from "./runner/index.js";
import { detect } from "./setup/detect.js";
import { printDoctor } from "./setup/doctor.js";
import { Store } from "./state/store.js";
import { App } from "./ui/App.js";

const USAGE = `concerto [options] [request]

  --plan              score the request into user stories, print JSON and exit
  --run               score and build without the TUI, printing the log (scripts, CI)
  --yes               build right after scoring, without the confirm step
  --budget <usd>      stop starting stories once a run has spent this (API-equivalent)
  --prefer <list>     providers to try first, e.g. ce-* or ce-gpt,openai
  --init              detect every linked AI and write your personal config
  --routing <choice>  with --init outside a terminal: subscriptions, proxy or api
  --probe             send each configured model a tiny prompt; failures are skipped for a day
  --doctor            what is installed, linked and reachable
  --models            reachable models, each role's chain and sample routes
  --stats             token and cache totals for this repository
  --clear-cache       drop the local response cache
  -h, --help          this help`;

const OPTIONS = {
  plan: { type: "boolean" },
  run: { type: "boolean" },
  yes: { type: "boolean" },
  budget: { type: "string" },
  prefer: { type: "string" },
  init: { type: "boolean" },
  routing: { type: "string" },
  doctor: { type: "boolean" },
  probe: { type: "boolean" },
  models: { type: "boolean" },
  stats: { type: "boolean" },
  "clear-cache": { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>["values"];
type Setup = { config: ConcertoConfig; catalog: Catalog; store: Store; cwd: string };

function overrides(values: Values): Partial<ConcertoConfig> {
  const budget = values.budget === undefined ? undefined : Number(values.budget);
  if (budget !== undefined && !(budget > 0)) throw new Error("--budget takes a positive number of dollars.");
  const prefer = values.prefer?.split(",").map((p) => p.trim()).filter(Boolean);
  return { ...(prefer ? { prefer } : {}), ...(budget ? { budgetUsd: budget } : {}) };
}

async function setup(values: Values): Promise<Setup> {
  const cwd = process.cwd();
  const config = { ...loadConfig(cwd), ...overrides(values) };
  const catalog = await loadCatalog(config);
  const store = new Store();
  ROLES.forEach((role) => store.role(role, { model: roleChain(catalog, config, role)[0]?.ref ?? "" }));
  return { config, catalog, store, cwd };
}

async function printPlan(s: Setup, request: string): Promise<void> {
  await scoreRequest(await createConcert({ ...s, runner: runModel }), request);
  const { plan, order, stories } = s.store.get();
  process.stdout.write(`${JSON.stringify({ ...plan, routing: order.map((id) => stories[id]) }, null, 2)}\n`);
}

async function interactive(s: Setup, values: Values, request: string): Promise<void> {
  const deps = { ...s, runner: runModel, autoPerform: Boolean(values.yes), initialRequest: request };
  await render(<App {...deps} />).waitUntilExit();
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: OPTIONS });
  const request = positionals.join(" ").trim();
  if (values.help) return void process.stdout.write(`${USAGE}\n`);
  if (values.stats) return printStats(process.cwd());
  if (values.init) return runInit(values.routing);
  if (values.probe) return runProbe(loadConfig(process.cwd()));
  const tui = !values.plan && !values.run && !values.models && !values.doctor && !values["clear-cache"];
  if (tui && process.stdin.isTTY && isFirstLaunch(process.cwd())) await runOnboarding();
  const s = await setup(values);
  if (values.doctor) return printDoctor(s.cwd, await detect(), s);
  if (values["clear-cache"]) return clearCache(s.cwd, s.config);
  if (values.models) return printModels(s.catalog, s.config);
  if ((values.plan || values.run) && !request) throw new Error("--plan and --run need a request.");
  if (values.plan) return printPlan(s, request);
  if (values.run) return runHeadless(await createConcert({ ...s, runner: runModel }), request);
  return interactive(s, values, request);
}

// `concerto --models | head` closes the pipe early: that is the reader's choice, not an error.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

main().catch((error: unknown) => {
  process.stderr.write(`concerto: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
