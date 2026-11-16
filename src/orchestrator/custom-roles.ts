import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CustomRole } from "#src/config/types.js";
import { impactBrief } from "#src/engine/impact.js";
import { tierChain } from "#src/models/router.js";
import { headline, readTag, storyBrief, storySegments } from "#src/orchestrator/briefs.js";
import { callRole, errorMessage } from "#src/orchestrator/call.js";
import type { Concert } from "#src/orchestrator/concert.js";
import { checksBrief } from "#src/orchestrator/gate.js";
import type { Story } from "#src/orchestrator/plan.js";

type Job = { story: Story; cwd: string; round: number };
/** Longer instructions are text, never a path. */
const MAX_PATH = 260;
type Verdict = { pass: boolean; text: string; model: string };

/** `src/auth/**`, `**\/*.sql`, `migrations/*` as a regular expression on repository paths. */
const WILDCARDS: Record<string, string> = { "**/": "(?:.*/)?", "**": ".*", "*": "[^/]*", "?": "[^/]" };

function glob(pattern: string): RegExp {
  const body = pattern.split(/(\*\*\/|\*\*|\*|\?)/).map((part) => WILDCARDS[part] ?? part.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join("");
  return new RegExp(`^${body}$`);
}

/** The custom roles of one kind that apply to a story: by tag or path, at or above their score. */
export function rolesFor(c: Concert, story: Story, kind: CustomRole["kind"]): CustomRole[] {
  const score = c.store.get().stories[story.id]?.score ?? 0;
  return c.config.customRoles.filter((r) => {
    if (r.kind !== kind || score < r.minScore) return false;
    if (r.tags.length === 0 && r.paths.length === 0) return true;
    return r.tags.some((t) => story.tags.includes(t)) || r.paths.some((p) => story.files.some((f) => glob(p).test(f)));
  });
}

/** Instructions are the text itself, or a file of the repository when one exists at that path. */
function instructions(c: Concert, role: CustomRole): string {
  const path = join(c.cwd, role.instructions);
  return role.instructions.length < MAX_PATH && existsSync(path) ? readFileSync(path, "utf8") : role.instructions;
}

function call(c: Concert, role: CustomRole, job: Job) {
  const base = role.kind === "review" ? "critic" : "soloist";
  const chain = role.models.length ? c.catalog.reachable(role.models) : tierChain(c.catalog, role.minTier);
  const custom = { systemFile: c.prompts.custom(role.name, base, instructions(c, role)), tools: role.tools ?? c.config.roles[base].tools };
  const segments = [
    ...storySegments(c.store.get(), { repoMap: c.repo.text, storyId: job.story.id, snapshot: false }),
    { name: "story", text: storyBrief(job.story) },
    { name: "blast radius", text: impactBrief(c.store.view(job.story.id).impact) },
    { name: "checks", text: checksBrief(c, job.story.id) },
  ];
  const sessionKey = `${job.story.id}-${role.name}${job.round > 0 ? `-r${job.round}` : ""}`;
  return callRole(c, { role: base, chain, segments, custom, effort: role.effort, tags: job.story.tags, sessionKey, label: `${role.name}: ${job.story.title}`, cwd: job.cwd, storyId: job.story.id });
}

/**
 * Each custom reviewer that applies, in config order, after the critic passed the story. The
 * first that fails it sends the story back with its review; null when all pass.
 */
export async function customReviews(c: Concert, job: Job): Promise<Verdict | null> {
  for (const role of rolesFor(c, job.story, "review")) {
    const out = await call(c, role, job);
    const pass = readTag(out.text, "VERDICT") === "pass";
    c.store.log({ role: "critic", label: role.name, detail: headline(out.text, "VERDICT"), result: pass ? "passed" : "failed" });
    if (!pass) return { pass, text: `## The ${role.name} review failed it\n${out.text}`, model: out.model.ref };
  }
  return null;
}

/**
 * Each custom builder that applies works on the passed story in its folder before the merge, as
 * a docs writer would. Its failure is logged and never fails a story that passed review.
 */
export async function customBuilds(c: Concert, job: Job): Promise<void> {
  for (const role of rolesFor(c, job.story, "build")) {
    try {
      const out = await call(c, role, job);
      c.store.log({ role: "soloist", label: role.name, detail: job.story.title, result: readTag(out.text, "STATUS") || "done" });
    } catch (error) {
      c.store.log({ role: "soloist", label: role.name, detail: errorMessage(error).split("\n")[0] ?? "failed", result: "failed" });
    }
  }
}
