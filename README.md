<p align="center">
  <img src="assets/hero.svg" width="100%" alt="Concerto: a conductor model reviews the plan while builder, critic and swarm models work on scored user stories.">
</p>

<p align="center">
  <a href="https://github.com/RemiPelloux/Concerto/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/RemiPelloux/Concerto/ci.yml?branch=main&style=flat-square&label=CI&labelColor=111113"></a>
  <a href="https://remipelloux.github.io/Concerto/"><img alt="Docs" src="https://img.shields.io/badge/docs-github%20pages-E0A458?style=flat-square&labelColor=111113"></a>
  <img alt="Node 22+" src="https://img.shields.io/badge/node-22%2B-4FD08A?style=flat-square&labelColor=111113">
  <img alt="Backends: Claude Code, Codex, pi" src="https://img.shields.io/badge/backends-Claude%20Code%20%7C%20Codex%20%7C%20pi-B48CFF?style=flat-square&labelColor=111113">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-F3F1EC?style=flat-square&labelColor=111113"></a>
</p>

# Concerto

You describe a coding job in your terminal. Concerto splits it into user stories, measures how much
of your repository each one touches, and sends each story to the model that fits it. Opus 5.5
builds the hard and UI stories, GPT-6.1 Sol the rest. A critic tries to break every story, and
Fable 5.2 checks the plan at three checkpoints.

It runs on your Claude Code and ChatGPT subscriptions, and on any API key pi holds. Concerto never
sees a key. Full documentation: [remipelloux.github.io/Concerto](https://remipelloux.github.io/Concerto/)

## Quick start

You need Node 22+, pnpm 10, and at least one of these logged in: `claude` (Claude Code), `codex`
(Codex), `pi`.

```sh
git clone https://github.com/RemiPelloux/Concerto && cd Concerto
pnpm install
pnpm dev
```

The first launch tests every model you have with one tiny prompt, keeps the ones that answer, and
asks whether calls go through your subscriptions, your proxy or your API keys first. Then type a
request, for example `Add CSV export to invoices. Done means: the tests pass.`, press Enter to see
the scored stories, and Enter again to build them.

Agents edit files in the folder you start Concerto from. Use a git worktree or a clean branch.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Start the terminal UI |
| `pnpm dev "request"` | Start with a request already typed |
| `pnpm dev --plan "request"` | Show the scored stories as JSON, build nothing |
| `pnpm dev --run "request"` | Score and build without the UI, for scripts and CI |
| `pnpm dev --budget 5 ...` | Stop starting stories after $5 of API-equivalent spend |
| `pnpm dev --prefer 'ce-*' ...` | Try your proxy first for every model |
| `pnpm dev --init` | Detect and test your models again, rewrite your config |
| `pnpm dev --probe` | Retest the configured models |
| `pnpm dev --doctor` | What is installed, linked, skipped, and why |
| `pnpm dev --stats` | Tokens, cache hits and savings for this repository |

In the UI, Esc throws a plan away or stops a running build. After a build, the report is in
`.concerto/runs/`, ready to paste into a pull request.

## How a story is scored

The scorer model writes each story with points, complexity, risk, scope uncertainty and the files
it will touch. Concerto then measures those files in your repository and computes a score from 0
to 100 from ten factors:

| From the model | Weight | Measured in the repository | Weight |
|---|---|---|---|
| Complexity | 22% | Reach: files importing them, direct ones count double | 14% |
| Risk, never below 4/5 for auth, payments, migrations, CI | 16% | Coverage gap: touched code with no test | 10% |
| Effort (story points) | 10% | Size of the touched files | 8% |
| Scope uncertainty | 8% | Tests to run, churn over 90 days, areas touched | 4% each |

Tests come from [SmartTest](https://github.com/RemiPelloux/SmarttyTest) when the repository uses it,
otherwise from Concerto's own import graph (TypeScript, JavaScript, Python). A misremembered path is
matched to the real file. If a story names no file, the model's four factors decide alone. Every
score comes with its top three reasons, for example `why 64: complexity 4/5 · touches
src/auth/session.ts · 2 of 2 source files untested`.

The score picks the builder and its effort:

| Story | Builder | Reviewer |
|---|---|---|
| UI or UX | Opus 5.5 | GPT-6 Astra |
| Score 55 or more | Opus 5.5 | Sonnet 5.5 |
| Anything else | GPT-6.1 Sol | Sonnet 5.5 |

Effort follows the score: low under 25, medium under 50, high under 75, extra high above. Each
model has a fallback chain, so a rate limit or an outage moves the call to the next way of reaching
the same model. A story that fails review twice wakes the conductor, and its advice goes into one
last attempt.

## Saving tokens

- Claude Code starts without your plugins and MCP servers: about 600 tokens of context, not 131,000.
- System prompts are byte-identical between calls, so provider caches keep hitting.
- A resumed session is not sent what it already has.
- Critiques and logs lose noise (ANSI codes, spinners, repeated lines) before going back to a model.
- Scoring the same request twice is answered from a local cache, with no tokens spent.
- Agents are told to use [rtk](https://github.com/rtk-ai/rtk) when it is installed.

## Configuration

Your config is `~/.config/concerto/config.json`, written by the first launch. A
`concerto.config.json` in a project overrides it. Edit the routes, model chains, tiers, budget or
skills there. [examples/concerto.config.full.json](examples/concerto.config.full.json) shows a full
one with 37 working models.

Model names look like `claude-code/claude-opus-5-5` (Claude subscription), `codex/gpt-6.1-sol`
(ChatGPT subscription), `codex@ce-gpt/gpt-6.1-sol` (a Codex profile, such as a proxy), or
`openai/gpt-6.1-sol` (any provider in pi).

## Cheaper API access

When your subscriptions run out, an API gateway that serves GPT, Claude, DeepSeek and Grok behind
one key is the simplest fallback. I use [CodexEverywhere](https://codex-everywhere.com/home?aff=H9TB6LJQJMEU).
Add it to pi or as a Codex profile with providers named `ce-gpt`, `ce-claude`, `ce-deepseek` and
`ce-grok`, and Concerto picks them up.

*Affiliate link: I get a commission if you sign up through it, at no cost to you. Any
OpenAI-compatible provider works the same way.*

## Development

```sh
pnpm check                         # types, lint, tests, Pelloux audit
git config core.hooksPath .githooks
```

The code follows the [Pelloux Guidelines](https://github.com/RemiPelloux/pelloux-guidelines). The
pre-commit hook runs the tests your change can reach, through SmartTest. Security notes are in
[SECURITY.md](SECURITY.md).

## License

MIT
