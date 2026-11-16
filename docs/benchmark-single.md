# Concerto against one model alone

Three small tasks, each solved twice in a fresh copy of its repository:

- once by `concerto --run`, with the maintainer's own config;
- once by Claude Code with Sonnet 5.5 alone, allowed to edit files and run the tests.

Then hidden tests that neither run saw grade the result. Before the runs, the hidden tests were
checked against correct reference solutions in three time zones.

The tasks are in [bench/single](../bench/single):

- **cart:** add discount codes, with a rounding rule and a shipping threshold.
- **days:** fix a day-count function that is off by one and wrong around daylight-saving changes.
- **slugify:** implement a slug function from a short spec.

Run it again with:

```sh
pnpm bench:single                       # one model: claude-sonnet-5-5
pnpm bench:single --model claude-opus-5-5
```

It uses your logins and your config, so it spends what such runs spend.

## Result

| Task | Who | Hidden tests passed | Cost (API-equivalent) | Time |
|---|---|---|---|---|
| cart | Concerto | 7/7 | $0.94 | 4.3 min |
| cart | claude-sonnet-5-5 alone | 6/7 | $0.18 | 0.5 min |
| days | Concerto | 7/7 | $1.39 | 3.4 min |
| days | claude-sonnet-5-5 alone | 7/7 | $0.22 | 0.7 min |
| slugify | Concerto | 7/7 | $0.43 | 1.6 min |
| slugify | claude-sonnet-5-5 alone | 7/7 | $0.15 | 0.4 min |
| **all** | Concerto | 21/21 | $2.76 | 9.3 min |
| **all** | claude-sonnet-5-5 alone | 20/21 | $0.55 | 1.5 min |

## What it says

- On tasks this small, one good model does nearly as well for far less. Concerto passed every
  hidden test and the single model missed one on the cart task, but Concerto cost five times as
  much and took six times as long. Its scoring, conductor checkpoints, test gate, critic and
  worktree merge are a fixed cost per story, and a one-file change does not pay it back.
- Concerto is built for larger requests: several stories that touch different parts of a
  repository, risky changes that deserve a second reviewer, and long runs where routing small
  stories to cheaper models and resuming sessions saves more than the overhead costs. This
  benchmark does not measure that yet. Larger tasks are the next to add to `bench/single`.
- Costs are API-equivalent, worked out from token counts at list prices. On a subscription,
  neither run was billed per token.

Three tasks are too few for a precise comparison: one hidden test is the whole difference in
quality here. Treat the cost and time ratios as the finding, and the pass rates as a sanity check.
