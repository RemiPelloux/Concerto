import { Box, Text, useStdout } from "ink";
import { t } from "#src/i18n/index.js";
import { COLOR, ROLE_COLOR } from "#src/ui/theme.js";
import { GLYPH_ROWS, glyphs, glyphWidth } from "#src/ui/glyphs.js";
import { useTick } from "#src/ui/tour/useTick.js";

/** Frames each colour holds before the wave moves on by one letter. */
const FRAMES_PER_STEP = 2;
/** The call-out's border and padding, plus the app's own side padding. */
const CHROME = 6;
const FALLBACK_COLUMNS = 80;

/** The colour of letter `index` at frame `tick`: the theme's colours roll left to right. */
export function waveColor(index: number, tick: number): string {
  const colors = [COLOR.brass, ROLE_COLOR.scorer, ROLE_COLOR.soloist, ROLE_COLOR.conductor, ROLE_COLOR.critic, ROLE_COLOR.section];
  const step = Math.floor(tick / FRAMES_PER_STEP);
  return colors[(((index - step) % colors.length) + colors.length) % colors.length] ?? COLOR.brass;
}

function BigWord({ letters, tick }: { letters: string[][]; tick: number }) {
  return (
    <Box flexDirection="column">
      {Array.from({ length: GLYPH_ROWS }, (_, row) => (
        <Text key={row}>
          {letters.map((g, i) => (
            <Text key={i} color={waveColor(i, tick)} bold>{`${g[row] ?? ""}${i < letters.length - 1 ? " " : ""}`}</Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}

function SmallWord({ word, tick }: { word: string; tick: number }) {
  return (
    <Text bold>
      {[...`⏎  ${word}`].map((ch, i) => <Text key={i} color={waveColor(i, tick)}>{ch}</Text>)}
    </Text>
  );
}

/** A plan waiting for Enter: the one thing to do next, in big moving letters, or one line when the terminal is narrow. */
export function BuildCallout() {
  const tick = useTick(0);
  const columns = useStdout().stdout.columns ?? FALLBACK_COLUMNS;
  const word = t().build;
  const letters = glyphs(word);
  const fits = glyphWidth(letters) + CHROME <= columns;
  return (
    <Box borderStyle="round" borderColor={waveColor(0, tick)} paddingX={1} alignSelf="flex-start">
      {fits ? <BigWord letters={letters} tick={tick} /> : <SmallWord word={word} tick={tick} />}
    </Box>
  );
}
