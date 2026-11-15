import { Box, Text } from "ink";
import type { Role } from "#src/config/types.js";
import type { State } from "#src/state/types.js";
import { ROLE_COLOR, shortModel } from "#src/ui/theme.js";

const EFFORT_CELLS = 8;
const EFFORT_FILL: Record<string, number> = { low: 2, medium: 4, high: 6, xhigh: 7, max: 8 };

function dot(state: State, role: Role): string {
  return state.roles[role].activity === "working" ? "●" : "○";
}

function SoloistBox({ state }: { state: State }) {
  const solo = state.roles.soloist;
  const running = Object.values(state.stories).find((s) => s.status === "building" && s.role === "soloist");
  const fill = EFFORT_FILL[running?.effort ?? "high"] ?? 0;
  return (
    <Box flexDirection="column" alignItems="center" borderStyle="round" borderColor={ROLE_COLOR.soloist} paddingX={1}>
      <Text color={ROLE_COLOR.soloist} bold>{dot(state, "soloist")} {shortModel(solo.model)} · main session</Text>
      <Text color="gray">{running ? `story ${running.id}` : "drives the build · writes diffs · runs tests"}</Text>
      <Text>
        <Text color="gray">effort </Text>
        <Text color={ROLE_COLOR.soloist}>{"█".repeat(fill)}</Text>
        <Text color="#444444">{"█".repeat(EFFORT_CELLS - fill)}</Text>
        <Text color="gray"> {running?.effort ?? "high"}</Text>
      </Text>
      <Text color="gray" wrap="truncate-end">{solo.note}</Text>
    </Box>
  );
}

function RoleBox({ state, role, title }: { state: State; role: Role; title: string }) {
  const view = state.roles[role];
  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={ROLE_COLOR[role]} paddingX={1} minHeight={6}>
      <Text color={ROLE_COLOR[role]} bold>{dot(state, role)} {shortModel(view.model)} · {title}</Text>
      {role === "section" ? <Swarm tools={state.swarm} /> : <Text>tries to break it <Text color="gray">· changes nothing</Text></Text>}
      <Text color="gray" wrap="truncate-end">{view.note || view.activity}</Text>
    </Box>
  );
}

function Swarm({ tools }: { tools: string[] }) {
  return (
    <Text color="gray" wrap="wrap">
      {tools.length > 0 ? tools.map((t) => `○ ${t}`).join("  ") : "bulk work · small stories in parallel"}
    </Text>
  );
}

export function Stage({ state, swarmSize }: { state: State; swarmSize: number }) {
  return (
    <Box flexDirection="column" flexGrow={1} marginLeft={2}>
      <SoloistBox state={state} />
      <Box alignSelf="center" borderStyle="round" borderColor="gray" paddingX={2} flexDirection="column" alignItems="center">
        <Text bold>● Task · dispatch stories</Text>
        <Text color="gray">brief · files · what done means</Text>
      </Box>
      <Box>
        <RoleBox state={state} role="critic" title="critic" />
        <RoleBox state={state} role="section" title={`section ×${swarmSize}`} />
      </Box>
    </Box>
  );
}
