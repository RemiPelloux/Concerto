import type { parseArgs } from "node:util";

export const USAGE = `concerto [options] [request]

  --plan              score the request into user stories, print JSON and exit
  --explain           with --plan: say why each story got its score, model and estimate, in words
  --template <name>   plan in the shape of a saved template (see /template)
  --run               score and build without the TUI, printing the log (scripts, CI)
  --yes               build right after scoring, without the confirm step
  --orca              start the run in a new Orca worktree, in its own terminal tab
  --budget <usd>      stop starting stories once a run has spent this (API-equivalent)
  --prefer <list>     providers to try first, e.g. ce-* or ce-gpt,openai
  --resume <id>       reopen a saved session (see /history) and build what did not pass
  --share <id>        write a saved session as one HTML file, secrets redacted
  --mcp               serve Concerto to other agents as MCP tools on stdio
  --costs             what runs cost, by week, repository and model (--since <days>, --csv)
  --dashboard         write a page of every run: costs, pass rates, slowest stories
  --plain             the run as plain sentences, for screen readers (asks before building; --yes skips)
  --sandbox           run every agent in the sandbox: network only to model providers, secrets hidden
  --update            update Concerto the way it was installed (Homebrew, Scoop, Nix, the installer)
  --json              with --run: one JSON event per line (session, log, story, done, pr)
  --commit            with --run: commit each merged story on its own (clean tree needed)
  --pr                with --run: a new branch, a commit per story, then a pull request (gh)
  --init              detect every linked AI and write your personal config
  --routing <choice>  with --init outside a terminal: subscriptions, proxy or api
  --probe             send each configured model a tiny prompt; failures are skipped for a day
  --doctor            what is installed, linked and reachable
  --models            reachable models, each role's chain and sample routes
  --stats             token and cache totals for this repository
  --insights          what past runs say: pass rate and cost per model, files that keep failing
  --update-prices     fetch current model prices from models.dev for estimates and budgets
  --install-skills    teach the agents on this machine (Claude Code, Codex, pi) to use Concerto
  --clear-cache       drop the local response cache
  -v, --version       print the version
  -h, --help          this help

In the TUI, type / for commands: /history /setup /config /models /budget /prefer /onboarding /help.
Docs: https://remipelloux.github.io/Concerto/ · built by tkmremi
Cheaper API access for GPT, Claude, DeepSeek and Grok behind one key (affiliate link):
https://codex-everywhere.com/home?aff=H9TB6LJQJMEU`;

export const OPTIONS = {
  plan: { type: "boolean" },
  explain: { type: "boolean" },
  template: { type: "string" },
  run: { type: "boolean" },
  yes: { type: "boolean" },
  orca: { type: "boolean" },
  budget: { type: "string" },
  resume: { type: "string" },
  share: { type: "string" },
  mcp: { type: "boolean" },
  costs: { type: "boolean" },
  csv: { type: "boolean" },
  since: { type: "string" },
  dashboard: { type: "boolean" },
  update: { type: "boolean" },
  sandbox: { type: "boolean" },
  plain: { type: "boolean" },
  json: { type: "boolean" },
  commit: { type: "boolean" },
  pr: { type: "boolean" },
  prefer: { type: "string" },
  init: { type: "boolean" },
  routing: { type: "string" },
  doctor: { type: "boolean" },
  probe: { type: "boolean" },
  models: { type: "boolean" },
  stats: { type: "boolean" },
  insights: { type: "boolean" },
  "update-prices": { type: "boolean" },
  "install-skills": { type: "boolean" },
  "clear-cache": { type: "boolean" },
  version: { type: "boolean", short: "v" },
  help: { type: "boolean", short: "h" },
} as const;

export type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>["values"];
