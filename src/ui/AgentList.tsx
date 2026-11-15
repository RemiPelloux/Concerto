import { Box, Text } from "ink";
import type { AgentView, State } from "#src/state/types.js";
import { COLOR, ROLE_COLOR, shortModel } from "#src/ui/theme.js";

const ROWS = 8;
const LABEL = 30;
const MODEL = 18;
const MS_PER_SECOND = 1000;
const ELAPSED = 4;
const STATUS_ICON: Record<AgentView["status"], string> = { working: "●", done: "✓", failed: "✗" };
const STATUS_COLOR: Record<AgentView["status"], string> = { working: COLOR.brass, done: COLOR.good, failed: COLOR.bad };

/** Rows `from` to `from + count`, kept around the selection. */
export function windowAround(selected: number, total: number, count: number): number {
  return Math.max(0, Math.min(selected - Math.floor(count / 2), total - count));
}

function elapsed(a: AgentView): string {
  return `${Math.round(((a.endedAt ?? Date.now()) - a.startedAt) / MS_PER_SECOND)}s`;
}

/** Fixed-width columns, so a long last line truncates instead of wrapping the row. */
function Row({ agent, active }: { agent: AgentView; active: boolean }) {
  const last = agent.lines.findLast((l) => l.trim() !== "") ?? "starting…";
  return (
    <Box>
      <Box width={2} flexShrink={0}>
        <Text color={STATUS_COLOR[agent.status]}>{STATUS_ICON[agent.status]}</Text>
      </Box>
      <Box width={LABEL} flexShrink={0} marginRight={1}>
        <Text inverse={active} color={ROLE_COLOR[agent.role]} wrap="truncate-end">{agent.label}</Text>
      </Box>
      <Box width={MODEL} flexShrink={0} marginRight={1}>
        <Text color="gray" wrap="truncate-end">{shortModel(agent.model)}</Text>
      </Box>
      <Box width={ELAPSED + 1} flexShrink={0}>
        <Text color="gray">{elapsed(agent).padStart(ELAPSED)}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} marginLeft={1}>
        <Text color="gray" wrap="truncate-end">{last.trim()}</Text>
      </Box>
    </Box>
  );
}

/** Every agent of the session with its last line of output. Enter opens its live view. */
export function AgentList({ state, focused, selected }: { state: State; focused: boolean; selected: number }) {
  if (state.agentOrder.length === 0) return null;
  const from = windowAround(selected, state.agentOrder.length, ROWS);
  const working = state.agentOrder.filter((id) => state.agents[id]?.status === "working").length;
  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={focused ? COLOR.brass : "gray"} paddingX={1}>
      <Text bold>
        Agents <Text color="gray">· {working} working · {state.agentOrder.length} total{focused ? " · ↑↓ select · enter open" : " · tab to focus"}</Text>
      </Text>
      {state.agentOrder.slice(from, from + ROWS).map((id, i) => {
        const agent = state.agents[id];
        return agent ? <Row key={id} agent={agent} active={focused && from + i === selected} /> : null;
      })}
    </Box>
  );
}
