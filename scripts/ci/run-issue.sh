#!/bin/sh
# Runs Concerto on an issue and opens a pull request: the body of the GitHub Action, kept in a
# script so it can be run and tested outside Actions. Everything it reads comes from the
# environment, never from text pasted into a shell line, so an issue cannot inject commands.
#
#   TITLE, BODY      the issue
#   COMMENT          the comment that asked for the run (`/concerto <more instructions>`), or empty
#   REQUEST          overrides all three when set
#   BUDGET           API-equivalent dollars the run may spend
#   EVENTS           where the JSON events go (outside the repository)
#   ISSUE            the issue number to answer, or empty
set -eu

if [ -z "${REQUEST:-}" ]; then
  extra=$(printf '%s' "${COMMENT:-}" | sed '1s|^/concerto[[:space:]]*||')
  REQUEST=$(printf '%s\n\n%s\n\n%s' "${TITLE:-}" "${BODY:-}" "$extra")
fi
if [ -z "$(printf '%s' "$REQUEST" | tr -d '[:space:]')" ]; then
  echo "Nothing to build: the issue has no title or body." >&2
  exit 1
fi

git config user.name >/dev/null || git config user.name "concerto[bot]"
git config user.email >/dev/null || git config user.email "concerto@users.noreply.github.com"

status=0
concerto --run --pr --json --budget "${BUDGET:-5}" "$REQUEST" > "$EVENTS" || status=$?
pr=$(sed -n 's/^{"type":"pr","url":"\([^"]*\)"}$/\1/p' "$EVENTS" | tail -n 1)
phase=$(sed -n 's/^{"type":"done","phase":"\([a-z]*\)".*/\1/p' "$EVENTS" | tail -n 1)

if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "pr=$pr" >> "$GITHUB_OUTPUT"; fi
if [ -n "${ISSUE:-}" ]; then
  if [ -n "$pr" ]; then note="Concerto opened $pr (run ${phase:-unknown})."; else note="Concerto ran (${phase:-failed}) and merged nothing, so there is no pull request. The workflow log has the details."; fi
  gh issue comment "$ISSUE" --body "$note"
fi
exit "$status"
