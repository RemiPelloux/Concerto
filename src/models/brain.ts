import type { Role } from "#src/config/types.js";
import { Catalog } from "#src/models/catalog.js";
import type { ModelInfo } from "#src/models/types.js";

/** Roles that think: they plan, score, review and build the hard stories. */
export const BRAIN_ROLES: ReadonlySet<Role> = new Set(["conductor", "scorer", "critic", "soloist"]);

/**
 * Low-cost families. They build light stories; they never plan, score, review or build hard ones.
 * Matched as a whole part of the id (`gpt-5-mini`, `gemini-2.5-flash`), never inside a word:
 * `gemini` holds `mini` and is not cheap.
 */
const CHEAP = /(?:^|[-_/.:])(?:deepseek|grok|haiku|terra|luna|flash|glm|mini|nano)(?=$|[-_/.:\d])/i;

export function isCheapModel(m: ModelInfo): boolean {
  return CHEAP.test(m.parsed.id);
}

/** The models a role may use: every one for the section, premium ones only for a brain role. */
export function catalogFor(catalog: Catalog, role: Role): Catalog {
  if (!BRAIN_ROLES.has(role)) return catalog;
  const premium = catalog.models.filter((m) => !isCheapModel(m));
  if (premium.length === 0 && catalog.models.length > 0) {
    throw new Error(`The ${role} needs a premium model (Claude Fable, Opus or Sonnet, GPT Astra or Sol) and none is reachable. Run /config auto.`);
  }
  return new Catalog(premium);
}
