import type { Concert } from "#src/orchestrator/concert.js";

type Gate = { on: boolean; release: (() => void)[] };
const gates = new WeakMap<Concert, Gate>();

const gateOf = (c: Concert): Gate => {
  const gate = gates.get(c) ?? { on: false, release: [] };
  gates.set(c, gate);
  return gate;
};

/** Stories already building finish; no new story starts until `resume`. */
export function pause(c: Concert): void {
  gateOf(c).on = true;
  c.store.log({ role: "conductor", label: "Pause", detail: "stories already building finish; no new one starts until /continue", result: "paused" });
}

export function resume(c: Concert): void {
  const gate = gateOf(c);
  gate.on = false;
  gate.release.splice(0).forEach((go) => go());
  c.store.log({ role: "conductor", label: "Pause", detail: "the next stories start", result: "continued" });
}

/** Waits while the run is paused: called before each story starts. */
export function whilePaused(c: Concert): Promise<void> {
  const gate = gateOf(c);
  return gate.on ? new Promise((go) => gate.release.push(go)) : Promise.resolve();
}
