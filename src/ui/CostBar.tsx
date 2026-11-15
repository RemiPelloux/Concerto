import { Box, Text } from "ink";
import { cacheHitRatio, type Ledger } from "#src/engine/ledger.js";
import { promptTokens } from "#src/runner/usage.js";
import { meter } from "#src/ui/meter.js";
import { COLOR, ROLE_COLOR } from "#src/ui/theme.js";

const BAR = 44;
const PERCENT = 100;
const MILLION = 1e6;
const THOUSAND = 1e3;
const LABEL = 30;

function bar(value: number, max: number, color: string) {
  const { filled, empty } = meter(value, max, BAR);
  return (
    <Text>
      <Text color={color}>{"█".repeat(filled)}</Text>
      <Text color="#333333">{"█".repeat(empty)}</Text>
    </Text>
  );
}

/** "2.4x cheaper", or "1.3x more" when the run cost more than the conductor alone would have. */
export function savingsLabel(solo: number, actual: number): string {
  if (actual <= 0 || solo <= 0) return "";
  return solo >= actual ? `${(solo / actual).toFixed(1)}x cheaper` : `${(actual / solo).toFixed(1)}x more`;
}

function tokens(n: number): string {
  if (n >= MILLION) return `${(n / MILLION).toFixed(1)}M`;
  return n >= THOUSAND ? `${(n / THOUSAND).toFixed(1)}K` : String(n);
}

export function CostBar({ ledger, brain }: { ledger: Ledger; brain: string }) {
  const actual = ledger.usage.cost;
  const scale = Math.max(actual, ledger.soloCost);
  const hit = Math.round(cacheHitRatio(ledger.usage) * PERCENT);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Box justifyContent="space-between">
        <Text color="gray">same job · {tokens(promptTokens(ledger.usage) + ledger.usage.output)} tokens · cache {hit}% read · {ledger.localHits} local hits</Text>
        <Text bold>{savingsLabel(ledger.soloCost, actual)}</Text>
      </Box>
      <Text>{`${brain} alone`.padEnd(LABEL)}{bar(ledger.soloCost, scale, COLOR.bad)} ${ledger.soloCost.toFixed(2)}</Text>
      <Text color={ROLE_COLOR.conductor}>{`${brain} as the brain`.padEnd(LABEL)}{bar(actual, scale, ROLE_COLOR.conductor)} ${actual.toFixed(2)}</Text>
      <Text color="gray">
        engine · provider cache saved ${ledger.cacheSaved.toFixed(2)} · condensed {tokens(ledger.condensedTokens)} · not resent{" "}
        {tokens(ledger.dedupedTokens)} · fallbacks {ledger.fallbacks}
      </Text>
    </Box>
  );
}
