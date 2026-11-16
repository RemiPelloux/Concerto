import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { claudeBin, codexBin, piBin } from "#src/runner/bins.js";
import { codexHome, codexProfiles, codexSlugs, opencodeRefs, piRefs } from "#src/models/discover.js";
import { onPath } from "#src/runner/tool.js";
import { inferTier } from "#src/setup/tiers.js";

/** Claude Code accepts these ids; it has no command that lists them. */
const CLAUDE_CODE_MODELS = ["claude-fable-5-2", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];

export type Linked = { ref: string; tier: number; via: string };

export type Detection = {
  claude: boolean;
  codex: boolean;
  pi: boolean;
  rtk: boolean;
  profiles: string[];
  /** Every model Concerto can reach and knows a tier for. */
  linked: Linked[];
};

function profileModel(profile: string): string {
  const file = join(codexHome(), `${profile}.config.toml`);
  if (!existsSync(file)) return "";
  return /^\s*model\s*=\s*"([^"]+)"/m.exec(readFileSync(file, "utf8"))?.[1] ?? "";
}

function tiered(refs: string[], via: string): Linked[] {
  return refs.flatMap((ref) => {
    const tier = inferTier(ref.slice(ref.indexOf("/") + 1));
    return tier === null ? [] : [{ ref, tier, via }];
  });
}

/** A profile reaches its own default model, plus what pi lists for a provider of the same name. */
function profileRefs(profiles: string[], pi: Set<string>): string[] {
  return profiles.flatMap((p) => {
    const sameProvider = [...pi].filter((r) => r.startsWith(`${p}/`)).map((r) => r.slice(p.length + 1));
    const ids = new Set([profileModel(p), ...sameProvider].filter(Boolean));
    return [...ids].map((id) => `codex@${p}/${id}`);
  });
}

/** `opencode/openai/gpt-6-sol`: the tier of the model after the provider, as for pi. */
function opencodeLinked(refs: string[]): Linked[] {
  return refs.flatMap((ref) => {
    const tier = inferTier(ref.split("/").slice(2).join("/")) ?? inferTier(ref.split("/").slice(1).join("/"));
    return tier === null ? [] : [{ ref, tier, via: "OpenCode" }];
  });
}

/** Looks for every CLI and model Concerto can use on this machine. Reads no credentials. */
export async function detect(): Promise<Detection> {
  const [claude, codex, pi] = [onPath(claudeBin()), onPath(codexBin()), onPath(piBin())];
  const [piModels, opencode] = await Promise.all([pi ? piRefs() : new Set<string>(), opencodeRefs()]);
  const profiles = codex ? codexProfiles() : [];
  const linked = [
    ...(claude ? tiered(CLAUDE_CODE_MODELS.map((id) => `claude-code/${id}`), "Claude Code subscription") : []),
    ...(codex ? tiered([...codexSlugs()].map((id) => `codex/${id}`), "ChatGPT subscription (Codex)") : []),
    ...tiered(profileRefs(profiles, piModels), "Codex profile"),
    ...tiered([...piModels], "pi"),
    ...opencodeLinked(opencode),
  ];
  return { claude, codex, pi, rtk: onPath("rtk"), profiles, linked };
}
