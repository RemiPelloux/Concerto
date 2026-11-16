import { hunksOf, loadMerge, rejectHunk, rejectStory, storyPatch } from "#src/engine/review-work.js";
import type { Concert } from "#src/orchestrator/concert.js";
import { askBuilder } from "#src/orchestrator/follow-up.js";
import { pause, resume } from "#src/orchestrator/pause.js";
import type { Panel } from "#src/ui/slash.js";

const HUNK_LINE = 90;

type ReviewContext = { concert: () => Concert | null; show: (panel: Panel) => void };
export type ReviewCommand = { name: string; args: string; help: string; run: (arg: string, ctx: ReviewContext) => Promise<void> };

function current(ctx: ReviewContext): Concert {
  const c = ctx.concert();
  if (!c) throw new Error("There is no run in this session yet.");
  return c;
}

async function hunks(arg: string, ctx: ReviewContext): Promise<void> {
  const c = current(ctx);
  const records = loadMerge(c.cwd, { runId: c.runId, storyId: arg });
  if (!records) return ctx.show({ title: "Hunks", lines: [`Nothing merged for "${arg}" in this run.`] });
  const lines = hunksOf(await storyPatch(records)).map((h) => {
    const changed = h.text.split("\n").find((l) => /^[+-][^+-]/.test(l)) ?? "";
    return `${String(h.index).padStart(2)}  ${h.file}  ${h.text.split("\n")[0] ?? ""}  ${changed}`.slice(0, HUNK_LINE);
  });
  ctx.show({ title: `Hunks of ${arg}`, lines: [...lines, "", `/reject ${arg} <n> takes one back · /reject ${arg} takes the whole story back`] });
}

async function reject(arg: string, ctx: ReviewContext): Promise<void> {
  const c = current(ctx);
  const [storyId = "", n] = arg.split(/\s+/);
  if (n) {
    const done = await rejectHunk(c.cwd, { runId: c.runId, storyId, index: Number(n) });
    return ctx.show({ title: "Rejected", lines: [`Hunk ${n} of ${storyId} taken out of ${done.file}.`, `Saved in ${done.saved}`] });
  }
  const done = await rejectStory(c.cwd, { runId: c.runId, storyId });
  if (done.conflicts.length > 0) return ctx.show({ title: "Not rejected", lines: ["Work that landed since changed the same lines:", ...done.conflicts] });
  c.store.story(storyId, { status: "failed", finding: "rejected by the reviewer" });
  ctx.show({ title: "Rejected", lines: [`${storyId} taken out of ${done.reverted.join(", ")}.`, `Saved in ${done.saved}; git apply it to bring it back.`] });
}

/** After a run: take a story or one hunk back out, ask a builder for changes, pause or continue. */
export const REVIEW_COMMANDS: ReviewCommand[] = [
  { name: "hunks", args: "<story>", help: "list the hunks a story merged, numbered", run: hunks },
  { name: "reject", args: "<story> [n]", help: "take a merged story, or its hunk n, back out (saved as a patch)", run: reject },
  { name: "ask", args: "<story> <message>", help: "send a story back to its builder with a comment", run: async (arg, ctx) => {
    const [storyId = "", ...words] = arg.split(/\s+/);
    if (!words.length) return ctx.show({ title: "Usage", lines: ["/ask <story> <what to change>"] });
    const pass = await askBuilder(current(ctx), storyId, words.join(" "));
    ctx.show({ title: "Ask", lines: [`${storyId} ${pass ? "was rebuilt, passed and merged" : "did not pass this time; its work is saved as a patch"}.`] });
  } },
  { name: "pause", args: "", help: "let the stories building finish and start no new one", run: async (_a, ctx) => pause(current(ctx)) },
  { name: "continue", args: "", help: "start the next stories after /pause", run: async (_a, ctx) => resume(current(ctx)) },
];
