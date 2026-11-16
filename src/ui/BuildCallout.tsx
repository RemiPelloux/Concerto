import { Box, Text, useStdout } from "ink";
import { t } from "#src/i18n/index.js";
import { COLOR, ROLE_COLOR } from "#src/ui/theme.js";
import { GLYPH_ROWS, glyphs, glyphWidth } from "#src/ui/glyphs.js";
import { useEffect, useState } from "react";

/** How long each colour holds before the wave moves on by one letter: slow enough to cost little. */
export const STEP_MS = 250;
/** The call-out's border and padding, plus the app's own side padding. */
const CHROME = 6;
const FALLBACK_COLUMNS = 80;

/** The colour of letter `index` at step `step`: the theme's colours roll left to right. */
export function waveColor(index: number, step: number): string {
  const colors = [COLOR.brass, ROLE_COLOR.scorer, ROLE_COLOR.soloist, ROLE_COLOR.conductor, ROLE_COLOR.critic, ROLE_COLOR.section];
  return colors[(((index - step) % colors.length) + colors.length) % colors.length] ?? COLOR.brass;
}

function useStep(): number {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setStep((n) => n + 1), STEP_MS);
    return () => clearInterval(timer);
  }, []);
  return step;
}

function BigWord({ letters, step }: { letters: string[][]; step: number }) {
  return (
    <Box flexDirection="column">
      {Array.from({ length: GLYPH_ROWS }, (_, row) => (
        <Text key={row}>
          {letters.map((g, i) => (
            <Text key={i} color={waveColor(i, step)} bold>{`${g[row] ?? ""}${i < letters.length - 1 ? " " : ""}`}</Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}

function SmallWord({ word, step }: { word: string; step: number }) {
  return (
    <Text bold>
      {[...`⏎  ${word}`].map((ch, i) => <Text key={i} color={waveColor(i, step)}>{ch}</Text>)}
    </Text>
  );
}

/** A plan waiting for Enter: the one thing to do next, in big moving letters, or one line when the terminal is narrow. */
export function BuildCallout() {
  const step = useStep();
  const columns = useStdout().stdout.columns ?? FALLBACK_COLUMNS;
  const word = t().build;
  const letters = glyphs(word);
  const fits = glyphWidth(letters) + CHROME <= columns;
  return (
    <Box borderStyle="round" borderColor={waveColor(0, step)} paddingX={1} alignSelf="flex-start">
      {fits ? <BigWord letters={letters} step={step} /> : <SmallWord word={word} step={step} />}
    </Box>
  );
}
