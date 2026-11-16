/** A run of text on one side, marked when the other side does not have it. */
export type Piece = { text: string; changed: boolean };
/** One row of a side-by-side diff: old on the left, new on the right. */
export type Row = { kind: "hunk" | "same" | "change" | "add" | "del"; left: Piece[]; right: Piece[] };

const TOKEN = /\s+|[\p{L}\p{N}_$]+|[^\s\p{L}\p{N}_$]/gu;
const whole = (text: string): Piece[] => (text ? [{ text, changed: false }] : []);
const joinPieces = (parts: Piece[]) => parts.reduce<Piece[]>((out, p) => {
  const last = out.at(-1);
  if (last && last.changed === p.changed) last.text += p.text;
  else out.push({ ...p });
  return out;
}, []);

/** Word-level difference of two lines: the longest common run of tokens is kept, the rest marked. */
export function wordDiff(before: string, after: string): { left: Piece[]; right: Piece[] } {
  const [a, b] = [before.match(TOKEN) ?? [], after.match(TOKEN) ?? []];
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const row = lcs[i] as number[];
      row[j] = a[i] === b[j] ? (lcs[i + 1]?.[j + 1] ?? 0) + 1 : Math.max(lcs[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const [left, right]: [Piece[], Piece[]] = [[], []];
  let [i, j] = [0, 0];
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      left.push({ text: a[i++] ?? "", changed: false });
      right.push({ text: b[j++] ?? "", changed: false });
    } else if (j < b.length && (i >= a.length || (lcs[i]?.[j + 1] ?? 0) >= (lcs[i + 1]?.[j] ?? 0))) right.push({ text: b[j++] ?? "", changed: true });
    else left.push({ text: a[i++] ?? "", changed: true });
  }
  return { left: joinPieces(left), right: joinPieces(right) };
}

/** Pairs a block of removed lines with the added lines after it, row by row. */
function pair(removed: string[], added: string[]): Row[] {
  return Array.from({ length: Math.max(removed.length, added.length) }, (_, k) => {
    const [l, r] = [removed[k], added[k]];
    if (l !== undefined && r !== undefined) return { kind: "change", ...wordDiff(l, r) };
    return l !== undefined ? { kind: "del", left: [{ text: l, changed: true }], right: [] } : { kind: "add", left: [], right: [{ text: r ?? "", changed: true }] };
  });
}

/** A unified diff as side-by-side rows; file headers are dropped, hunk headers kept. */
export function sideBySide(diff: string): Row[] {
  const rows: Row[] = [];
  let removed: string[] = [];
  let added: string[] = [];
  const flush = () => {
    rows.push(...pair(removed, added));
    [removed, added] = [[], []];
  };
  for (const line of diff.split("\n")) {
    if (/^(diff |index |--- |\+\+\+ )/.test(line)) continue;
    if (line.startsWith("-")) removed.push(line.slice(1));
    else if (line.startsWith("+")) added.push(line.slice(1));
    else {
      flush();
      if (line.startsWith("@@")) rows.push({ kind: "hunk", left: whole(line), right: [] });
      else if (line) rows.push({ kind: "same", left: whole(line.slice(1)), right: whole(line.slice(1)) });
    }
  }
  flush();
  return rows;
}
