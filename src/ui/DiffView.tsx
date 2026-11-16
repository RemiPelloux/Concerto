import { Box, Text } from "ink";
import { COLOR } from "#src/ui/theme.js";
import { sideBySide, type Piece, type Row } from "#src/ui/side-by-side.js";

/** Below this width the two columns would be too narrow to read: the unified view is kept. */
export const SIDE_BY_SIDE_COLUMNS = 140;
const GUTTER = 3;
const KEYWORDS = /\b(?:const|let|var|function|return|if|else|for|while|import|export|from|class|def|async|await|new|type|interface|public|private|fn|pub|struct)\b/;

/** Light syntax colour for unchanged lines: comments grey, strings and keywords tinted. */
function syntaxColor(text: string): string | undefined {
  const t = text.trim();
  if (/^(\/\/|#|\*|\/\*)/.test(t)) return "gray";
  if (/^["'`]/.test(t)) return COLOR.good;
  return KEYWORDS.test(t) ? COLOR.brass : undefined;
}

function Side({ pieces, color, width }: { pieces: Piece[]; color: string | undefined; width: number }) {
  return (
    <Box width={width} flexShrink={0} marginRight={GUTTER}>
      <Text color={color} wrap="truncate-end">
        {pieces.length === 0 ? " " : pieces.map((p, i) => <Text key={i} inverse={p.changed && pieces.length > 1}>{p.text}</Text>)}
      </Text>
    </Box>
  );
}

function RowView({ row, width }: { row: Row; width: number }) {
  if (row.kind === "hunk") return <Text color={COLOR.brass} wrap="truncate-end">{row.left[0]?.text ?? ""}</Text>;
  const same = row.kind === "same" ? syntaxColor(row.left[0]?.text ?? "") : undefined;
  return (
    <Box>
      <Side pieces={row.left} color={row.kind === "same" ? same : COLOR.bad} width={width} />
      <Side pieces={row.right} color={row.kind === "same" ? same : COLOR.good} width={width} />
    </Box>
  );
}

/** The diff as two columns, old and new, with the changed words of a changed line marked. */
export function SideBySide({ text, columns, from, height }: { text: string; columns: number; from: number; height: number }) {
  const width = Math.floor((columns - GUTTER * 2) / 2);
  return (
    <Box flexDirection="column">
      {sideBySide(text).slice(from, from + height).map((row, i) => <RowView key={i} row={row} width={width} />)}
    </Box>
  );
}
