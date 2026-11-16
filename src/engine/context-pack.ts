import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { approxTokens } from "#src/engine/condense.js";

const MAX_BYTES = 262_144;
const MAX_LINE = 140;
/** A story's pack stays small: what the builder would otherwise open files to learn. */
export const PACK_TOKENS = 400;

/** Top-level declarations other code can use, per language: the lines worth showing. */
const EXPORTS: Record<string, RegExp> = {
  js: /^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|type|interface|enum|abstract\s+class)\s+[\w$]+.*$/gm,
  py: /^(?:async\s+)?def\s+[A-Za-z]\w*\(.*$|^class\s+\w+.*$/gm,
  go: /^func\s+(?:\([^)]*\)\s*)?[A-Z]\w*\(.*$|^type\s+[A-Z]\w*\s+.*$/gm,
  rs: /^pub\s+(?:async\s+)?(?:fn|struct|enum|trait|type|const)\s+\w+.*$/gm,
};
const LANGUAGE: Record<string, string> = { ".ts": "js", ".tsx": "js", ".js": "js", ".jsx": "js", ".mjs": "js", ".cjs": "js", ".py": "py", ".go": "go", ".rs": "rs" };

/** A declaration without its body: everything up to the opening brace or `=`, one line. */
function signature(line: string): string {
  const head = line.replace(/\s*(\{|=>?\s*\{?)\s*$/, "").replace(/\s*=\s*[^=>].*$/, "");
  return head.length > MAX_LINE ? `${head.slice(0, MAX_LINE - 1)}…` : head;
}

/** The exported declarations of one repository file, or [] when it is new, large or another language. */
export function exportsOf(cwd: string, file: string): string[] {
  const language = LANGUAGE[extname(file)];
  const path = join(cwd, file);
  if (!language || !existsSync(path) || statSync(path).size > MAX_BYTES) return [];
  const pattern = EXPORTS[language];
  return pattern ? [...readFileSync(path, "utf8").matchAll(pattern)].map((m) => signature(m[0].trim())) : [];
}

/**
 * The story's context pack: each existing file it will touch, with what that file exports. Cut
 * at PACK_TOKENS, so a story naming many large files still gets a small, stable segment.
 */
export function contextPack(cwd: string, files: readonly string[]): string {
  const out = ["## Context pack (what the story's files export now)"];
  for (const file of files) {
    const signatures = exportsOf(cwd, file);
    if (signatures.length === 0) continue;
    const block = [`\`${file}\`:`, ...signatures.map((s) => `  ${s}`)];
    if (approxTokens([...out, ...block].join("\n")) > PACK_TOKENS) break;
    out.push(...block);
  }
  return out.length > 1 ? out.join("\n") : "";
}
