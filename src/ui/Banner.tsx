import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { t } from "#src/i18n/index.js";
import { COLOR } from "#src/ui/theme.js";

const GLYPHS: Record<string, string[]> = {
  C: [" ████", "██   ", "██   ", "██   ", " ████"],
  O: [" ███ ", "██ ██", "██ ██", "██ ██", " ███ "],
  N: ["██  ██", "███ ██", "██████", "██ ███", "██  ██"],
  E: ["█████", "██   ", "████ ", "██   ", "█████"],
  R: ["████ ", "██ ██", "████ ", "██ ██", "██  █"],
  T: ["██████", "  ██  ", "  ██  ", "  ██  ", "  ██  "],
};
const WORD = "CONCERTO";
const ROWS = 5;
export const CREDIT = "built by github.com/RemiPelloux";
/** How long the welcome stays on screen after launch; the logo stays. */
export const WELCOME_MS = 3000;

function row(index: number): string {
  return [...WORD].map((ch) => GLYPHS[ch]?.[index] ?? "").join(" ");
}

/** When the first banner appeared: the welcome counts from there, however often the layout redraws the banner. */
let firstShown: number | null = null;

function useWelcome(): boolean {
  firstShown ??= Date.now();
  const left = WELCOME_MS - (Date.now() - firstShown);
  const [shown, setShown] = useState(left > 0);
  useEffect(() => {
    if (left <= 0) return undefined;
    const timer = setTimeout(() => setShown(false), left);
    return () => clearTimeout(timer);
  }, [left]);
  return shown;
}

export function Banner() {
  const welcome = useWelcome();
  const rows = Array.from({ length: ROWS }, (_, i) => row(i));
  return (
    <Box flexDirection="column">
      {welcome && (
        <Box borderStyle="round" borderColor={COLOR.brassDeep} paddingX={1} alignSelf="flex-start">
          <Text color={COLOR.brass}>{t().welcome}</Text>
        </Box>
      )}
      {rows.map((line, i) => (
        <Text key={i}>
          <Text color={i < 2 ? COLOR.brass : COLOR.brassDeep} bold>{line}</Text>
          {i === ROWS - 1 && <Text color={COLOR.dim}>{`  ${CREDIT}`}</Text>}
        </Text>
      ))}
    </Box>
  );
}
