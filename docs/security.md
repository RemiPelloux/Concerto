# Security

Concerto runs coding agents on your machine with your rights, and passes text from models into
prompts, commands and files. This page lists every place where model output reaches a shell, a
path or a file, what stands in the way, and what is left to you. Report a vulnerability through a
[private security advisory](https://github.com/RemiPelloux/Concerto/security/advisories/new).

## Turn on the sandbox

`"sandbox": { "enabled": true }` in the config, or `--sandbox`, runs every agent CLI and every
check inside the platform's sandbox:

- **Linux, with bubblewrap:**
  - The whole system is read-only.
  - The story's worktree, the repository's git folder and the agents' own state folders (`~/.claude`, `~/.codex`, `~/.pi`…) are writable.
  - `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube`, `~/.docker`, the `gh` and cloud CLI configs, `.netrc`, `.npmrc` and `.git-credentials` are hidden.
  - The process has its own empty network. Its only way out is Concerto's proxy, which lets through the model providers' hosts and the hosts in `sandbox.allowHosts`, and refuses the rest.
- **macOS, with `sandbox-exec`:** the same rules, written as a sandbox profile.
- **Elsewhere:** a run that asks for the sandbox refuses to start; it never runs without it. On Windows, use the Docker image.

Every refused host is in the run's log and in its audit log. Checks run sandboxed too, with no
network at all: the tests, and the acceptance commands the scorer writes.

## Where model output goes

| Where | What reaches it | What stands in the way |
|---|---|---|
| The agent CLIs' own tools | Every command an agent decides to run | The agent's permission mode (reviewers read-only), the sandbox, the audit log |
| Acceptance checks | Shell commands written by the scorer (`story.checks`) | Shown in the plan before you build; run in the story's worktree; in the sandbox with no network when enabled |
| Merging a story | Files the builder wrote | Paths come from git, never `..`. A symbolic link, or a path through one in either folder, is never merged: it could copy a file such as `~/.ssh/id_rsa` into the project, or write outside it. Fixed in 0.18. |
| Taking a story back | Files recorded at its merge | The same link rule; hunks go through `git apply`, which refuses paths beyond links |
| Secrets in a change | Anything the builder adds | Every diff is scanned before review: a key, a token or a password literal sends the story back, and it can never merge. Diffs on screen and shared pages are redacted. |
| Protected paths | Files under `policy.protectedPaths` | A story that changes one is sent back and can never merge |
| Local models (Ollama, LM Studio) | Tool calls with paths | Read, list and write only, inside the story's folder; no shell |
| The MCP server | A project path and a request from another agent | The path must be an absolute folder; stdio only, no network port; it runs with your rights, like the agent that started it |
| The GitHub Action | An issue's title, body and comment | Passed through the environment, never written into a shell line; only people with write access can start a run; a budget caps it |
| Shared pages and reports | Prompts, answers, logs | HTML-escaped, keys and tokens redacted |
| Prompts themselves | A repository's files and earlier answers | A builder may follow instructions planted in the code it reads. The sandbox, protected paths, the critic and the audit log are the defences; Concerto cannot tell a planted instruction from a real one. |

## The audit log

Each run writes `.concerto/audit/<run>.jsonl`, one line per action:

- every command an agent ran, in full
- every host the sandbox refused
- every change the policy or the secret scan refused

Each line is signed with a key kept in your config folder (`audit.key`, readable by you alone)
over itself and the line before it. A line that is changed, removed or moved breaks the chain from
there on.

## Network

- **Update check:** once a day Concerto asks GitHub for the latest release. Nothing about you or your project is sent, and `CONCERTO_NO_UPDATE_CHECK=1` turns it off. `concerto --update` runs the installer from this repository's main branch over HTTPS, or your package manager.
- **Traces:** sent only when an OTLP endpoint is set. Each trace carries the first 200 characters of the request.
- **Notifications:** sent only to the URLs you configure. They carry the summary, the story results and the cost, never code.

## Tests

- `tests/sandbox.test.ts`:
  - A real builder process tries to read a planted `~/.ssh` key and to reach example.com, directly and through the proxy. All three fail.
  - It reaches the one host it is allowed.
  - The audit log records the attempts and catches a tampered line.
- `tests/fuzz.test.ts`: thousands of random and malformed inputs for every backend's event parser, the plan parser, diffs, hunks, the secret scanner and the proxy's request reader. None may throw, and every event must keep its shape.
- `tests/worktree.test.ts`: a symbolic link to a key outside the project is never merged, and nothing is written through a linked folder.
