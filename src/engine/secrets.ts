/** What a secret looks like: provider keys, tokens, private keys. Each with what to call it. */
const SECRETS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, "a private key"],
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, "an API key"],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/g, "a GitHub token"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "a Slack token"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "an AWS access key"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "a bearer token"],
];
const NAMES = "api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|passwd|token";
/** `password=…`, `api_key: …` in a log: the name stays, the value goes. */
const ASSIGNED = new RegExp(`\\b((?:${NAMES})["']?\\s*[:=]\\s*["']?)[^\\s"',;]{4,}`, "gi");
/** In code only a quoted literal counts: `password = "hunter22"`, never `token = makeToken()`. */
const LITERAL = new RegExp(`\\b(?:${NAMES})["']?\\s*[:=]\\s*["'][^\\s"'$]{8,}["']`, "i");
const PLACEHOLDER = /["'](?:x+|\*+|changeme|example|your[-_]?\w*|<[^>]*>|\.\.\.|test\w*|dummy\w*)["']/i;

/** The text with anything shaped like a secret replaced by [redacted]. */
export function scrub(text: string): string {
  return SECRETS.reduce((t, [pattern]) => t.replace(pattern, "[redacted]"), text).replace(ASSIGNED, "$1[redacted]");
}

export type Found = { file: string; line: number; kind: string };

function kindOf(text: string): string | null {
  const hit = SECRETS.find(([pattern]) => new RegExp(pattern.source, pattern.flags.replace("g", "")).test(text));
  if (hit) return hit[1];
  return LITERAL.test(text) && !PLACEHOLDER.test(text) ? "a password or token in a string" : null;
}

/** Secrets on the lines a unified diff adds, with the file and the new line number of each. */
export function findSecrets(diff: string): Found[] {
  const found: Found[] = [];
  let [file, line] = ["", 0];
  for (const text of diff.split("\n")) {
    if (text.startsWith("+++ ")) file = text.slice("+++ ".length).replace(/^b\//, "");
    else if (text.startsWith("@@")) line = Number(/\+(\d+)/.exec(text)?.[1] ?? 0);
    else if (text.startsWith("+")) {
      const kind = kindOf(text.slice(1));
      if (kind) found.push({ file, line, kind });
      line += 1;
    } else if (!text.startsWith("-")) line += 1;
  }
  return found;
}
