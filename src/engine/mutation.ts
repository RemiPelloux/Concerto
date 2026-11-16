import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isCodeFile, isTestFile } from "#src/engine/import-graph.js";

/** One flipped condition in a line the story added: what a test should notice. */
export type Mutation = { file: string; line: number; from: string; to: string };

/** Most specific first: `===` before `==`, and `<`/`>` only between spaces, so `=>` and generics stay. */
const FLIPS: ReadonlyArray<[string, string]> = [
  ["===", "!=="], ["!==", "==="], ["==", "!="], ["!=", "=="],
  [">=", "<"], ["<=", ">"], [" > ", " <= "], [" < ", " >= "],
  ["&&", "||"], ["||", "&&"], ["true", "false"], ["false", "true"],
];
const WORDS = new Set(["true", "false"]);
const COMMENT = /^\s*(\/\/|#|\*|\/\*|--)/;

const matches = (text: string, from: string) => (WORDS.has(from) ? new RegExp(`\\b${from}\\b`).test(text) : text.includes(from));
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

type Added = { file: string; line: number; text: string };

/** Lines a unified diff (`-U0 --no-prefix`) adds, with their line numbers in the new file. */
export function addedLines(diff: string): Added[] {
  const out: Added[] = [];
  let file = "";
  let next = 0;
  for (const row of diff.split("\n")) {
    if (row.startsWith("+++ ")) file = row.slice("+++ ".length);
    else if (HUNK.test(row)) next = Number(HUNK.exec(row)?.[1] ?? 0);
    else if (row.startsWith("+") && file) out.push({ file, line: next++, text: row.slice(1) });
  }
  return out;
}

/** Whether the story added or changed a test: without one, there is nothing to catch a mutation. */
export function touchesTests(diff: string): boolean {
  return addedLines(diff).some((a) => isTestFile(a.file));
}

/** The first condition in the story's new source lines that can be flipped, or null. */
export function findMutation(diff: string): Mutation | null {
  for (const added of addedLines(diff)) {
    if (!isCodeFile(added.file) || isTestFile(added.file) || COMMENT.test(added.text)) continue;
    const flip = FLIPS.find(([from]) => matches(added.text, from));
    if (flip) return { file: added.file, line: added.line, from: flip[0], to: flip[1] };
  }
  return null;
}

/** Applies the mutation in `dir` and returns what puts the file back exactly as it was. */
export function applyMutation(dir: string, m: Mutation): () => void {
  const path = join(dir, m.file);
  const original = readFileSync(path);
  const lines = original.toString("utf8").split("\n");
  const line = lines[m.line - 1] ?? "";
  lines[m.line - 1] = WORDS.has(m.from) ? line.replace(new RegExp(`\\b${m.from}\\b`), m.to) : line.replace(m.from, m.to);
  writeFileSync(path, lines.join("\n"));
  return () => writeFileSync(path, original);
}
