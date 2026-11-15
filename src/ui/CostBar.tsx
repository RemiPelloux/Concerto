import { Box, Text } from "ink";
import { cacheHitRatio, type Ledger } from "#src/engine/ledger.js";
import { promptTokens } from "#src/runner/usage.js";
import { COLOR, ROLE_COLOR } from "#src/ui/theme.js";

const BAR = 44;
const PERCENT = 100;
const MILLION = 1e6;
const THOUSAND = 1e3;
const LABEL = 30;

function bar(value: number, max: number, color: string) {
  const filled = max > 0 ? Math.max(1, Math.round((value / max) * BAR)) : 0;
  return (
    <Text>
      <Text color={color}>{"█".repeat(filled)}</Text>
      <Text color="#333333">{"█".repeat(BAR - filled)}</Text>
    </Text>
  );
}

function tokens(n: number): string {
  if (n >= MILLION) return `${(n / MILLION).toFixed(1)}M`;
  return n >= THOUSAND ? `${(n / THOUSAND).toFixed(1)}K` : String(n);
}

export function CostBar({ ledger, brain }: { ledger: Ledger; brain: string }) {
  const actual = ledger.usage.cost;
  const ratio = actual > 0 ? ledger.soloCost / actual : 1;
  const hit = Math.round(cacheHitRatio(ledger.usage) * PERCENT);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Box justifyContent="space-between">
        <Text color="gray">same job · {tokens(promptTokens(ledger.usage) + ledger.usage.output)} tokens · cache {hit}% read · {ledger.localHits} local hits</Text>
        <Text bold>{ratio.toFixed(1)}x cheaper</Text>
      </Box>
      <Text>{`${brain} alone`.padEnd(LABEL)}{bar(ledger.soloCost, ledger.soloCost, COLOR.bad)} ${ledger.soloCost.toFixed(2)}</Text>
      <Text color={ROLE_COLOR.conductor}>{`${brain} as the brain`.padEnd(LABEL)}{bar(actual, ledger.soloCost, ROLE_COLOR.conductor)} ${actual.toFixed(2)}</Text>
      <Text color="gray">
        engine · provider cache saved ${ledger.cacheSaved.toFixed(2)} · condensed {tokens(ledger.condensedTokens)} · not resent{" "}
        {tokens(ledger.dedupedTokens)} · fallbacks {ledger.fallbacks}
      </Text>
    </Box>
  );
}
