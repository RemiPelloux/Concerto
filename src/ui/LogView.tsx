import { Box, Text } from "ink";
import type { LogEntry } from "#src/state/types.js";
import { COLOR, ROLE_COLOR } from "#src/ui/theme.js";

const VISIBLE = 6;
const LABEL_WIDTH = 10;

function resultColor(result: string): string {
  if (/pass|done|\d+ pts/i.test(result)) return COLOR.good;
  if (/fail|blocked/i.test(result)) return COLOR.bad;
  return "gray";
}

export function LogView({ log }: { log: LogEntry[] }) {
  return (
    <Box flexDirection="column" marginY={1}>
      {log.slice(-VISIBLE).map((e, i) => (
        <Box key={i} justifyContent="space-between">
          <Box flexShrink={1}>
            <Text wrap="truncate-end">
              <Text color={ROLE_COLOR[e.role]}>● {e.label.padEnd(LABEL_WIDTH)}</Text>
              <Text>{e.detail}</Text>
            </Text>
          </Box>
          <Box flexShrink={0} marginLeft={2}>
            <Text color={resultColor(e.result)}>{e.result}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}
