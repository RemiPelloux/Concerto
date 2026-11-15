import { Box, Text } from "ink";
import { CHECKPOINTS, type Checkpoint, type State } from "../state/types.js";
import { ROLE_COLOR, shortModel } from "./theme.js";

const LABEL: Record<Checkpoint, [string, string]> = {
  "plan-lock": ["before a plan locks", "what did the plan miss?"],
  "repeat-error": ["error repeats twice", "root cause or rabbit hole?"],
  "before-done": ["before calling done", "did the diff break anything?"],
};

function Gate({ id, verdict }: { id: Checkpoint; verdict: string }) {
  const [title, question] = LABEL[id];
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box borderStyle="round" borderColor={verdict ? ROLE_COLOR.conductor : "gray"} paddingX={1}>
        <Text color={ROLE_COLOR.conductor}>{verdict ? "✓" : "›"} {title}</Text>
      </Box>
      <Text color="gray">{verdict ? `verdict: ${verdict}` : question}</Text>
    </Box>
  );
}

export function ConductorPanel({ state }: { state: State }) {
  const role = state.roles.conductor;
  const wakes = CHECKPOINTS.filter((c) => state.checkpoints[c]).length;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={ROLE_COLOR.conductor} paddingX={1} width={34}>
      <Text color={ROLE_COLOR.conductor} bold>{role.activity === "working" ? "●" : "○"} {shortModel(role.model)} · on call</Text>
      <Text color="gray">reads all · writes nothing</Text>
      {CHECKPOINTS.map((id) => <Gate key={id} id={id} verdict={state.checkpoints[id]} />)}
      <Box justifyContent="space-between" marginTop={1}>
        <Text color="gray">wakes up</Text>
        <Text color={ROLE_COLOR.conductor}>{wakes} / {CHECKPOINTS.length}</Text>
      </Box>
    </Box>
  );
}
