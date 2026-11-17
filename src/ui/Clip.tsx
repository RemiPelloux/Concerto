import { Box } from "ink";
import type { ReactNode } from "react";

/**
 * Cuts its content at the bottom when the screen has no room for all of it. The inner
 * box keeps the content's own height: without it every child box would shrink and overlap.
 */
export function Clip({ children }: { children: ReactNode }) {
  return (
    <Box flexDirection="column" flexShrink={1} overflow="hidden">
      <Box flexDirection="column" flexShrink={0}>{children}</Box>
    </Box>
  );
}
