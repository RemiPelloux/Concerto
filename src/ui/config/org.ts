import type { ConcertoConfig, Role } from "#src/config/types.js";
import { roleSlot, slots, type Slot } from "#src/ui/model-slots.js";

/** The roles under the conductor, left to right in the order a request meets them. */
export const BRANCHES = ["rewriter", "scorer", "soloist", "section", "critic"] as const satisfies readonly Role[];
export type Column = { head: Slot; leaves: Slot[] };
export type Org = { top: Slot; columns: Column[] };
/** row -1 is the conductor; row 0 a role's box; row 1 and below its routes or reviews. */
export type OrgAt = { col: number; row: number };
export type Arrow = "up" | "down" | "left" | "right";

/** Under which role a route or a review hangs: routes under their builder, reviews under the critic. */
function branchOf(config: ConcertoConfig, slot: Slot): Role | null {
  if (slot.kind === "reviews") return "critic";
  return slot.kind === "routes" ? (config.routes[slot.index]?.role ?? null) : null;
}

export function organize(config: ConcertoConfig): Org {
  const all = slots(config);
  const columns = BRANCHES.map((role) => ({ head: roleSlot(role), leaves: all.filter((s) => branchOf(config, s) === role) }));
  return { top: roleSlot("conductor"), columns };
}

export function selectedSlot(org: Org, at: OrgAt): Slot {
  const column = org.columns[at.col];
  if (at.row < 0 || !column) return org.top;
  return at.row === 0 ? column.head : (column.leaves[at.row - 1] ?? column.head);
}

function clamp(n: number, low: number, high: number): number {
  return Math.max(low, Math.min(n, high));
}

/** Arrow keys walk the chart: up to the conductor, down a column, left and right across columns. */
export function moveOrg(org: Org, at: OrgAt, arrow: Arrow): OrgAt {
  const depth = (col: number) => org.columns[col]?.leaves.length ?? 0;
  if (arrow === "up") return { ...at, row: Math.max(-1, at.row - 1) };
  if (arrow === "down") return { ...at, row: clamp(at.row + 1, 0, depth(at.col)) };
  const col = clamp(at.col + (arrow === "left" ? -1 : 1), 0, org.columns.length - 1);
  return { col, row: Math.min(at.row, depth(col)) };
}

/** Where the stem of each column sits, for columns `width` wide. */
export function centers(width: number): number[] {
  return BRANCHES.map((_b, i) => i * width + Math.floor(width / 2));
}

/** The column under the conductor's stem: the middle of the chart. */
export function middle(width: number): number {
  return Math.floor((BRANCHES.length * width) / 2);
}

/** The line that joins the conductor (in the middle) to the roles: ┌───┬───┴───┬───┐. */
export function branchLine(width: number): string {
  const xs = centers(width);
  const first = xs[0] ?? 0;
  const last = xs.at(-1) ?? 0;
  const chars = Array.from({ length: last + 1 }, (_c, x): string => (x > first && x < last ? "─" : " "));
  xs.forEach((x) => (chars[x] = "┬"));
  chars[first] = "┌";
  chars[last] = "┐";
  chars[middle(width)] = "┴";
  return chars.join("");
}
