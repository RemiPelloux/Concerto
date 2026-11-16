# Failure messages

This page lists every error Concerto stops with, as you see it after `concerto:` on the command
line, in the TUI or in an MCP reply. `<placeholders>` stand for the parts that change. Each row is
tested in `tests/failures.test.ts`: a test triggers the error through the code that throws it and
checks the message. Another test reads every `throw new Error(` in `src/` and fails the build when a
message has no row here, so a new error cannot ship undocumented.

## Command line

| Message | Why it happens | What to do |
|---|---|---|
| `--budget takes a positive number of dollars.` | `--budget` got zero, a negative number or something that is not a number. | Pass a dollar amount above zero, e.g. `--budget 2.5`. |
| `--plan, --run and --plain need a request.` | `--plan`, `--run` or `--plain` was given without the text of what to build. | Add the request: `concerto --plan "add a health endpoint"`. |
| `No saved session "<id>" in this project.` | `--share` named a session that is not in this folder's `.concerto/sessions/`. | Run it from the project the session belongs to, and copy the id from `/history`. |
| `--since takes a number of days.` | `--costs --since` got something that is not a number of days, zero or more. | Pass a whole number, e.g. `--costs --since 30`. |
| `--routing must be one of: <choices>.` | `--init --routing` got a value other than `subscriptions`, `proxy` or `api`. | Pick one of those three. |
| `orca <command> <subcommand> failed: <error>` | The Orca CLI answered `ok: false` while `--orca` created the worktree or its terminal. | Read Orca's error. Check that Orca is running and that this folder is a repository Orca knows. |
| `Orca did not return a worktree id.` | The Orca CLI said the worktree was created but gave no id, so Concerto cannot open a terminal in it. | Update Orca. `ORCA_CLI_COMMAND` can point Concerto at another Orca CLI. |

## Configuration

| Message | Why it happens | What to do |
|---|---|---|
| `invalid config in <file>: <field>: <problem>` | A field in the personal or project config has the wrong type or value. Each bad field gets its own line. | Fix the named field in the named file. `concerto.config.json` in the package shows every field with a valid value. |
| `invalid config in <file>: policy.requireReview: no custom review role named <role> in customRoles` | The policy requires a review role that `customRoles` does not define with `kind: "review"`. | Add the role to `customRoles`, or remove it from `policy.requireReview`. |

## Plans and edits

| Message | Why it happens | What to do |
|---|---|---|
| `The scorer did not return a JSON plan.` | The scoring model answered without a JSON object, often because it refused or ran out of output. | Run again. If it keeps happening, give the scorer role a stronger model. |
| `Template names are lowercase letters, digits and dashes, 48 at most.` | `/template` or `--template` got a name with capitals, spaces or other characters, or one over 48 characters. | Use a name like `api-endpoint`. |
| `No template "<name>". Saved: <templates>.` | `--template` named a template that was never saved. | Use one of the names listed, or save the plan's shape first with `/template <name>`. |
| `Edits change a plan waiting for Enter; there is none right now.` | A plan edit (`/drop`, `/merge`, `/route`…) was typed while no plan waits to be built. | Score a request first, and edit the plan before pressing Enter. |
| `No story "<id>" in the plan. Ids: <ids>.` | A story edit named an id the plan does not have. | Use one of the ids listed. |
| `No story "<id>" in the plan.` | `/route`, `/reviewer` or `/effort` named an id the plan does not have. | Use an id shown in the plan. |
| `A story cannot be merged into itself.` | `/merge` got the same story twice. | Name two different stories. |
| `"<id>" has one acceptance item: nothing to split it on.` | `/split` divides a story's acceptance items in two, and this story has only one. | Edit the story by hand, or leave it whole. |
| `A plan needs at least one story. Press Esc to discard it instead.` | `/drop` would remove the last story. | Press Esc to throw the plan away. |
| `"<model>" is not a reachable model. /models lists them.` | `/route` or `/reviewer` named a model that is not configured or not reachable now. | Pick a model from `/models`. |

## Runs and reviews

| Message | Why it happens | What to do |
|---|---|---|
| `Nothing to perform: score a request first.` | A build started with no plan. | Score a request, then build it. |
| `--commit and --pr need a git repository with isolation on: a commit holds one story's merged files.` | `--commit` or `--pr` ran outside a git repository, or with `isolation` set to `off`. | Run inside a git repository and set `isolation` to `worktree`. |
| `--commit and --pr need a clean working tree; commit or stash first: <changed files>` | The working tree has changes, which would end up mixed into a story's commit. | Commit or stash the files listed, then run again. |
| `/ask sends a story back after a run; wait for this one to end.` | `/ask` was typed while a run is still going. | Wait until the run is done or failed. |
| `No story "<id>" in this run.` | `/ask` named a story the run does not have. | Use an id from the run's report. |
| `There is no run in this session yet.` | `/hunks`, `/reject`, `/ask`, `/redo`, `/pause` or `/continue` was typed before any run. | Run a request first. |
| `Nothing merged for "<story>" in this run to take back.` | `/reject` named a story that merged nothing in this run. | Check the id with the run's report. Only merged stories can be rejected. |
| `No hunk <n> in "<story>". /hunks <story> lists them.` | `/reject <story> <n>` named a hunk number the story's change does not have. | Run `/hunks <story>` and use a number it lists. |
| `Unknown story "<id>".` | Concerto asked its state for a story it does not hold. This is a bug, not something a command can cause. | Report it with the session log the error names. |

## Models and backends

| Message | Why it happens | What to do |
|---|---|---|
| `` No configured model is reachable. Run `concerto --models`. `` | No model the role can use is installed, logged in and reachable. | Run `concerto --models` and `concerto --doctor`, then log into at least one agent CLI. |
| `The <role> needs a premium model (Claude Fable, Opus or Sonnet, GPT Astra or Sol) and none is reachable. Run /config auto.` | The conductor, scorer, critic and soloist never run on low-cost families (Haiku, DeepSeek, Grok, Flash, mini…), and those were the only models reachable. | Log in to a premium model, then `/config auto` assigns it; or give the role one in `/config`. |
| `Model "<ref>" must look like <backend>/<model>.` | A model reference in the config or a command has no backend, or no model after the slash. | Write it as `claude-code/claude-opus-5-5`, `codex/gpt-6-luna` or `ollama/qwen3:8b`. |
| `<url> answered <status>.` | `--update-prices` got an HTTP error from models.dev. | Try again later. The prices saved by the last successful update stay in use. |
| `<backend> answered <status>: <body>` | Ollama or LM Studio answered a request with an HTTP error, for example a model that is not pulled. | Read the body. For Ollama, `ollama pull <model>`; check that the server runs. |
| `<model> was still calling tools after 24 steps.` | A local model kept calling tools without giving an answer. | Give the role a larger model, or split the story. |

## Sandbox

| Message | Why it happens | What to do |
|---|---|---|
| `The sandbox needs bubblewrap (bwrap) with user namespaces; install it, or set sandbox.enabled to false.` | On Linux the sandbox runs agents and checks in bubblewrap, and `bwrap` is missing or cannot create user namespaces. | Install bubblewrap and allow unprivileged user namespaces, or turn the sandbox off. |
| `The sandbox runs on Linux (bubblewrap) and macOS (sandbox-exec); on this system set sandbox.enabled to false or run Concerto in its Docker image.` | An agent was to run sandboxed on a system other than Linux or macOS. | Turn the sandbox off, or run Concerto in its Docker image. |
| `The sandbox runs on Linux (bubblewrap) and macOS (sandbox-exec).` | A check command was to run sandboxed on a system other than Linux or macOS. | Turn the sandbox off, or run Concerto on Linux, macOS or in its Docker image. |

## MCP

| Message | Why it happens | What to do |
|---|---|---|
| `"<cwd>" is not an absolute path to a folder.` | A tool call passed a `cwd` that is relative or is not an existing folder. | Pass the project's absolute path. |
| `No saved plan "<session>" in <cwd>. concerto_sessions lists them.` | `concerto_build` named a session that does not exist or has no plan. | Use a session id from `concerto_plan` or `concerto_sessions`. |
| `No saved session "<session>" in <cwd>.` | `concerto_status` named a session that does not exist in that folder. | Use a session id from `concerto_sessions`, with the same `cwd`. |
