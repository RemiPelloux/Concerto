import { clearCache, printModels, printStats } from "#src/commands/info.js";
import type { Values } from "#src/commands/options.js";
import { configPath, isFirstLaunch, loadConfig, withPolicy } from "#src/config/load.js";
import { keepSessions } from "#src/engine/history.js";
import { SessionLog } from "#src/engine/session-log.js";
import { ROLES, type ConcertoConfig } from "#src/config/types.js";
import { loadCatalog, type Catalog } from "#src/models/catalog.js";
import { firstOf } from "#src/models/router.js";
import { Store } from "#src/state/store.js";

export type Setup = { config: ConcertoConfig; catalog: Catalog; store: Store; cwd: string; log: SessionLog };

function overrides(values: Values): Partial<ConcertoConfig> {
  const budget = values.budget === undefined ? undefined : Number(values.budget);
  if (budget !== undefined && !(budget > 0)) throw new Error("--budget takes a positive number of dollars.");
  const prefer = values.prefer?.split(",").map((p) => p.trim()).filter(Boolean);
  const gates = values.gate?.map((g) => g.trim()).filter(Boolean);
  return { ...(prefer ? { prefer } : {}), ...(budget ? { budgetUsd: budget } : {}), ...(gates?.length ? { gates } : {}) };
}

async function setup(values: Values): Promise<Setup> {
  const cwd = process.cwd();
  const base = loadConfig(cwd);
  const sandbox = values.sandbox ? { sandbox: { ...base.sandbox, enabled: true } } : {};
  const config = withPolicy({ ...base, ...overrides(values), ...sandbox });
  const catalog = await loadCatalog(config);
  const log = SessionLog.current ?? new SessionLog(cwd);
  const store = new Store((kind, text) => log.write(kind, text));
  ROLES.forEach((role) => store.role(role, { model: firstOf(catalog, config, role)?.ref ?? "" }));
  keepSessions(store, { cwd, id: log.id });
  log.write("start", `concerto in ${cwd} · config ${configPath(cwd)} · ${catalog.models.length} models reachable`);
  log.write("start", `prefer ${config.prefer.join(",") || "-"} · budget ${config.budgetUsd ?? "-"} · roles ${ROLES.map((r) => `${r}=${store.get().roles[r].model}`).join(" ")}`);
  return { config, catalog, store, cwd, log };
}

async function printPlan(s: Setup, request: string, values: Values): Promise<void> {
  const [{ createConcert }, { scoreRequest }, { runModel }] = await Promise.all([
    import("#src/orchestrator/concert.js"), import("#src/orchestrator/score.js"), import("#src/runner/index.js"),
  ]);
  const concert = await createConcert({ ...s, runner: runModel, template: values.template });
  await scoreRequest(concert, request);
  const { plan, order, stories, paths } = s.store.get();
  if (!values.explain) return void process.stdout.write(`${JSON.stringify({ ...plan, routing: order.map((id) => stories[id]), paths }, null, 2)}\n`);
  const { explainLines } = await import("#src/commands/explain.js");
  explainLines(s.store.get(), concert.calibration).forEach((line) => process.stdout.write(`${line}\n`));
}

async function plain(s: Setup, request: string, values: Values): Promise<void> {
  const [{ createConcert }, { runPlain }, { runModel }] = await Promise.all([import("#src/orchestrator/concert.js"), import("#src/commands/plain.js"), import("#src/runner/index.js")]);
  await runPlain(await createConcert({ ...s, runner: runModel, template: values.template }), request, Boolean(values.yes));
}

async function headless(s: Setup, request: string, values: Values): Promise<void> {
  const [{ createConcert }, { runHeadless }, { runModel }, publish] = await Promise.all([
    import("#src/orchestrator/concert.js"), import("#src/headless.js"), import("#src/runner/index.js"), import("#src/commands/publish.js"),
  ]);
  const pr = await publish.prBranch(Boolean(values.pr), { cwd: s.cwd, request, session: s.log.id });
  const concert = await createConcert({ ...s, runner: runModel, template: values.template, commit: Boolean(values.commit || values.pr) });
  await runHeadless(concert, request, { log: s.log, json: Boolean(values.json) });
  if (pr) await publish.finishPr(concert, pr, Boolean(values.json));
}

async function shareSession(id: string): Promise<void> {
  const [{ readSession }, { writeShare }] = await Promise.all([import("#src/engine/history.js"), import("#src/engine/share.js")]);
  const state = readSession(process.cwd(), id);
  if (!state) throw new Error(`No saved session "${id}" in this project.`);
  process.stdout.write(`${writeShare(process.cwd(), id, state)}\n`);
}

async function updatePrices(): Promise<void> {
  const { updatePriceBook, priceBookPath } = await import("#src/models/price-book.js");
  const book = await updatePriceBook();
  const count = Object.values(book.providers).reduce((n, models) => n + Object.keys(models).length, 0);
  process.stdout.write(`${count} model prices from ${book.source}, saved in ${priceBookPath()}\n`);
}

/** Commands that need no model catalog. */
async function standalone(values: Values, request: string): Promise<boolean> {
  if (values.stats) return printStats(process.cwd()), true;
  if (values["update-prices"]) return await updatePrices(), true;
  if (values.share) return await shareSession(values.share), true;
  if (values.mcp) return await (await import("#src/commands/mcp.js")).runMcp(), true;
  if (values.costs) return (await import("#src/commands/costs.js")).printCosts({ since: values.since, csv: values.csv }), true;
  if (values.update) return (await import("#src/commands/update.js")).runUpdate(), true;
  if (values.dashboard) return (await import("#src/commands/costs.js")).writeDashboard(), true;
  if (values.insights) return (await import("#src/commands/insights.js")).insightsLines(process.cwd()).forEach((l) => process.stdout.write(`${l}\n`)), true;
  if (values["install-skills"]) return (await import("#src/commands/skills.js")).installSkills(), true;
  if (values.init) return await (await import("#src/commands/setup.js")).runInit(values.routing), true;
  if (values.orca) return await (await import("#src/commands/orca.js")).runInOrca(request), true;
  if (values.probe) return await (await import("#src/commands/setup.js")).runProbe(loadConfig(process.cwd())), true;
  return false;
}

/** Every command after argument parsing; modules load only for the command that runs. */
export async function run(values: Values, request: string): Promise<void> {
  if (await standalone(values, request)) return;
  const tui = !values.plan && !values.run && !values.plain && !values.models && !values.doctor && !values["clear-cache"];
  const firstLaunch = tui && process.stdin.isTTY && isFirstLaunch(process.cwd());
  if (firstLaunch) await (await import("#src/ui/launch.js")).runOnboarding();
  const s = await setup(values);
  if (values.doctor) return (await import("#src/setup/doctor.js")).printDoctor(s.cwd, await (await import("#src/setup/detect.js")).detect(), s);
  if (values["clear-cache"]) return clearCache(s.cwd, s.config);
  if (values.models) return printModels(s.catalog, s.config);
  if ((values.plan || values.run || values.plain) && !request) throw new Error("--plan, --run and --plain need a request.");
  if (values.plan) return printPlan(s, request, values);
  if (values.run) return headless(s, request, values);
  if (values.plain) return plain(s, request, values);
  return interactive(values, s, { request: values.resume ? `/history ${values.resume}` : request, tour: firstLaunch });
}

/** The TUI; `/setup` closes it, reruns onboarding with fresh detection, and opens it again. */
async function interactive(values: Values, first: Setup, start: { request: string; tour: boolean }): Promise<void> {
  const [{ launchTui, runOnboarding }, { runModel }] = await Promise.all([
    import("#src/ui/launch.js"), import("#src/runner/index.js"),
  ]);
  let s = first;
  for (let initial = start.request, tour = start.tour; ; initial = "", tour = false) {
    const reason = await launchTui({ ...s, runner: runModel, autoPerform: Boolean(values.yes), initialRequest: initial, showTour: tour });
    if (reason !== "setup") return;
    await runOnboarding();
    s = await setup(values);
  }
}
