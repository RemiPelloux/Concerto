/**
 * Condenses text Concerto feeds back into prompts: critiques, logs, test output.
 * Same idea as rtk, which condenses shell output inside the agents; this covers what
 * Concerto itself injects. Never touches code blocks the model must copy exactly.
 */

export type CondenseOptions = { maxLines: number; maxLineChars: number; headLines: number };

export const DEFAULT_CONDENSE: CondenseOptions = { maxLines: 80, maxLineChars: 240, headLines: 30 };

// eslint-disable-next-line no-control-regex -- ANSI escape sequences start with ESC by definition
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;
/** Spinner frames, bracketed progress bars, percentage bars, npm notices. Markdown rules survive. */
const NOISE = /^\s*(?:[⠁-⣿]\s|\[[=#>.\s-]{5,}\]|\d{1,3}%\s*[|█▉▊▋▌▍▎▏]+|npm notice\b)/;
const FENCE = "```";

function clampLine(line: string, max: number): string {
  return line.length > max ? `${line.slice(0, max)} …[+${line.length - max} chars]` : line;
}

/** Collapses runs of identical lines into one line with a count. */
export function collapseRepeats(lines: string[]): string[] {
  const out: string[] = [];
  let count = 0;
  lines.forEach((line, i) => {
    count += 1;
    if (lines[i + 1] === line) return;
    out.push(count > 1 ? `${line}  (×${count})` : line);
    count = 0;
  });
  return out;
}

function keepHeadAndTail(lines: string[], opts: CondenseOptions): string[] {
  if (lines.length <= opts.maxLines) return lines;
  const tail = opts.maxLines - opts.headLines;
  const dropped = lines.length - opts.maxLines;
  return [...lines.slice(0, opts.headLines), `… ${dropped} lines elided …`, ...lines.slice(-tail)];
}

function condenseProse(text: string, opts: CondenseOptions): string {
  const lines = text
    .replace(ANSI, "")
    .split(/\r?\n|\r/)
    .map((l) => l.trimEnd())
    .filter((l) => !NOISE.test(l));
  const squeezed = collapseRepeats(lines).filter((l, i, all) => l !== "" || all[i - 1] !== "");
  return keepHeadAndTail(squeezed.map((l) => clampLine(l, opts.maxLineChars)), opts).join("\n");
}

/** Condenses everything outside fenced code blocks; fenced blocks pass through unchanged. */
export function condense(text: string, opts: CondenseOptions = DEFAULT_CONDENSE): string {
  return text
    .split(FENCE)
    .map((part, i) => (i % 2 === 1 ? part : condenseProse(part, opts)))
    .join(FENCE)
    .trim();
}

/** Rough token count for savings reports: about four characters per token. */
export function approxTokens(text: string): number {
  const CHARS_PER_TOKEN = 4;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
