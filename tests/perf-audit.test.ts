import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const DOC = join(ROOT, "docs", "perf-audit.md");
const FINDINGS_HEADING = "### Findings";
const ROW_START = "| `";
const ROW = /^\| `([^`]+)` \| (\d+) \| (.+?) \| (.+?) \| (fix-now|leave): (.+) \|$/;

const readSource = (file: string): string | null => (existsSync(join(ROOT, file)) ? readFileSync(join(ROOT, file), "utf8") : null);

/** Rows of the findings table; a malformed row is reported, never skipped. */
function parseRows(doc: string): { rows: RegExpExecArray[]; malformed: string[] } {
  const section = doc.split(FINDINGS_HEADING)[1]?.split(/^### /m)[0] ?? "";
  const lines = section.split("\n").filter((line) => line.startsWith(ROW_START));
  const rows = lines.map((line) => ROW.exec(line)).filter((m): m is RegExpExecArray => m !== null);
  return { rows, malformed: lines.filter((line) => !ROW.test(line)) };
}

/** Each finding must name a file, a line that awaits, a verdict and a reason. */
function problems(doc: string, source: (file: string) => string | null): string[] {
  const { rows, malformed } = parseRows(doc);
  if (rows.length === 0) return ["no findings rows under the Findings heading"];
  return [...malformed.map((line) => `malformed row: ${line}`), ...rows.flatMap(([, file = "", line = ""]) => checkCite(file, Number(line), source))];
}

function checkCite(file: string, line: number, source: (file: string) => string | null): string[] {
  const text = source(file);
  if (text === null) return [`${file}: file does not exist`];
  return (text.split("\n")[line - 1] ?? "").includes("await") ? [] : [`${file}:${line}: cited line has no await`];
}

describe("docs/perf-audit.md N+1 findings", () => {
  it("cites a real await with a verdict and a reason for every finding", () => {
    expect(problems(readFileSync(DOC, "utf8"), readSource)).toEqual([]);
  });

  it("reports a row whose cited line has no await", () => {
    const doc = readFileSync(DOC, "utf8").replace("| `src/engine/checks.ts` | 105 |", "| `src/engine/checks.ts` | 1 |");
    expect(problems(doc, readSource)).toEqual(["src/engine/checks.ts:1: cited line has no await"]);
  });
});
