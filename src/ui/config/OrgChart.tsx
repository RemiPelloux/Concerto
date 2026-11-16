import { Box, Text } from "ink";
import type { ConcertoConfig, Role } from "#src/config/types.js";
import type { Catalog } from "#src/models/catalog.js";
import { current, type Slot } from "#src/ui/model-slots.js";
import { branchLine, type Org, type OrgAt } from "#src/ui/config/org.js";
import { COLOR, ROLE_COLOR, shortModel } from "#src/ui/theme.js";

type Scene = { config: ConcertoConfig; catalog: Catalog; width: number };
type ChartProps = Scene & { org: Org; at: OrgAt };
type NodeProps = Scene & { slot: Slot; on: boolean; boxWidth: number; stem: number | null };

const BORDER = 2;
/** Border and padding on both sides of a box. */
const BOX_CHROME = 4;
/** Where a role's stem leaves its box, so its routes have room for their names. */
const LEAF_STEM = 2;
const LEAF_INDENT = 3;

/** Lines are cut to the box by hand too: a line Ink has to wrap while it lays out adds a blank row. */
function fit(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
}

function model(scene: Scene, slot: Slot): string {
  return shortModel(current(scene.config, scene.catalog, slot)) || "none reachable";
}

/** The box's bottom edge, drawn by hand so a stem can leave it: ╰──┬─────╯. */
function bottomEdge(width: number, on: boolean, stem: number | null): string {
  const [left, line, tee, right] = on ? ["╚", "═", "╤", "╝"] : ["╰", "─", "┬", "╯"];
  const inner = width - BORDER;
  if (stem === null) return `${left}${line.repeat(inner)}${right}`;
  return `${left}${line.repeat(stem - 1)}${tee}${line.repeat(inner - stem)}${right}`;
}

function NodeBox({ slot, on, boxWidth, stem, ...scene }: NodeProps) {
  const role = scene.config.roles[slot.key as Role];
  const color = on ? COLOR.brass : ROLE_COLOR[slot.key as Role];
  const inner = boxWidth - BOX_CHROME;
  const title = fit(`${slot.label.toUpperCase()}${slot.brain ? " · premium" : ""}`, inner);
  return (
    <Box flexDirection="column" width={boxWidth}>
      {/* Keyed by selection: Ink keeps a hidden bottom border's row when the border style changes in place. */}
      <Box key={on ? "on" : "off"} flexDirection="column" borderStyle={on ? "double" : "round"} borderColor={color} borderBottom={false} paddingX={1}>
        <Text bold color={ROLE_COLOR[slot.key as Role]} wrap="truncate-end">{title}</Text>
        <Text wrap="truncate-end">{fit(model(scene, slot), inner)}</Text>
        <Text color="gray" wrap="truncate-end">{fit(`tier ${role.minTier}+ · ${role.effort}`, inner)}</Text>
      </Box>
      <Text color={color} wrap="truncate-end">{bottomEdge(boxWidth, on, stem)}</Text>
    </Box>
  );
}

function Leaf({ slot, on, last, ...scene }: Scene & { slot: Slot; on: boolean; last: boolean }) {
  const room = scene.width - LEAF_INDENT - LEAF_INDENT;
  const name = fit(slot.kind === "routes" ? `${slot.index + 1}. ${slot.key}` : slot.label, room);
  return (
    <Box flexDirection="column">
      <Text color={on ? COLOR.brass : undefined} bold={on} wrap="truncate-end"><Text color="gray">{last ? "└─" : "├─"}</Text>{on ? "›" : " "}{name}</Text>
      <Text color="gray" wrap="truncate-end">{last ? " " : "│"}{"  "} {fit(model(scene, slot), room)}</Text>
    </Box>
  );
}

function Leaves({ leaves, row, ...scene }: Scene & { leaves: Slot[]; row: number }) {
  return (
    <Box flexDirection="column" paddingLeft={LEAF_INDENT}>
      {leaves.map((s, i) => <Leaf key={`${s.kind}-${s.key}`} {...scene} slot={s} on={row === i + 1} last={i === leaves.length - 1} />)}
    </Box>
  );
}

/** Who does what, as a chart: the conductor on top, the four roles under it, routes and reviews below. */
export function OrgChart({ org, at, ...scene }: ChartProps) {
  const { width } = scene;
  return (
    <Box flexDirection="column">
      <Box paddingLeft={width + 1}>
        <NodeBox {...scene} slot={org.top} on={at.row < 0} boxWidth={2 * width - BORDER} stem={width - 1} />
      </Box>
      <Text color="gray" wrap="truncate-end">{branchLine(width)}</Text>
      <Box>
        {org.columns.map((c, col) => (
          <Box key={c.head.key} flexDirection="column" width={width}>
            <Box paddingLeft={1}>
              <NodeBox {...scene} slot={c.head} on={at.col === col && at.row === 0} boxWidth={width - BORDER} stem={c.leaves.length > 0 ? LEAF_STEM : null} />
            </Box>
            <Leaves {...scene} leaves={c.leaves} row={at.col === col ? at.row : 0} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}
