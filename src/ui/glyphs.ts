/** The block font shared by the logo and the build call-out: five rows per letter. */
export const GLYPHS: Record<string, string[]> = {
  B: ["████ ", "██ ██", "████ ", "██ ██", "████ "],
  C: [" ████", "██   ", "██   ", "██   ", " ████"],
  D: ["████ ", "██ ██", "██ ██", "██ ██", "████ "],
  E: ["█████", "██   ", "████ ", "██   ", "█████"],
  I: ["██", "██", "██", "██", "██"],
  L: ["██   ", "██   ", "██   ", "██   ", "█████"],
  N: ["██  ██", "███ ██", "██████", "██ ███", "██  ██"],
  O: [" ███ ", "██ ██", "██ ██", "██ ██", " ███ "],
  P: ["████ ", "██ ██", "████ ", "██   ", "██   "],
  R: ["████ ", "██ ██", "████ ", "██ ██", "██  █"],
  S: [" ████", "██   ", " ███ ", "   ██", "████ "],
  T: ["██████", "  ██  ", "  ██  ", "  ██  ", "  ██  "],
  U: ["██ ██", "██ ██", "██ ██", "██ ██", " ███ "],
  " ": ["  ", "  ", "  ", "  ", "  "],
};
export const GLYPH_ROWS = 5;

/** Each letter of `word` as its rows; accents are dropped ("É" draws as "E"), letters without a glyph left out. */
export function glyphs(word: string): string[][] {
  const plain = word.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
  return [...plain].flatMap((ch) => (GLYPHS[ch] ? [GLYPHS[ch]] : []));
}

/** Columns the word takes in the block font, one space between letters. */
export function glyphWidth(letters: string[][]): number {
  return letters.reduce((sum, g) => sum + (g[0]?.length ?? 0), 0) + Math.max(0, letters.length - 1);
}
