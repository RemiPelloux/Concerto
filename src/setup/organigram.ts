import { ROLES, type ConcertoConfig, type Role } from "#src/config/types.js";
import { BRAIN_ROLES, isCheapModel } from "#src/models/brain.js";
import { Catalog } from "#src/models/catalog.js";
import { roleChain, tierChain } from "#src/models/router.js";
import type { ModelInfo } from "#src/models/types.js";

/** One model and its fallbacks per role. */
const PICKS = 4;
const ROLE_WIDTH = 10;
const REF_WIDTH = 34;

const DUTY: Record<Role, string> = {
  rewriter: "sharpens the request, asks, writes the design brief",
  conductor: "plans the request and splits it into stories",
  scorer: "scores each story",
  soloist: "builds the hard stories",
  section: "builds the light stories",
  critic: "reviews every story",
};

const isClaude = (m: ModelInfo) => m.parsed.id.startsWith("claude-");

/** Claude thinks better than GPT at the same job: brain roles try Claude models first, GPT after. */
export function claudeFirst(models: ModelInfo[]): ModelInfo[] {
  return [...models.filter(isClaude), ...models.filter((m) => !isClaude(m))];
}

/**
 * The best model for each role among the ones that answered: the cheapest at the role's tier,
 * subscriptions weighed as prepaid. Brain roles only consider premium models, Claude first.
 */
export function proposeRoles(roles: ConcertoConfig["roles"], catalog: Catalog): ConcertoConfig["roles"] {
  const premium = new Catalog(catalog.models.filter((m) => !isCheapModel(m)));
  const pick = (role: Role) => {
    const brain = BRAIN_ROLES.has(role);
    const pool = brain ? premium : catalog;
    const chain = pool.models.length > 0 ? tierChain(pool, roles[role].minTier) : [];
    const models = (brain ? claudeFirst(chain) : chain).slice(0, PICKS).map((m) => m.ref);
    return { ...roles[role], models };
  };
  return Object.fromEntries(ROLES.map((r) => [r, pick(r)])) as ConcertoConfig["roles"];
}

function roleLine(catalog: Catalog, config: ConcertoConfig, role: Role): string {
  const head = role === "conductor" ? role : `├─ ${role}`;
  const brain = BRAIN_ROLES.has(role) ? " · premium only" : "";
  try {
    const [first, ...rest] = roleChain(catalog, config, role).map((m) => m.ref);
    const then = rest.length > 0 ? `   then ${rest.join(", ")}` : "";
    return `${head.padEnd(ROLE_WIDTH)} ${(first ?? "").padEnd(REF_WIDTH)} ${DUTY[role]}${brain}${then}`;
  } catch {
    return `${head.padEnd(ROLE_WIDTH)} ${"(none reachable)".padEnd(REF_WIDTH)} ${DUTY[role]}${brain}`;
  }
}

/** Who does what: the conductor on top, every other role under it, as the router will run them. */
export function organigramLines(catalog: Catalog, config: ConcertoConfig): string[] {
  const lines = ROLES.map((role) => roleLine(catalog, config, role));
  const last = lines.length - 1;
  lines[last] = (lines[last] ?? "").replace("├─", "└─");
  return [...lines, "Deepseek, Grok, Haiku, GPT Terra and Luna never plan, score, review or build hard stories."];
}
