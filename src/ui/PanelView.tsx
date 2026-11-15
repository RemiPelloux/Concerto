import { Box, Text } from "ink";
import type { Panel } from "./slash.js";
import { COLOR } from "./theme.js";

const MAX_LINES = 24;

/** The answer to a slash command, above the prompt until Esc. */
export function PanelView({ panel }: { panel: Panel | null }) {
  if (!panel) return null;
  const hidden = panel.lines.length - MAX_LINES;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLOR.brassDeep} paddingX={1}>
      <Text bold color={COLOR.brass}>
        {panel.title} <Text color="gray">· esc to close</Text>
      </Text>
      {panel.lines.slice(-MAX_LINES).map((line, i) => (
        <Text key={i} wrap="truncate-end">
          {line}
        </Text>
      ))}
      {hidden > 0 ? <Text color="gray">… {hidden} earlier lines</Text> : null}
    </Box>
  );
}
