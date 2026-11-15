# Security

Concerto starts coding agents that edit files and run shell commands in the directory you start it
from. Treat a run like giving a contractor your working tree: start it in a git worktree or a clean
branch, and review the diff before you commit it. Concerto never commits.

## What Concerto does to limit the blast radius

- **No API keys.** Claude Code, Codex and pi keep their own credentials. Concerto never reads,
  stores or forwards them.
- **Allowlisted environment.** Agent processes get `PATH`, `HOME`, locale, proxy and git variables,
  plus the variables their own providers read (`ANTHROPIC_*`, `OPENAI_*`, `CLAUDE_CODE_OAUTH_TOKEN`,
  `CODEX_HOME`, `PI_*`, `DEEPSEEK_*`, `XAI_*`, `CE_*`). Everything else, such as cloud credentials
  or other tools' tokens, is dropped. Add names with `CONCERTO_ENV_PASSTHROUGH=NAME1,NAME2`.
- **Prompts on stdin.** Prompts never appear in process arguments, so other users on the machine
  cannot read them with `ps`.
- **Least privilege per role.** The conductor reads and the scorer has no tools. The critic reads
  and runs commands but cannot edit. Only builders edit. Codex runs reviewers in a `read-only`
  sandbox and builders in `workspace-write`. Claude Code starts without your user settings,
  plugins, hooks or MCP servers, with only the role's tools pre-approved.
- **Validated model output.** The scorer's plan is parsed with a strict schema. Story ids must be
  lowercase slugs, because they end up in session ids and file names. A plan has 24 stories at
  most, with unique ids.
- **Private local state.** `.concerto/` (prompts, response cache, stats, session logs) is created
  with `0700` directories and `0600` files, and is added to the repository's local git exclude so
  it never lands in a commit. Session logs hold agent output, so the 30 newest are kept. Cache entries are validated when read, and a corrupt entry is
  treated as a miss.
- **Timeouts.** Every call stops after `timeoutMinutes` (30 by default), and Esc in the TUI stops
  the whole run.
- **Supply chain.** CI pins every GitHub Action to a commit SHA, installs with
  `--frozen-lockfile`, runs `pnpm audit`, and pnpm does not run dependency install scripts.

## What it cannot do

Builders run the shell commands a model writes, with your user's permissions. Concerto does not
sandbox Claude Code or pi. Codex's `workspace-write` sandbox applies only to Codex. Section stories
run in parallel in the same tree, so set `swarm.maxParallel` to 1 if your stories touch shared files.

## Reporting a vulnerability

Open a private security advisory on GitHub:
https://github.com/RemiPelloux/Concerto/security/advisories/new
