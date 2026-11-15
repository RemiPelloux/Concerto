"""Generates assets/cache.svg. Usage: python3 cache.py <out>"""
import sys

BG, PANEL, LINE = "#0E0F12", "#15171C", "#2A2D35"
TEXT, DIM = "#E6E3DC", "#8A8F98"
BRASS, GREEN, PURPLE = "#E0A458", "#4FD08A", "#B48CFF"
MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', monospace"
DUR = "10s"
END = 93

rules = []


def show(name, at):
    rules.append(f"@keyframes {name} {{ 0%, {at}% {{ opacity: 0; }} {at + 1.5}%, {END}% {{ opacity: 1; }} {END + 4}%, 100% {{ opacity: 0; }} }}\n.{name} {{ animation: {name} {DUR} linear infinite; }}")
    return name


def grow(name, a, b):
    rules.append(f"@keyframes {name} {{ 0%, {a}% {{ transform: scaleX(0); }} {b}%, {END}% {{ transform: scaleX(1); }} {END + 4}%, 100% {{ transform: scaleX(1); }} }}\n.{name} {{ animation: {name} {DUR} linear infinite; }}")
    return name


def counter(steps):
    """steps: list of (value, from %, to %)."""
    out = []
    for value, a, b in steps:
        name = f"n{value}"
        if a == 0:
            kf = f"0%, {b}% {{ opacity: 1; }} {b + 0.5}%, {END + 3}% {{ opacity: 0; }} {END + 4}%, 100% {{ opacity: 1; }}"
        else:
            kf = f"0%, {a}% {{ opacity: 0; }} {a + 0.5}%, {b}% {{ opacity: 1; }} {b + 0.5}%, 100% {{ opacity: 0; }}"
        rules.append(f"@keyframes {name} {{ {kf} }}\n.{name} {{ animation: {name} {DUR} linear infinite; }}")
        base = "" if value == steps[-1][0] else ' opacity="0"'
        out.append(f'<text class="{name}"{base} x="1170" y="44" fill="{GREEN}" font-size="22" font-weight="700" text-anchor="end">{value}</text>')
    return "\n  ".join(out)


def bar(x, y, w, color, cls=""):
    c = f' class="{cls}"' if cls else ""
    return f'<rect{c} x="{x}" y="{y}" width="{w}" height="16" rx="3" fill="{color}"/>'


def prefix_panel():
    x = 30
    rows = []
    tails = [70, 96, 54]
    for i, tail in enumerate(tails):
        y = 140 + i * 40
        at = 4 + i * 11
        g = show(f"pr{i}", at)
        hit = ""
        if i > 0:
            hit = bar(x + 84, y, 150, GREEN, show(f"ph{i}", at + 3))
        rows.append(f'''<g class="{g}">
    <text x="{x + 18}" y="{y + 13}" fill="{DIM}" font-size="12">call {i + 1}</text>
    {bar(x + 84, y, 150, BRASS)}{hit}
    {bar(x + 238, y, tail, LINE)}
  </g>''')
    return f'''<rect x="{x}" y="70" width="370" height="250" rx="10" fill="{PANEL}"/>
  <text x="{x + 18}" y="100" fill="{TEXT}" font-size="15" font-weight="700">Stable prefix</text>
  <text x="{x + 18}" y="121" fill="{DIM}" font-size="12">same bytes on every call per role</text>
  {"".join(rows)}
  <text x="{x + 18}" y="282" fill="{DIM}" font-size="12"><tspan fill="{GREEN}">■</tspan> provider cache read</text>
  <text x="{x + 18}" y="302" fill="{DIM}" font-size="12"><tspan fill="{BRASS}">■</tspan> written once  <tspan fill="#555A63">■</tspan> story text</text>'''


def session_panel():
    x = 415
    rows = []
    for i in range(3):
        y = 140 + i * 40
        at = 38 + i * 10
        g = show(f"sr{i}", at)
        reused = 70 * i
        seg = bar(x + 84 + reused, y, 70, PURPLE)
        old = ""
        if i > 0:
            old = bar(x + 84, y, reused, LINE) + bar(x + 84, y, reused, GREEN, show(f"sh{i}", at + 3))
        rows.append(f'''<g class="{g}">
    <text x="{x + 18}" y="{y + 13}" fill="{DIM}" font-size="12">turn {i + 1}</text>
    {old}{seg}
  </g>''')
    return f'''<rect x="{x}" y="70" width="370" height="250" rx="10" fill="{PANEL}"/>
  <text x="{x + 18}" y="100" fill="{TEXT}" font-size="15" font-weight="700">Warm session</text>
  <text x="{x + 18}" y="121" fill="{DIM}" font-size="12">one per story, one for the conductor</text>
  {"".join(rows)}
  <text x="{x + 18}" y="282" fill="{DIM}" font-size="12">later turns reuse the cached</text>
  <text x="{x + 18}" y="302" fill="{DIM}" font-size="12">prefix of earlier ones</text>'''


def local_panel():
    x = 800
    first = show("lr0", 64)
    second = show("lr1", 82)
    return f'''<rect x="{x}" y="70" width="370" height="250" rx="10" fill="{PANEL}"/>
  <text x="{x + 18}" y="100" fill="{TEXT}" font-size="15" font-weight="700">Local response cache</text>
  <text x="{x + 18}" y="121" fill="{DIM}" font-size="12">read-only calls, keyed on the prompt</text>
  <g class="{first}">
    <text x="{x + 18}" y="153" fill="{DIM}" font-size="12">score request, first time</text>
    {bar(x + 18, 164, 300, LINE)}
    {bar(x + 18, 164, 300, BRASS, grow("lg0", 65, 80))}
    <text x="{x + 326}" y="177" fill="{TEXT}" font-size="12">21 s</text>
  </g>
  <g class="{second}">
    <text x="{x + 18}" y="215" fill="{DIM}" font-size="12">same request again</text>
    {bar(x + 18, 226, 300, LINE)}
    {bar(x + 18, 226, 13, GREEN)}
    <text x="{x + 40}" y="239" fill="{GREEN}" font-size="12">0.9 s · 0 tokens</text>
  </g>
  <text x="{x + 18}" y="282" fill="{DIM}" font-size="12">build calls change the tree</text>
  <text x="{x + 18}" y="302" fill="{DIM}" font-size="12">and are never cached</text>'''


def build():
    panels = prefix_panel() + "\n  " + session_panel() + "\n  " + local_panel()
    count = counter([(0, 0, 19), (1, 19, 30), (2, 30, 51), (3, 51, 61), (4, 61, 85), (5, 85, END + 3)])
    style = f"""
text {{ font-family: {MONO}; }}
rect {{ transform-box: fill-box; transform-origin: 0 50%; }}
{chr(10).join(rules)}
@media (prefers-reduced-motion: reduce) {{
  * {{ animation: none !important; }}
}}
"""
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 340" width="1200" height="340" role="img" aria-labelledby="t d">
  <title id="t">Concerto cache layers</title>
  <desc id="d">Three cache layers. A byte-stable system prompt prefix per role gets provider cache reads. Warm sessions reuse earlier turns. A local response cache answers a repeated scoring request in 0.9 seconds with no tokens instead of 21 seconds.</desc>
  <style>{style}</style>
  <rect width="1200" height="340" rx="14" fill="{BG}"/>
  <text x="30" y="44" fill="{TEXT}" font-size="15">Where Concerto saves tokens</text>
  <text x="1130" y="44" fill="{DIM}" font-size="12" text-anchor="end">cache hits</text>
  {count}
  {panels}
</svg>
'''


if __name__ == "__main__":
    out = build()
    with open(sys.argv[1], "w", encoding="utf-8") as f:
        f.write(out)
