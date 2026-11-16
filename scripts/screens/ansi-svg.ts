/**
 * A terminal frame (text with ANSI colour codes, as Ink writes it) as an SVG image in a window,
 * for screenshots that stay sharp at any size and can be regenerated from the code.
 */
const CELL_W = 8.6;
const CELL_H = 19;
const FONT = 14.5;
const PAD = 18;
const BAR = 34;
const RADIUS = 10;
/** The window's three dots and its title. */
const DOT = { gap: 18, r: 6 };
const TITLE = { size: 13, baseline: 5 };
/** The escape character that starts every terminal control sequence. */
const ESC = "\u001b";
const SGR_PART = new RegExp(`(${ESC}\\[[0-9;]*m)`);
const SGR_ONLY = new RegExp(`^${ESC}\\[([0-9;]*)m$`);
/** Cursor moves, clears and mode switches: not part of the picture. */
const CONTROL = new RegExp(`${ESC}\\[\\?[0-9;]*[a-zA-Z]|${ESC}\\[[0-9;]*[A-HJKSTfn]|\\r`, "g");
const BG = "#0f1013";
const FG = "#e6e3dc";
const BASE16 = ["#1d1f24", "#f06a6a", "#4fd08a", "#e0b450", "#6aa5ff", "#b48cff", "#56c8d8", "#d6d2c8", "#5c6070", "#ff8a8a", "#7ee0a8", "#f0cc70", "#8cbcff", "#cba8ff", "#7ed8e6", "#ffffff"];
/** xterm's colour cube: six levels per channel, 6×6×6 colours from index 16. */
const HEX = 16;
const CUBE = "00 5f 87 af d7 ff".split(" ").map((h) => parseInt(h, HEX));
const SIDE = CUBE.length;
const BYTE = 256;
const GRAY_START = 232;
const GRAY_STEP = 10;
const GRAY_BASE = 8;

type Style = { fg?: string; bg?: string; bold: boolean; dim: boolean; italic: boolean; underline: boolean; inverse: boolean };
type Run = { text: string; style: Style };

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((n) => n.toString(HEX).padStart(2, "0")).join("")}`;

/** The 256-colour palette: 16 named, a 6×6×6 cube, then 24 greys. */
function palette(n: number): string {
  if (n < BASE16.length) return BASE16[n] ?? FG;
  if (n >= GRAY_START) {
    const v = GRAY_BASE + (n - GRAY_START) * GRAY_STEP;
    return hex(v, v, v);
  }
  const i = n - BASE16.length;
  return hex(CUBE[Math.floor(i / (SIDE * SIDE))] ?? 0, CUBE[Math.floor(i / SIDE) % SIDE] ?? 0, CUBE[i % SIDE] ?? 0);
}

const plain = (): Style => ({ bold: false, dim: false, italic: false, underline: false, inverse: false });

/** SGR codes: on and off for each attribute, and where the colour ranges start. */
const SGR = { RESET: 0, FG: 38, BG: 48, FG_DEFAULT: 39, BG_DEFAULT: 49, FG_BASE: 30, FG_BRIGHT: 90, BG_BASE: 40, BG_BRIGHT: 100, PALETTE: 5, RGB: 2, SPAN: 8 };
const FLAGS: Record<number, Partial<Style>> = { 1: { bold: true }, 2: { dim: true }, 3: { italic: true }, 4: { underline: true }, 7: { inverse: true }, 22: { bold: false, dim: false }, 23: { italic: false }, 24: { underline: false }, 27: { inverse: false } };
const RGB_PARTS = 3;

const within = (c: number, from: number) => c >= from && c < from + SGR.SPAN;

/** 30–37 and 90–97 set the text colour, 40–47 and 100–107 the background. */
function basic(c: number): Partial<Style> {
  if (within(c, SGR.FG_BASE) || within(c, SGR.FG_BRIGHT)) return { fg: BASE16[within(c, SGR.FG_BRIGHT) ? c - SGR.FG_BRIGHT + SGR.SPAN : c - SGR.FG_BASE] };
  if (within(c, SGR.BG_BASE) || within(c, SGR.BG_BRIGHT)) return { bg: BASE16[within(c, SGR.BG_BRIGHT) ? c - SGR.BG_BRIGHT + SGR.SPAN : c - SGR.BG_BASE] };
  return {};
}

/** `38;5;n` or `38;2;r;g;b` (48 for the background): the colour, and how many codes it used. */
function extended(codes: number[], i: number): [string | undefined, number] {
  if (codes[i + 1] === SGR.PALETTE) return [palette(codes[i + 2] ?? 0), 2];
  if (codes[i + 1] !== SGR.RGB) return [undefined, 0];
  const [r, g, b] = codes.slice(i + 2, i + 2 + RGB_PARTS).map((n) => n % BYTE);
  return [hex(r ?? 0, g ?? 0, b ?? 0), 1 + RGB_PARTS];
}

/** Applies one SGR sequence (the numbers of `ESC [ … m`) to the current style. */
function apply(style: Style, codes: number[]): Style {
  let s = { ...style };
  for (let i = 0; i < codes.length; i += 1) {
    const c = codes[i] ?? SGR.RESET;
    if (c === SGR.RESET) s = plain();
    else if (FLAGS[c]) Object.assign(s, FLAGS[c]);
    else if (c === SGR.FG_DEFAULT || c === SGR.BG_DEFAULT) s[c === SGR.FG_DEFAULT ? "fg" : "bg"] = undefined;
    else if (c === SGR.FG || c === SGR.BG) {
      const [color, used] = extended(codes, i);
      s[c === SGR.FG ? "fg" : "bg"] = color;
      i += used;
    } else Object.assign(s, basic(c));
  }
  return s;
}

/** One line of the frame as runs of text that share a style. */
function runs(line: string, start: Style): { runs: Run[]; end: Style } {
  const out: Run[] = [];
  let style = start;
  for (const part of line.split(SGR_PART)) {
    const sgr = SGR_ONLY.exec(part);
    if (sgr) style = apply(style, (sgr[1] || "0").split(";").map(Number));
    else if (part) out.push({ text: part, style });
  }
  return { runs: out, end: style };
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Columns a character takes: wide East Asian characters and emoji take two. */
const cols = (t: string) => [...t].reduce((n, ch) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Extended_Pictographic}/u.test(ch) ? 2 : 1), 0);

function runSvg(run: Run, x: number, y: number): string {
  const { style: s } = run;
  const [fg, bg] = s.inverse ? [s.bg ?? BG, s.fg ?? FG] : [s.fg ?? FG, s.bg];
  const width = cols(run.text) * CELL_W;
  const rect = bg ? `<rect x="${x.toFixed(1)}" y="${y - FONT}" width="${width.toFixed(1)}" height="${CELL_H}" fill="${bg}"/>` : "";
  // Renderers drop leading spaces in <text>: start the text after them instead.
  const lead = run.text.length - run.text.trimStart().length;
  const attrs = [`x="${(x + lead * CELL_W).toFixed(1)}"`, `y="${y}"`, `fill="${fg}"`, s.bold ? 'font-weight="700"' : "", s.dim ? 'opacity="0.6"' : "", s.italic ? 'font-style="italic"' : "", s.underline ? 'text-decoration="underline"' : ""];
  const text = run.text.trim() ? `<text ${attrs.filter(Boolean).join(" ")}>${esc(run.text.trimStart()).replace(/ /g, "&#160;")}</text>` : "";
  return rect + text;
}

/** The frame as a window: a title bar with three dots, then every line of the terminal. */
export function frameToSvg(frame: string, at: { title: string; columns: number }): string {
  const lines = frame.replace(CONTROL, "").replace(/\n+$/, "").split("\n");
  let style = plain();
  const body = lines.map((line, row) => {
    const parsed = runs(line, style);
    style = parsed.end;
    let x = PAD;
    return parsed.runs.map((run) => {
      const svg = runSvg(run, x, BAR + PAD + row * CELL_H + FONT);
      x += cols(run.text) * CELL_W;
      return svg;
    }).join("");
  }).join("\n");
  const [w, h] = [Math.ceil(at.columns * CELL_W + PAD * 2), Math.ceil(BAR + PAD * 2 + lines.length * CELL_H)];
  const dots = ["#f06a6a", "#e0b450", "#4fd08a"].map((c, i) => `<circle cx="${PAD + i * DOT.gap}" cy="${BAR / 2}" r="${DOT.r}" fill="${c}"/>`).join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="'JetBrains Mono','SFMono-Regular',Menlo,Consolas,monospace" font-size="${FONT}">`,
    `<rect width="${w}" height="${h}" rx="${RADIUS}" fill="${BG}"/>`,
    `<rect width="${w}" height="${BAR}" rx="${RADIUS}" fill="#1a1c21"/><rect y="${BAR - RADIUS}" width="${w}" height="${RADIUS}" fill="#1a1c21"/>`,
    dots,
    `<text x="${w / 2}" y="${BAR / 2 + TITLE.baseline}" fill="#8b8f9a" font-size="${TITLE.size}" text-anchor="middle">${esc(at.title)}</text>`,
    body,
    "</svg>",
  ].join("\n");
}
