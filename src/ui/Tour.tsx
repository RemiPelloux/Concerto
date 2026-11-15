import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { COLOR } from "./theme.js";
import { SLIDES } from "./tour/slides.js";
import { useTick } from "./tour/useTick.js";

const MIN_HEIGHT = 16;

function Dots({ at }: { at: number }) {
  return (
    <Text>
      {SLIDES.map((_, i) => (
        <Text key={i} color={i === at ? COLOR.brass : "gray"}>
          {i === at ? "●" : "○"}{" "}
        </Text>
      ))}
    </Text>
  );
}

/** The animated tour: first launch and `/onboarding`. → or space next, ← back, esc closes. */
export function Tour({ onClose }: { onClose: () => void }) {
  const [at, setAt] = useState(0);
  const tick = useTick(at);
  const last = at === SLIDES.length - 1;
  useInput((input, key) => {
    if (key.rightArrow || input === " " || (key.return && !last)) return setAt((a) => Math.min(a + 1, SLIDES.length - 1));
    if (key.leftArrow) return setAt((a) => Math.max(0, a - 1));
    if (key.return && last) onClose();
  });
  const slide = SLIDES[at] ?? SLIDES[0];
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLOR.brass} paddingX={2} paddingY={1} minHeight={MIN_HEIGHT}>
      <Box justifyContent="space-between">
        <Text bold color={COLOR.brass}>{`${at + 1}. ${slide?.title ?? ""}`}</Text>
        <Dots at={at} />
      </Box>
      <Box marginY={1} flexGrow={1}>{slide?.body(tick)}</Box>
      <Text color="gray">{last ? "enter to start · ← back" : "→ or space next · ← back · esc skip"}</Text>
    </Box>
  );
}
