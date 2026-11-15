import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import type { AgentView, State } from "#src/state/types.js";
import { COLOR, ROLE_COLOR, shortModel } from "#src/ui/theme.js";

const ROWS = 8;
const LABEL = 30;
const MODEL = 18;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const CLOCK = 6;
const PREVIEW_LINES = 3;
/** Quieter than this and the preview says what the silence usually means. */
const QUIET_SECONDS = 30;
const SPINNER = ["◐", "◓", "◑", "◒"];
const STATUS_ICON: Record<Exclude<AgentView["status"], "working">, string> = { done: "✓", failed: "✗" };
const STATUS_COLOR: Record<AgentView["status"], string> = { working: COLOR.brass, done: COLOR.good, failed: COLOR.bad };

/** Rows `from` to `from + count`, kept around the selection. */
export function windowAround(selected: number, total: number, count: number): number {
  return Math.max(0, Math.min(selected - Math.floor(count / 2), total - count));
}

/** `45s`, `6m07s`: short enough for a fixed column. */
export function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / MS_PER_SECOND));
  if (seconds < SECONDS_PER_MINUTE) return `${seconds}s`;
  return `${Math.floor(seconds / SECONDS_PER_MINUTE)}m${String(seconds % SECONDS_PER_MINUTE).padStart(2, "0")}s`;
}

/** The current time, refreshed every second while `ticking`: only this panel re-renders. */
export function useNow(ticking: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!ticking) return undefined;
    const timer = setInterval(() => setNow(Date.now()), MS_PER_SECOND);
    return () => clearInterval(timer);
  }, [ticking]);
  return ticking ? Math.max(now, Date.now()) : now;
}

function lastLines(agent: AgentView, count: number): string[] {
  return agent.lines.filter((l) => l.trim() !== "").slice(-count).map((l) => l.trim());
}

function icon(agent: AgentView, now: number): string {
  return agent.status === "working" ? (SPINNER[Math.floor(now / MS_PER_SECOND) % SPINNER.length] ?? "●") : STATUS_ICON[agent.status];
}

/** Fixed-width columns, so a long last line truncates instead of wrapping the row. */
function Row({ agent, active, now }: { agent: AgentView; active: boolean; now: number }) {
  return (
    <Box>
      <Box width={2} flexShrink={0}>
        <Text color={STATUS_COLOR[agent.status]}>{icon(agent, now)}</Text>
      </Box>
      <Box width={LABEL} flexShrink={0} marginRight={1}>
        <Text inverse={active} color={ROLE_COLOR[agent.role]} wrap="truncate-end">{agent.label}</Text>
      </Box>
      <Box width={MODEL} flexShrink={0} marginRight={1}>
        <Text color="gray" wrap="truncate-end">{shortModel(agent.model)}</Text>
      </Box>
      <Box width={CLOCK + 1} flexShrink={0}>
        <Text color="gray">{clock((agent.endedAt ?? now) - agent.startedAt).padStart(CLOCK)}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} marginLeft={1}>
        <Text color="gray" wrap="truncate-end">{lastLines(agent, 1)[0] ?? "starting…"}</Text>
      </Box>
    </Box>
  );
}

/** The last lines of one working agent, and how long ago it last printed: proof it is alive. */
function Preview({ agent, now }: { agent: AgentView; now: number }) {
  const quiet = now - agent.lastAt;
  const note = quiet >= QUIET_SECONDS * MS_PER_SECOND ? " · probably running a command or tests; output arrives when it ends" : "";
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="gray" wrap="truncate-end">
        <Text color={ROLE_COLOR[agent.role]}>live · {agent.label}</Text> · running {clock(now - agent.startedAt)} · last output {clock(quiet)} ago{note}
      </Text>
      {lastLines(agent, PREVIEW_LINES).map((line, i) => (
        <Text key={i} wrap="truncate-end">  {line}</Text>
      ))}
    </Box>
  );
}

function previewed(state: State, focused: boolean, selected: number): AgentView | undefined {
  const chosen = focused ? state.agents[state.agentOrder[selected] ?? ""] : undefined;
  if (chosen?.status === "working") return chosen;
  return state.agentOrder.map((id) => state.agents[id]).findLast((a) => a?.status === "working");
}

/** Every agent of the session with its last line of output, and a live preview of one at work. */
export function AgentList({ state, focused, selected }: { state: State; focused: boolean; selected: number }) {
  const working = state.agentOrder.filter((id) => state.agents[id]?.status === "working").length;
  const now = useNow(working > 0);
  if (state.agentOrder.length === 0) return null;
  const from = windowAround(selected, state.agentOrder.length, ROWS);
  const live = previewed(state, focused, selected);
  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={focused ? COLOR.brass : "gray"} paddingX={1}>
      <Text bold>
        Agents <Text color="gray">· {working} working · {state.agentOrder.length} total{focused ? " · ↑↓ select · enter open" : " · tab to focus"}</Text>
      </Text>
      {state.agentOrder.slice(from, from + ROWS).map((id, i) => {
        const agent = state.agents[id];
        return agent ? <Row key={id} agent={agent} active={focused && from + i === selected} now={now} /> : null;
      })}
      {live && <Preview agent={live} now={now} />}
    </Box>
  );
}
