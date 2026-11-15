import { Box, Text } from "ink";
import type { State } from "../state/types.js";
import { COLOR, ROLE_COLOR, shortModel } from "./theme.js";

const HINT: Record<State["phase"], string> = {
  idle: "type a request · enter to score · ctrl+c to quit",
  scoring: "✻ Scoring… (esc to interrupt)",
  planned: "enter to perform · esc to discard the plan",
  running: "✻ Working… (esc to interrupt)",
  done: "done · type a new request",
  failed: "stopped · type a new request",
};

export function StatusLine({ state }: { state: State }) {
  const color = state.phase === "failed" ? COLOR.bad : "gray";
  return (
    <Box justifyContent="space-between">
      <Text color={color}>{state.error ? `${HINT[state.phase]} · ${state.error}` : HINT[state.phase]}</Text>
      <Text>
        <Text color={ROLE_COLOR.conductor}>advisor: {shortModel(state.roles.conductor.model)}</Text>
        <Text color="gray"> · </Text>
        <Text color={ROLE_COLOR.soloist}>{shortModel(state.roles.soloist.model)}</Text>
      </Text>
    </Box>
  );
}
