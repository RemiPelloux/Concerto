import { useInput } from "ink";
import { scrub } from "#src/engine/secrets.js";
import { useState } from "react";
import { fileDiff } from "#src/engine/changes.js";
import type { State } from "#src/state/types.js";

export const ZONES = ["prompt", "agents", "stories", "changes"] as const;
export type Zone = (typeof ZONES)[number];
import type { CallRecord } from "#src/engine/session-log.js";

export type Overlay = { kind: "agent"; id: string } | { kind: "diff"; file: string; text: string } | { kind: "story"; id: string } | { kind: "tour" } | { kind: "replay"; calls: CallRecord[]; index: number } | null;

export type Navigation = {
  zone: Zone;
  selected: Record<Exclude<Zone, "prompt">, number>;
  overlay: Overlay;
  scroll: number;
  nextZone: () => void;
  open: (overlay: Overlay) => void;
};

const PAGE = 10;

/** How many rows each zone has right now. Empty zones are skipped by Tab. */
function sizes(state: State): Record<Zone, number> {
  return { prompt: 1, agents: state.agentOrder.length, stories: state.order.length, changes: state.changes.length };
}

function clamp(n: number, size: number): number {
  return Math.max(0, Math.min(n, size - 1));
}

type Pick = { zone: Zone; index: number; state: State; cwd: string; open: (o: Overlay) => void };

function pick({ zone, index, state, cwd, open }: Pick): void {
  if (zone === "agents") open({ kind: "agent", id: state.agentOrder[index] ?? "" });
  if (zone === "stories") open({ kind: "story", id: state.order[index] ?? "" });
  if (zone !== "changes") return;
  const file = state.changes[index]?.file ?? "";
  open({ kind: "diff", file, text: "loading…" });
  // Shown with anything shaped like a secret redacted: a screen can be shared or recorded.
  fileDiff(cwd, file).then((text) => open({ kind: "diff", file, text: scrub(text) }), () => open({ kind: "diff", file, text: "no diff" }));
}

/**
 * Keyboard navigation. Tab moves between the prompt, the agents, the stories and the changes;
 * arrows move inside a zone; Enter opens what is selected; Esc closes, then returns to the prompt.
 */
export function useNavigation(state: State, cwd: string, showTour: boolean): Navigation {
  const [zone, setZone] = useState<Zone>("prompt");
  const [selected, setSelected] = useState({ agents: 0, stories: 0, changes: 0 });
  const [overlay, setOverlay] = useState<Overlay>(showTour ? { kind: "tour" } : null);
  const [scroll, setScroll] = useState(0);
  const size = sizes(state);
  const nextZone = () => setZone((z) => ZONES.slice(ZONES.indexOf(z) + 1).concat(ZONES).find((n) => size[n] > 0) ?? "prompt");
  const open = (o: Overlay) => {
    setOverlay(o);
    setScroll(0);
  };
  useInput(
    (input, key) => {
      if (overlay) return overlayKeys({ key, input, setScroll, open, overlay });
      if (key.tab) return nextZone();
      if (key.escape) return setZone("prompt");
      if (zone === "prompt") return;
      const n = size[zone];
      if (key.upArrow || key.downArrow) setSelected((s) => ({ ...s, [zone]: clamp(s[zone] + (key.upArrow ? -1 : 1), n) }));
      if (key.return && n > 0) pick({ zone, index: clamp(selected[zone], n), state, cwd, open });
    },
    // At the prompt, the prompt bar takes every key in every phase, Tab included.
    { isActive: zone !== "prompt" || overlay !== null },
  );
  return { zone, selected, overlay, scroll, nextZone, open };
}

type OverlayKeys = { key: { escape: boolean; upArrow: boolean; downArrow: boolean; leftArrow: boolean; rightArrow: boolean; pageUp: boolean; pageDown: boolean }; input: string; setScroll: (f: (n: number) => number) => void; open: (o: Overlay) => void; overlay: NonNullable<Overlay> };

/**
 * In an overlay, Esc or q closes it and arrows scroll: down is positive, up negative. Each view
 * clamps the value to what it shows (the tour handles its own keys). In a replay, ←→ change call.
 */
function overlayKeys({ key, input, setScroll, open, overlay }: OverlayKeys): void {
  if (key.escape || input === "q") return open(null);
  if (overlay.kind === "tour") return;
  if (overlay.kind === "replay" && (key.leftArrow || key.rightArrow)) return open({ ...overlay, index: clamp(overlay.index + (key.leftArrow ? -1 : 1), overlay.calls.length) });
  const step = key.upArrow ? -1 : key.downArrow ? 1 : key.pageUp ? -PAGE : key.pageDown ? PAGE : 0;
  if (step !== 0) setScroll((s) => s + step);
}
