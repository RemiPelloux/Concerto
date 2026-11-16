"""Generates assets/hero.svg. Usage: python3 hero.py <out>"""
import sys

BG, PANEL, LINE, TRACK = "#0E0F12", "#15171C", "#2A2D35", "#23262D"
TEXT, DIM = "#E6E3DC", "#8A8F98"
BRASS, BRASS_DEEP = "#E0A458", "#9C6B2E"
PURPLE, CORAL, BLUE, GREEN, AMBER, RED = "#B48CFF", "#E8826A", "#6AA5FF", "#4FD08A", "#E0B450", "#F06A6A"
MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', monospace"

GLYPHS = {
    "C": [" ████", "██   ", "██   ", "██   ", " ████"],
    "O": [" ███ ", "██ ██", "██ ██", "██ ██", " ███ "],
    "N": ["██  ██", "███ ██", "██████", "██ ███", "██  ██"],
    "E": ["█████", "██   ", "████ ", "██   ", "█████"],
    "R": ["████ ", "██ ██", "████ ", "██ ██", "██  █"],
    "T": ["██████", "  ██  ", "  ██  ", "  ██  ", "  ██  "],
}


def wordmark(x0, y0, cw, ch, word="CONCERTO"):
    out = []
    for r in range(5):
        line = " ".join(GLYPHS[c][r] for c in word)
        color = BRASS if r < 2 else BRASS_DEEP
        x = 0
        while x < len(line):
            if line[x] == "█":
                start = x
                while x < len(line) and line[x] == "█":
                    x += 1
                out.append(f'<rect x="{x0 + start * cw}" y="{y0 + r * ch}" width="{(x - start) * cw}" height="{ch - 2}" fill="{color}"/>')
            else:
                x += 1
    return "\n    ".join(out)


def node(x, y, w, h, color, title, sub, cls=""):
    c = f' class="{cls}"' if cls else ""
    return f'''<g>
    <rect{c} x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{PANEL}" stroke="{color}" stroke-width="1.5"/>
    <text x="{x + 14}" y="{y + 21}" fill="{color}" font-size="13" font-weight="700">{title}</text>
    <text x="{x + 14}" y="{y + 39}" fill="{DIM}" font-size="11.5">{sub}</text>
  </g>'''


def pill(i, y, title, question):
    return f'''<g>
    <rect class="pill p{i}" x="60" y="{y}" width="260" height="34" rx="17" stroke-width="1.5"/>
    <text class="mark-off p{i}t" x="78" y="{y + 22}" fill="{DIM}" font-size="13">› {title}</text>
    <text class="mark-on p{i}t" x="78" y="{y + 22}" fill="{PURPLE}" font-size="13" font-weight="700">✓ {title}</text>
    <text x="64" y="{y + 54}" fill="{DIM}" font-size="11.5">{question}</text>
  </g>'''


def path(pid, d, color, dot_cls):
    return f'''<path d="{d}" stroke="{LINE}" stroke-width="1.5" fill="none"/>
  <path class="dot {dot_cls}" d="{d}" pathLength="100" stroke="{color}" stroke-width="8" stroke-linecap="round" fill="none" stroke-dasharray="0.001 200"/>'''


DISPATCH = [
    ("d1", "M540,247 C572,247 568,175 600,175", CORAL),
    ("d2", "M540,247 L600,247", CORAL),
    ("d3", "M540,247 C572,247 568,319 600,319", GREEN),
]
REVIEW = [
    ("r1", "M820,175 C852,175 848,247 880,247", BLUE),
    ("r2", "M820,247 L880,247", BLUE),
    ("r3", "M820,319 C852,319 848,247 880,247", BLUE),
]

# Each dot: (class, start %, end %)
DOT_TIMES = {"d1": (10, 22), "d2": (13, 25), "d3": (16, 28),
             "r1": (44, 54), "r2": (47, 57), "r3": (50, 60), "v": (63, 70)}


def dot_keyframes():
    out = []
    for name, (a, b) in DOT_TIMES.items():
        out.append(f"""@keyframes {name} {{
  0%, {a - 0.5}% {{ stroke-dashoffset: 0; opacity: 0; }}
  {a}% {{ stroke-dashoffset: 0; opacity: 1; }}
  {b}% {{ stroke-dashoffset: -100; opacity: 1; }}
  {b + 0.5}%, 100% {{ stroke-dashoffset: -100; opacity: 0; }}
}}
.{name} {{ animation: {name} 8s linear infinite; }}""")
    return "\n".join(out)


def pill_keyframes():
    out = []
    for i, on in ((1, 6), (2, 38), (3, 74)):
        out.append(f"""@keyframes p{i} {{
  0%, {on}% {{ fill: {PANEL}; stroke: {LINE}; }}
  {on + 1.5}%, 92% {{ fill: #2A2140; stroke: {PURPLE}; }}
  95%, 100% {{ fill: {PANEL}; stroke: {LINE}; }}
}}
@keyframes p{i}on {{ 0%, {on}% {{ opacity: 0; }} {on + 1.5}%, 92% {{ opacity: 1; }} 95%, 100% {{ opacity: 0; }} }}
@keyframes p{i}off {{ 0%, {on}% {{ opacity: 1; }} {on + 1.5}%, 92% {{ opacity: 0; }} 95%, 100% {{ opacity: 1; }} }}
.p{i} {{ animation: p{i} 8s linear infinite; }}
.mark-on.p{i}t {{ animation: p{i}on 8s linear infinite; }}
.mark-off.p{i}t {{ animation: p{i}off 8s linear infinite; }}""")
    return "\n".join(out)


def counter_keyframes():
    spans = {0: (None, 6), 1: (6, 38), 2: (38, 74), 3: (74, 93)}
    out = []
    for n, (a, b) in spans.items():
        if a is None:
            kf = f"0%, {b}% {{ opacity: 1; }} {b + 1}%, {93}% {{ opacity: 0; }} 95%, 100% {{ opacity: 1; }}"
        else:
            kf = f"0%, {a}% {{ opacity: 0; }} {a + 1}%, {b}% {{ opacity: 1; }} {b + 1}%, 100% {{ opacity: 0; }}"
            if n == 3:
                kf = f"0%, {a}% {{ opacity: 0; }} {a + 1}%, 92% {{ opacity: 1; }} 94%, 100% {{ opacity: 0; }}"
        out.append(f"@keyframes c{n} {{ {kf} }}\n.c{n} {{ animation: c{n} 8s linear infinite; }}")
    return "\n".join(out)


STYLE = f"""
text {{ font-family: {MONO}; }}
.pill {{ fill: #2A2140; stroke: {PURPLE}; }}
.mark-off {{ opacity: 0; }}
.dot {{ opacity: 0; }}
.c0, .c1, .c2 {{ opacity: 0; }}
.bar {{ transform-box: fill-box; transform-origin: 0 50%; }}
.money {{ opacity: 1; }}
.verify {{ fill: #133325; stroke: {GREEN}; }}
.check {{ opacity: 1; }}
.flash {{ stroke: {CORAL}; }}
.cell {{ fill: {GREEN}; }}
@keyframes bar {{ 0%, 10% {{ transform: scaleX(0); }} 70%, 92% {{ transform: scaleX(1); }} 99%, 100% {{ transform: scaleX(0); }} }}
@keyframes money {{ 0%, 70% {{ opacity: 0; }} 73%, 92% {{ opacity: 1; }} 95%, 100% {{ opacity: 0; }} }}
@keyframes verify {{ 0%, 69% {{ fill: {PANEL}; stroke: {LINE}; }} 71%, 92% {{ fill: #133325; stroke: {GREEN}; }} 95%, 100% {{ fill: {PANEL}; stroke: {LINE}; }} }}
@keyframes check {{ 0%, 59% {{ opacity: 0; }} 61%, 92% {{ opacity: 1; }} 95%, 100% {{ opacity: 0; }} }}
@keyframes flash {{ 0%, 31% {{ stroke: {CORAL}; }} 32%, 37% {{ stroke: {RED}; }} 39%, 100% {{ stroke: {CORAL}; }} }}
@keyframes cell {{ 0%, 26% {{ fill: {LINE}; }} 30%, 92% {{ fill: {GREEN}; }} 96%, 100% {{ fill: {LINE}; }} }}
.bar {{ animation: bar 8s cubic-bezier(.3,.7,.3,1) infinite; }}
.money {{ animation: money 8s linear infinite; }}
.verify {{ animation: verify 8s linear infinite; }}
.check {{ animation: check 8s linear infinite; }}
.flash {{ animation: flash 8s linear infinite; }}
.cell {{ animation: cell 8s linear infinite; }}
.cell.s2 {{ animation-delay: .15s; }} .cell.s3 {{ animation-delay: .3s; }}
{pill_keyframes()}
{counter_keyframes()}
{dot_keyframes()}
@media (prefers-reduced-motion: reduce) {{
  *, .dot, .bar, .pill, .mark-on, .mark-off {{ animation: none !important; }}
  .c3 {{ opacity: 1; }}
}}
"""


def build():
    paths = "\n  ".join(path(p, d, c, p) for p, d, c in DISPATCH + REVIEW)
    paths += "\n  " + path("v", "M1010,247 L1050,247", GREEN, "v")
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 560" width="1200" height="560" role="img" aria-labelledby="t d">
  <title id="t">Concerto</title>
  <desc id="d">A request is split into scored stories, each built by the model that fits it in its own git worktree, checked by the project's tests and a critic from another vendor, then merged. The conductor wakes at three checkpoints. Using the conductor model only as the brain costs a fraction of running it alone.</desc>
  <style>{STYLE}</style>
  <rect width="1200" height="560" rx="14" fill="{BG}"/>

  <g aria-hidden="true">
    {wordmark(40, 34, 11, 14)}
  </g>
  <text x="640" y="58" fill="{TEXT}" font-size="17">One request in. Tested, reviewed, merged work out.</text>
  <text x="640" y="84" fill="{DIM}" font-size="13">Nine coding agents, each story on the model that fits it.</text>

  <!-- conductor -->
  <rect x="40" y="140" width="300" height="384" rx="10" fill="{PANEL}" stroke="{PURPLE}" stroke-width="1.5"/>
  <text x="60" y="172" fill="{PURPLE}" font-size="14" font-weight="700">● fable-5.2 · on call</text>
  <text x="60" y="194" fill="{DIM}" font-size="12">conductor · reads all, writes nothing</text>
  {pill(1, 222, "before a plan locks", "what did the plan miss?")}
  {pill(2, 304, "error repeats twice", "root cause or rabbit hole?")}
  {pill(3, 386, "before calling done", "did the diff break anything?")}
  <text x="60" y="500" fill="{DIM}" font-size="12">wakes up</text>
  <text class="c0" x="320" y="500" fill="{PURPLE}" font-size="13" text-anchor="end">0 / 3</text>
  <text class="c1" x="320" y="500" fill="{PURPLE}" font-size="13" text-anchor="end">1 / 3</text>
  <text class="c2" x="320" y="500" fill="{PURPLE}" font-size="13" text-anchor="end">2 / 3</text>
  <text class="c3" x="320" y="500" fill="{PURPLE}" font-size="13" text-anchor="end">3 / 3</text>
  <path d="M340,247 L390,247" stroke="{PURPLE}" stroke-width="1.5" stroke-dasharray="4 5" opacity=".7"/>

  <!-- stage -->
  <text x="390" y="132" fill="{DIM}" font-size="12">wave 1 · 5 stories</text>
  {paths}
  {node(390, 222, 150, 50, BRASS, "Task", "dispatch stories")}
  {node(600, 150, 220, 50, CORAL, "● gpt-6.1-sol · worktree", "score 62 · login rate limit")}
  {node(600, 222, 220, 50, CORAL, "● haiku-5.5 · worktree", "score 36 · quota on the account", "flash")}
  {node(600, 294, 220, 50, GREEN, "● qwen3 · swarms", "3 small stories, local")}
  <rect class="cell" x="770" y="304" width="10" height="10" rx="2"/>
  <rect class="cell s2" x="784" y="304" width="10" height="10" rx="2"/>
  <rect class="cell s3" x="798" y="304" width="10" height="10" rx="2"/>
  {node(880, 222, 130, 50, BLUE, "● critic", "after the tests")}
  <text class="check" x="992" y="243" fill="{GREEN}" font-size="14" font-weight="700" text-anchor="end">✓</text>
  <g>
    <rect class="verify" x="1050" y="222" width="120" height="50" rx="8" stroke-width="1.5"/>
    <text x="1110" y="252" fill="{TEXT}" font-size="13" font-weight="700" text-anchor="middle">merged</text>
  </g>

  <!-- cost -->
  <rect x="390" y="380" width="780" height="144" rx="10" fill="{PANEL}" stroke="{LINE}" stroke-width="1.5"/>
  <text x="410" y="410" fill="{DIM}" font-size="12">same job, same tokens · what it costs</text>
  <text x="410" y="452" fill="{TEXT}" font-size="13">conductor alone</text>
  <rect x="590" y="440" width="560" height="16" rx="3" fill="{TRACK}"/>
  <rect class="bar" x="590" y="440" width="560" height="16" rx="3" fill="{RED}"/>
  <text x="410" y="494" fill="{PURPLE}" font-size="13" font-weight="700">as the brain</text>
  <rect x="590" y="482" width="560" height="16" rx="3" fill="{TRACK}"/>
  <rect class="bar" x="590" y="482" width="128" height="16" rx="3" fill="{PURPLE}"/>
  <text class="money" x="1150" y="410" text-anchor="end" fill="{PURPLE}" font-size="12">wakes 3 times, others do the typing</text>
</svg>
'''


if __name__ == "__main__":
    with open(sys.argv[1], "w", encoding="utf-8") as f:
        f.write(build())
