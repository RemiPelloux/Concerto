import { Box, Text } from "ink";
import type { State, StoryView } from "#src/state/types.js";
import { COLOR } from "#src/ui/theme.js";

const TITLE = 40;
const CENTS = 2;

/** Stories of the plan that did not pass: what Enter retries after a run. */
export function unfinished(state: State): StoryView[] {
  return state.order.map((id) => state.stories[id]).filter((s): s is StoryView => s !== undefined && s.status !== "passed");
}

function headline(state: State, left: number): string {
  const total = state.order.length;
  const cost = `$${state.ledger.usage.cost.toFixed(CENTS)}`;
  if (left === 0) return `Run finished · all ${total} stories passed · ${cost}`;
  return `Run finished · ${total - left} of ${total} stories passed · ${left} did not · ${cost}`;
}

/** The conductor's last word when it was not a plain "ok". */
function conductorNote(state: State): string {
  if (state.checkpoints["before-done"] === "ok") return "";
  return state.log.findLast((e) => e.role === "conductor" && e.label === "Advisor")?.detail ?? "";
}

/**
 * Shown once a run ends: what passed, why each other story did not (the critic's last finding),
 * the conductor's last word, and what to do next. Without it a finished run looked like a stuck one.
 */
export function RunSummary({ state }: { state: State }) {
  if (!state.plan || (state.phase !== "done" && state.phase !== "failed")) return null;
  const left = unfinished(state);
  const note = conductorNote(state);
  const next = left.length ? `enter retries the ${left.length} that did not pass · ` : "";
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={left.length ? COLOR.bad : COLOR.good} paddingX={1}>
      <Text bold color={left.length ? COLOR.bad : COLOR.good}>{headline(state, left.length)}</Text>
      {left.map((s) => (
        <Text key={s.id} wrap="truncate-end">
          <Text color={COLOR.bad}>✗ {(state.plan?.stories.find((p) => p.id === s.id)?.title ?? s.id).slice(0, TITLE).padEnd(TITLE)}</Text>
          <Text color="gray"> {s.finding || s.status}</Text>
        </Text>
      ))}
      {note ? <Text wrap="truncate-end" color="gray">conductor: {note}</Text> : null}
      <Text color={COLOR.brass}>next: {next}tab reviews the agents and the changed files · type a new request · /history</Text>
    </Box>
  );
}
