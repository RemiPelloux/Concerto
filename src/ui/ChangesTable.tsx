import { Box, Text } from "ink";
import type { FileChange, State } from "#src/state/types.js";
import { windowAround } from "#src/ui/AgentList.js";
import { meter } from "#src/ui/meter.js";
import { COLOR } from "#src/ui/theme.js";

const ROWS = 8;
const FILE = 34;
const NUM = 5;
const BAR = 10;
const ELLIPSIS_TAIL = FILE - "+ …".length;
/** File, two counts, the bar, the border and padding: the table never wraps. */
const CHROME = 6;
const WIDTH = FILE + NUM * 2 + BAR + CHROME;

/** A small proportional bar: green for added lines, red for removed. */
function Bar({ change, max }: { change: FileChange; max: number }) {
  const total = Math.max(1, meter(change.added + change.removed, max, BAR).filled);
  const green = meter(change.added, change.added + change.removed, total);
  return (
    <Text>
      <Text color={COLOR.good}>{"■".repeat(green.filled)}</Text>
      <Text color={COLOR.bad}>{"■".repeat(green.empty)}</Text>
    </Text>
  );
}

function fileLabel(c: FileChange): string {
  const mark = c.status === "added" ? "+ " : c.status === "deleted" ? "- " : "  ";
  const name = c.file.length > FILE - 2 ? `…${c.file.slice(-ELLIPSIS_TAIL)}` : c.file;
  return (mark + name).padEnd(FILE);
}

/** What the run changed, file by file. Enter shows the diff. */
export function ChangesTable({ state, focused, selected }: { state: State; focused: boolean; selected: number }) {
  if (state.changes.length === 0) return null;
  const added = state.changes.reduce((s, c) => s + c.added, 0);
  const removed = state.changes.reduce((s, c) => s + c.removed, 0);
  const max = Math.max(...state.changes.map((c) => c.added + c.removed));
  const from = windowAround(selected, state.changes.length, ROWS);
  return (
    <Box flexDirection="column" flexShrink={0} width={WIDTH} borderStyle="round" borderColor={focused ? COLOR.brass : "gray"} paddingX={1}>
      <Text bold>
        Changes <Text color="gray">· {state.changes.length} files </Text>
        <Text color={COLOR.good}>+{added}</Text> <Text color={COLOR.bad}>−{removed}</Text>
      </Text>
      {state.changes.slice(from, from + ROWS).map((c, i) => (
        <Text key={c.file}>
          <Text inverse={focused && from + i === selected}>{fileLabel(c)}</Text>
          <Text color={COLOR.good}>{`+${c.added}`.padStart(NUM)}</Text>
          <Text color={COLOR.bad}>{`−${c.removed}`.padStart(NUM)}</Text> <Bar change={c} max={max} />
        </Text>
      ))}
    </Box>
  );
}
