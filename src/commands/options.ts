import type { parseArgs } from "node:util";

export const USAGE = `concerto [options] [request]

  --plan              score the request into user stories, print JSON and exit
  --run               score and build without the TUI, printing the log (scripts, CI)
  --yes               build right after scoring, without the confirm step
  --orca              start the run in a new Orca worktree, in its own terminal tab
  --budget <usd>      stop starting stories once a run has spent this (API-equivalent)
  --gate <command>    a check every story must pass before review, e.g. "pnpm test" (repeatable)
  --prefer <list>     providers to try first, e.g. ce-* or ce-gpt,openai
  --resume <id>       reopen a saved session (see /history) and build what did not pass
  --init              detect every linked AI and write your personal config
  --routing <choice>  with --init outside a terminal: subscriptions, proxy or api
  --probe             send each configured model a tiny prompt; failures are skipped for a day
  --doctor            what is installed, linked and reachable
  --models            reachable models, each role's chain and sample routes
  --stats             token and cache totals for this repository
  --install-skills    teach the agents on this machine (Claude Code, Codex, pi) to use Concerto
  --clear-cache       drop the local response cache
  -v, --version       print the version
  -h, --help          this help

In the TUI, type / for commands: /history /setup /config /models /budget /prefer /onboarding /help.
Docs: https://remipelloux.github.io/Concerto/ · built by github.com/RemiPelloux
Cheaper API access for GPT, Claude, DeepSeek and Grok behind one key (affiliate link):
https://codex-everywhere.com/home?aff=H9TB6LJQJMEU`;

export const OPTIONS = {
  plan: { type: "boolean" },
  run: { type: "boolean" },
  yes: { type: "boolean" },
  orca: { type: "boolean" },
  budget: { type: "string" },
  gate: { type: "string", multiple: true },
  resume: { type: "string" },
  prefer: { type: "string" },
  init: { type: "boolean" },
  routing: { type: "string" },
  doctor: { type: "boolean" },
  probe: { type: "boolean" },
  models: { type: "boolean" },
  stats: { type: "boolean" },
  "install-skills": { type: "boolean" },
  "clear-cache": { type: "boolean" },
  version: { type: "boolean", short: "v" },
  help: { type: "boolean", short: "h" },
} as const;

export type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>["values"];
