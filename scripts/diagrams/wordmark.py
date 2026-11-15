"""Generates docs/assets/wordmark.svg: the terminal CONCERTO logo, block for block.

Same glyphs and colours as src/ui/Banner.tsx: one block per terminal cell, cells twice as tall
as they are wide, the top two rows brass and the rest deep brass.
Usage: python3 wordmark.py <out>
"""
import sys

GLYPHS = {
    "C": [" ████", "██   ", "██   ", "██   ", " ████"],
    "O": [" ███ ", "██ ██", "██ ██", "██ ██", " ███ "],
    "N": ["██  ██", "███ ██", "██████", "██ ███", "██  ██"],
    "E": ["█████", "██   ", "████ ", "██   ", "█████"],
    "R": ["████ ", "██ ██", "████ ", "██ ██", "██  █"],
    "T": ["██████", "  ██  ", "  ██  ", "  ██  ", "  ██  "],
}
WORD, CELL_W, CELL_H = "CONCERTO", 4, 8
BRASS, BRASS_DEEP = "#E0A458", "#9C6B2E"

rows = [" ".join(GLYPHS[c][r] for c in WORD) for r in range(5)]
width, height = max(len(r) for r in rows) * CELL_W, len(rows) * CELL_H
rects = []
for y, row in enumerate(rows):
    x = 0
    while x < len(row):
        if row[x] != "█":
            x += 1
            continue
        start = x
        while x < len(row) and row[x] == "█":
            x += 1
        colour = BRASS if y < 2 else BRASS_DEEP
        rects.append(f'<rect x="{start * CELL_W}" y="{y * CELL_H}" width="{(x - start) * CELL_W}" height="{CELL_H}" fill="{colour}"/>')

svg = (
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}" '
    f'role="img" aria-label="Concerto" shape-rendering="crispEdges"><title>Concerto</title>{"".join(rects)}</svg>\n'
)
open(sys.argv[1], "w").write(svg)
