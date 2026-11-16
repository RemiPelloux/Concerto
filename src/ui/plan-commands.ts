import type { Edit } from "#src/orchestrator/edit.js";

/** One plan-editing command: its usage line and how its words become an edit. */
type Spec = { usage: string; help: string; parse: (words: string[]) => Edit | null };

const words2 = (w: string[]) => (w.length >= 2 ? [w[0] ?? "", w[1] ?? ""] : null);

export const PLAN_EDITS: Record<string, Spec> = {
  drop: { usage: "<story>", help: "remove a story from the waiting plan", parse: ([id]) => (id ? { kind: "drop", id } : null) },
  merge: { usage: "<story> <into>", help: "fold a story into another", parse: (w) => (words2(w) ? { kind: "merge", id: w[0] ?? "", into: w[1] ?? "" } : null) },
  split: { usage: "<story>", help: "split a story in two by its acceptance items", parse: ([id]) => (id ? { kind: "split", id } : null) },
  retitle: { usage: "<story> <title>", help: "reword a story's title", parse: ([id, ...rest]) => (id && rest.length ? { kind: "retitle", id, title: rest.join(" ") } : null) },
  after: { usage: "<story> <stories|none>", help: "set what a story waits for", parse: ([id, ...deps]) => (id && deps.length ? { kind: "after", id, deps: deps[0] === "none" ? [] : deps } : null) },
  route: { usage: "<story> <model>", help: "pick the model that builds a story", parse: (w) => (words2(w) ? { kind: "route", id: w[0] ?? "", model: w[1] ?? "" } : null) },
  reviewer: { usage: "<story> <model>", help: "pick the model that reviews a story", parse: (w) => (words2(w) ? { kind: "reviewer", id: w[0] ?? "", model: w[1] ?? "" } : null) },
  effort: { usage: "<story> <level>", help: "set a story's effort: low, medium, high, xhigh", parse: (w) => (words2(w) ? { kind: "effort", id: w[0] ?? "", effort: w[1] ?? "" } : null) },
};

/** The edit a command line asks for, or the usage line when its words do not fit. */
export function parseEdit(name: string, arg: string): Edit | string {
  const spec = PLAN_EDITS[name];
  if (!spec) return `Unknown plan edit /${name}.`;
  const edit = spec.parse(arg.split(/[\s,]+/).filter(Boolean));
  return edit ?? `/${name} ${spec.usage}`;
}
