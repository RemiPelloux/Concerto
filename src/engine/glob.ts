const WILDCARDS: Record<string, string> = { "**/": "(?:.*/)?", "**": ".*", "*": "[^/]*", "?": "[^/]" };

/** `src/auth/**`, `**\/*.sql`, `infra/*` as a regular expression on repository paths. */
export function glob(pattern: string): RegExp {
  const body = pattern.split(/(\*\*\/|\*\*|\*|\?)/).map((part) => WILDCARDS[part] ?? part.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join("");
  return new RegExp(`^${body}$`);
}

/** The files any of the patterns match. A pattern ending in `/` matches everything under it. */
export function matching(files: readonly string[], patterns: readonly string[]): string[] {
  const res = patterns.map((p) => glob(p.endsWith("/") ? `${p}**` : p));
  return files.filter((f) => res.some((re) => re.test(f)));
}
