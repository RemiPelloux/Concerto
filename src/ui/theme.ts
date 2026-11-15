import type { Role } from "#src/config/types.js";

export const COLOR = {
  brass: "#E0A458",
  brassDeep: "#9C6B2E",
  dim: "gray",
  text: "white",
  good: "#4FD08A",
  bad: "#F06A6A",
} as const;

export const ROLE_COLOR: Record<Role, string> = {
  conductor: "#B48CFF",
  scorer: "#E0B450",
  soloist: "#E8826A",
  critic: "#6AA5FF",
  section: "#4FD08A",
};

export const ROLE_DUTY: Record<Role, string> = {
  conductor: "reads, on call",
  scorer: "scores",
  soloist: "builds",
  critic: "checks",
  section: "swarms",
};

/** "anthropic/claude-opus-5-5" -> "claude-opus-5-5" */
export function shortModel(ref: string): string {
  return ref ? ref.slice(ref.indexOf("/") + 1) : "-";
}
