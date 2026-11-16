import { Box, Text } from "ink";
import type { Catalog } from "#src/models/catalog.js";
import type { ModelInfo } from "#src/models/types.js";
import { around } from "#src/ui/config/FieldList.js";
import { COLOR } from "#src/ui/theme.js";

const REF = 40;
const NUMBER = 4;

function cost(m: ModelInfo): string {
  if (m.costFactor < 1) return "subscription";
  return m.price ? `$${m.price.input}/$${m.price.output} per M` : "no price";
}

/** The models a slot may use; ● marks the one it runs now. */
export function ModelList({ options, at, chosen }: { options: ModelInfo[]; at: number; chosen: string }) {
  const { rows, offset } = around(options, at);
  return (
    <Box flexDirection="column">
      {rows.map((m, i) => {
        const on = offset + i === at;
        return (
          <Text key={m.ref} color={on ? COLOR.brass : undefined} wrap="truncate-end">
            {on ? "› " : "  "}{m.ref === chosen ? "● " : "  "}{m.ref.padEnd(REF)} <Text color="gray">tier {m.tier} · {cost(m)}</Text>
          </Text>
        );
      })}
    </Box>
  );
}

/** A slot's chain, tried top to bottom; models this machine cannot reach are marked, not hidden. */
export function ChainList({ models, at, catalog }: { models: string[]; at: number; catalog: Catalog }) {
  const reachable = new Set(catalog.models.map((m) => m.ref));
  if (models.length === 0) return <Text color="gray">Empty: the cheapest model at the role's tier runs. a adds one.</Text>;
  return (
    <Box flexDirection="column">
      {models.map((ref, i) => (
        <Text key={ref} color={i === at ? COLOR.brass : undefined} wrap="truncate-end">
          {i === at ? "› " : "  "}{`${i + 1}.`.padEnd(NUMBER)}{ref.padEnd(REF)} <Text color="gray">{reachable.has(ref) ? "reachable" : "not reachable, skipped"}</Text>
        </Text>
      ))}
    </Box>
  );
}
