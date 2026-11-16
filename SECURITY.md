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
  cannot read them with `ps`. On Windows the agent CLIs are `.cmd` shims started through
  `cmd.exe`; every argument is quoted by cross-spawn, so a model id or path cannot inject a command.
- **Codex in a git worktree.** Builders get write access to the repository's git data with
  `--add-dir`, and nothing else outside the folder.
- **One worktree per story.** Each story builds in its own git worktree, started from a snapshot
  commit made in a throwaway index: your index, HEAD and branches are never touched. Your folder
  changes only through Concerto's three-way merge of a story that passed, all files or none.
- **Acceptance checks are model-written commands.** The scorer may write up to five shell
  commands per story (300 characters each), told never to install, delete or reach the network.
  Concerto runs them in the story's worktree with the same allowlisted environment and timeout as
  the agents. A builder can run any command anyway; these are no more trusted than that.
- **Least privilege per role.** The conductor reads and the scorer has no tools. The critic reads
  and runs commands but cannot edit. Only builders edit. Codex runs reviewers in a `read-only`
  sandbox and builders in `workspace-write`. Claude Code starts without your user settings,
  plugins, hooks or MCP servers, with only the role's tools pre-approved.
- **Validated model output.** The scorer's plan is parsed with a strict schema. Story ids must be
  lowercase slugs, because they end up in session ids and file names. A plan has 24 stories at
  most, with unique ids.
- **Private local state.** `.concerto/` (prompts, response cache, stats, session logs and saved
  sessions) is created with `0700` directories and `0600` files, and is added to the repository's
  local git exclude so it never lands in a commit. Session logs and saved sessions hold agent
  output, so only the 30 newest are kept. Cache entries are validated when read, and a corrupt
  entry is treated as a miss. On Windows these permission bits do not exist; the files inherit the
  folder's access rules, which by default allow only your user under your profile.
- **Timeouts.** Every call stops after `timeoutMinutes` (30 by default), and Esc in the TUI stops
  the whole run.
- **Supply chain.** CI pins every GitHub Action to a commit SHA, installs with
  `--frozen-lockfile`, runs `pnpm audit`, and pnpm does not run dependency install scripts.
  Release packages are built in CI from the tagged commit and installed and run on Linux, macOS
  and Windows before they are attached. The installers only ever replace a folder that holds a
  Concerto install.

## What it cannot do

Builders run the shell commands a model writes, with your user's permissions. Concerto does not
sandbox Claude Code or pi. Codex's `workspace-write` sandbox applies only to Codex. A worktree
keeps a builder's edits out of your folder until they are merged, but it is not a sandbox: a
builder can still read and write anywhere your user can. Outside a git repository, or with
`"isolation": "off"`, stories run in parallel in the folder itself; set `swarm.maxParallel` to 1
there if your stories touch shared files.

## Reporting a vulnerability

Open a private security advisory on GitHub:
https://github.com/RemiPelloux/Concerto/security/advisories/new
