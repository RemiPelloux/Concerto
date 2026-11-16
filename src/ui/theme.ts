import type { Role } from "#src/config/types.js";

type Palette = { brass: string; brassDeep: string; dim: string; text: string; good: string; bad: string };
type Theme = { color: Palette; roles: Record<Role, string> };

/**
 * The themes: the default; high contrast for low vision and bright rooms; colour-blind safe
 * (Okabe and Ito's palette: pass is blue, fail is vermilion, never red against green); and mono,
 * the terminal's own colours, which NO_COLOR also picks.
 */
export const THEMES: Record<"default" | "high-contrast" | "colorblind" | "mono", Theme> = {
  default: {
    color: { brass: "#E0A458", brassDeep: "#9C6B2E", dim: "gray", text: "white", good: "#4FD08A", bad: "#F06A6A" },
    roles: { conductor: "#B48CFF", scorer: "#E0B450", soloist: "#E8826A", critic: "#6AA5FF", section: "#4FD08A" },
  },
  "high-contrast": {
    color: { brass: "#FFD75F", brassDeep: "#FFAF00", dim: "white", text: "white", good: "#00FF87", bad: "#FF5F5F" },
    roles: { conductor: "#FF87FF", scorer: "#FFFF5F", soloist: "#FFAF5F", critic: "#5FD7FF", section: "#87FF87" },
  },
  colorblind: {
    color: { brass: "#E69F00", brassDeep: "#B07800", dim: "gray", text: "white", good: "#56B4E9", bad: "#D55E00" },
    roles: { conductor: "#CC79A7", scorer: "#F0E442", soloist: "#D55E00", critic: "#0072B2", section: "#009E73" },
  },
  mono: {
    color: { brass: "white", brassDeep: "white", dim: "gray", text: "white", good: "white", bad: "white" },
    roles: { conductor: "white", scorer: "white", soloist: "white", critic: "white", section: "white" },
  },
};
export type ThemeName = keyof typeof THEMES;

/** The active colours: every component reads these, set once by applyTheme before the first frame. */
export const COLOR: Palette = { ...THEMES.default.color };
export const ROLE_COLOR: Record<Role, string> = { ...THEMES.default.roles };

/** Picks the theme; NO_COLOR (no-color.org) always wins and gives mono. */
export function applyTheme(name: ThemeName, env: NodeJS.ProcessEnv = process.env): ThemeName {
  const chosen = env.NO_COLOR ? "mono" : name;
  Object.assign(COLOR, THEMES[chosen].color);
  Object.assign(ROLE_COLOR, THEMES[chosen].roles);
  return chosen;
}

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
