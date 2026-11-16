import { FIBONACCI, type Plan, type Story } from "#src/orchestrator/plan.js";

const ID_MAX = 46;
const TITLE_MAX = 80;
/** As many acceptance commands as the plan schema allows. */
const MAX_CHECKS = 5;

/** A change to a waiting plan. Story-shape edits re-score; route edits only change who runs it. */
export type Edit =
  | { kind: "drop"; id: string }
  | { kind: "merge"; id: string; into: string }
  | { kind: "split"; id: string }
  | { kind: "retitle"; id: string; title: string }
  | { kind: "after"; id: string; deps: string[] }
  | { kind: "route"; id: string; model: string }
  | { kind: "reviewer"; id: string; model: string }
  | { kind: "effort"; id: string; effort: string };

/** The smallest Fibonacci point value that holds `points`. */
const fib = (points: number) => FIBONACCI.find((p) => p >= points) ?? FIBONACCI.at(-1) ?? points;
const union = <T>(a: T[], b: T[]) => [...new Set([...a, ...b])];

function find(plan: Plan, id: string): Story {
  const story = plan.stories.find((s) => s.id === id);
  if (!story) throw new Error(`No story "${id}" in the plan. Ids: ${plan.stories.map((s) => s.id).join(", ")}.`);
  return story;
}

/** Points every dependency on `from` at `to` (or drops it when `to` is empty), without self-loops. */
function redirect(stories: Story[], from: string, to: string[]): Story[] {
  return stories.map((s) => (s.dependsOn.includes(from) ? { ...s, dependsOn: union(s.dependsOn.filter((d) => d !== from), to.filter((t) => t !== s.id)) } : s));
}

function merge(plan: Plan, id: string, into: string): Story[] {
  const [a, b] = [find(plan, into), find(plan, id)];
  if (a.id === b.id) throw new Error("A story cannot be merged into itself.");
  const merged: Story = {
    ...a,
    title: `${a.title}; ${b.title}`.slice(0, TITLE_MAX),
    acceptance: union(a.acceptance, b.acceptance), files: union(a.files, b.files), tags: union(a.tags, b.tags), checks: union(a.checks, b.checks).slice(0, MAX_CHECKS),
    points: fib(a.points + b.points), complexity: Math.max(a.complexity, b.complexity), risk: Math.max(a.risk, b.risk), value: Math.max(a.value, b.value),
    uncertainty: Math.max(a.uncertainty, b.uncertainty), dependsOn: union(a.dependsOn, b.dependsOn).filter((d) => d !== a.id && d !== b.id),
  };
  return redirect(plan.stories.filter((s) => s.id !== b.id).map((s) => (s.id === a.id ? merged : s)), b.id, [a.id]);
}

/** Two stories from one, each with half of its acceptance items; whatever waited on it waits on both. */
function split(plan: Plan, id: string): Story[] {
  const s = find(plan, id);
  if (s.acceptance.length < 2) throw new Error(`"${id}" has one acceptance item: nothing to split it on.`);
  const half = Math.ceil(s.acceptance.length / 2);
  const ids = [`${s.id.slice(0, ID_MAX)}-1`, `${s.id.slice(0, ID_MAX)}-2`];
  const part = (n: 0 | 1): Story => ({ ...s, id: ids[n] ?? s.id, title: `${s.title} (${n + 1}/2)`.slice(0, TITLE_MAX), acceptance: n === 0 ? s.acceptance.slice(0, half) : s.acceptance.slice(half), points: fib(Math.max(1, Math.ceil(s.points / 2))) });
  return redirect(plan.stories.flatMap((x) => (x.id === id ? [part(0), part(1)] : [x])), id, ids);
}

/** The plan after a story-shape edit, and the ids whose score must be computed again. */
export function editPlan(plan: Plan, edit: Edit): { plan: Plan; changed: string[] } {
  const stories = ((): Story[] => {
    if (edit.kind === "drop") return redirect(plan.stories.filter((s) => s.id !== find(plan, edit.id).id), edit.id, []);
    if (edit.kind === "merge") return merge(plan, edit.id, edit.into);
    if (edit.kind === "split") return split(plan, edit.id);
    if (edit.kind === "retitle") return plan.stories.map((s) => (s.id === find(plan, edit.id).id ? { ...s, title: edit.title.slice(0, TITLE_MAX) } : s));
    if (edit.kind === "after") return plan.stories.map((s) => (s.id === find(plan, edit.id).id ? { ...s, dependsOn: edit.deps.filter((d) => d !== s.id && plan.stories.some((x) => x.id === d)) } : s));
    return plan.stories;
  })();
  if (stories.length === 0) throw new Error("A plan needs at least one story. Press Esc to discard it instead.");
  const before = new Map(plan.stories.map((s) => [s.id, JSON.stringify(s)]));
  const changed = stories.filter((s) => before.get(s.id) !== JSON.stringify(s)).map((s) => s.id);
  return { plan: { ...plan, stories }, changed };
}
