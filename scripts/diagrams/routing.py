"""Generates assets/routing.svg. Usage: python3 routing.py <out>"""
import sys

BG, PANEL, LINE, RAISED = "#0E0F12", "#15171C", "#2A2D35", "#1B1E24"
TEXT, DIM = "#E6E3DC", "#8A8F98"
CORAL, BLUE, GREEN, AMBER, TEAL, BRASS = "#E8826A", "#6AA5FF", "#4FD08A", "#E0B450", "#57C7C1", "#E0A458"
MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', monospace"
DUR = "9s"

# title, detail, score, ui?, target (x, y), reviewer label, reviewer colour
STORIES = [
    ("Dark mode for settings", "3 pts · complexity 2 · risk 2", 28, True, (440, 92), "gpt-6-astra", TEAL),
    ("Port auth handlers", "8 pts · complexity 4 · risk 4", 76, False, (440, 168), "critic · sonnet-5.5", BLUE),
    ("Port JSON helpers", "2 pts · complexity 2 · risk 2", 24, False, (440, 346), "critic · sonnet-5.5", BLUE),
    ("Add request logging", "3 pts · complexity 3 · risk 2", 41, False, (440, 422), "critic · sonnet-5.5", BLUE),
]
START_X, START_Y, STEP = 30, 236, 70
CARD_W, CARD_H = 300, 58
APPEAR = [12, 15, 18, 21]
MOVE = [30, 35, 40, 45]
CHECK = [60, 64, 68, 72]


def card(i, story):
    title, detail, score, ui, (x, y), _, _ = story
    score_color = CORAL if score >= 55 else TEXT
    tag = ""
    if ui:
        tag = f'<rect x="{x + 200}" y="{y + 9}" width="34" height="18" rx="9" fill="#3A2A22"/><text x="{x + 217}" y="{y + 22}" fill="{CORAL}" font-size="11" text-anchor="middle">ui</text>'
    return f'''<g class="card k{i}">
    <rect x="{x}" y="{y}" width="{CARD_W}" height="{CARD_H}" rx="8" fill="{RAISED}" stroke="{AMBER}" stroke-width="1.2"/>
    <text x="{x + 14}" y="{y + 23}" fill="{TEXT}" font-size="13" font-weight="700">{title}</text>
    <text x="{x + 14}" y="{y + 43}" fill="{DIM}" font-size="11.5">{detail}</text>
    {tag}
    <text x="{x + CARD_W - 14}" y="{y + 38}" fill="{score_color}" font-size="24" font-weight="700" text-anchor="end">{score}</text>
  </g>'''


def review(i, story):
    _, _, _, _, (x, y), label, color = story
    cy = y + CARD_H / 2
    rx = 800
    return f'''<path d="M{x + CARD_W},{cy} L{rx},{cy}" stroke="{LINE}" stroke-width="1.5" stroke-dasharray="4 5"/>
  <rect x="{rx}" y="{cy - 17}" width="230" height="34" rx="17" fill="{PANEL}" stroke="{color}" stroke-width="1.2"/>
  <text x="{rx + 16}" y="{cy + 4.5}" fill="{color}" font-size="12.5">{label}</text>
  <g class="chk c{i}"><circle cx="{rx + 260}" cy="{cy}" r="13" fill="#133325" stroke="{GREEN}" stroke-width="1.2"/>
  <path d="M{rx + 253},{cy} l5,5 l9,-10" stroke="{GREEN}" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>'''


def keyframes():
    out = []
    for i, s in enumerate(STORIES):
        tx, ty = s[4]
        dx, dy = START_X - tx, START_Y + i * STEP - ty
        a, m, c = APPEAR[i], MOVE[i], CHECK[i]
        out.append(f"""@keyframes k{i} {{
  0%, {a}% {{ opacity: 0; transform: translate({dx}px, {dy + 10}px); }}
  {a + 3}%, {m}% {{ opacity: 1; transform: translate({dx}px, {dy}px); }}
  {m + 10}%, 92% {{ opacity: 1; transform: translate(0, 0); }}
  96%, 100% {{ opacity: 0; transform: translate(0, 0); }}
}}
.k{i} {{ animation: k{i} {DUR} cubic-bezier(.45,0,.2,1) infinite; }}
@keyframes c{i} {{ 0%, {c}% {{ opacity: 0; transform: scale(.4); }} {c + 2}%, 92% {{ opacity: 1; transform: scale(1); }} 96%, 100% {{ opacity: 0; transform: scale(1); }} }}
.c{i} {{ animation: c{i} {DUR} ease-out infinite; }}""")
    return "\n".join(out)


STYLE = f"""
text {{ font-family: {MONO}; white-space: pre; }}
.chk {{ transform-box: fill-box; transform-origin: center; }}
@keyframes scorer {{ 0%, 4% {{ stroke: {LINE}; }} 6%, 22% {{ stroke: {AMBER}; }} 26%, 100% {{ stroke: {LINE}; }} }}
.scorer {{ stroke: {AMBER}; animation: scorer {DUR} linear infinite; }}
@keyframes flow {{ 0% {{ stroke-dashoffset: 18; }} 100% {{ stroke-dashoffset: 0; }} }}
.flow {{ animation: flow 1s linear infinite; }}
{keyframes()}
@keyframes legend {{ 0%, 52% {{ opacity: 0; }} 56%, 92% {{ opacity: 1; }} 96%, 100% {{ opacity: 0; }} }}
.legend {{ animation: legend {DUR} linear infinite; }}
@media (prefers-reduced-motion: reduce) {{
  * {{ animation: none !important; }}
}}
"""


def lane(y, h, title, rule):
    return f'''<rect x="420" y="{y}" width="760" height="{h}" rx="10" fill="{PANEL}"/>
  <text x="440" y="{y + 28}" fill="{CORAL}" font-size="14" font-weight="700">● {title}</text>
  <text x="440" y="{y + 48}" fill="{DIM}" font-size="12">{rule}</text>
  <text x="800" y="{y + 28}" fill="{DIM}" font-size="12">review</text>'''


def build():
    cards = "\n  ".join(card(i, s) for i, s in enumerate(STORIES))
    reviews = "\n  ".join(review(i, s) for i, s in enumerate(STORIES))
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 520" width="1200" height="520" role="img" aria-labelledby="t d">
  <title id="t">How Concerto routes stories</title>
  <desc id="d">The scorer splits a request into four stories with points and a 0 to 100 score. The UI story and the story scored 76 go to Claude Opus 5.5; the stories scored 24 and 41 go to GPT-6.1 Sol. The UI story is reviewed by GPT-6 Astra, the others by the critic.</desc>
  <style>{STYLE}</style>
  <rect width="1200" height="520" rx="14" fill="{BG}"/>

  <rect x="30" y="30" width="300" height="76" rx="8" fill="{PANEL}" stroke="{BRASS}" stroke-width="1.2"/>
  <text x="46" y="56" fill="{DIM}" font-size="12">request</text>
  <text x="46" y="80" fill="{TEXT}" font-size="13.5">Move the API to Rust.</text>
  <text x="46" y="97" fill="{DIM}" font-size="11.5">Done means: every test passes.</text>
  <path class="flow" d="M180,106 L180,134" stroke="{AMBER}" stroke-width="1.5" stroke-dasharray="3 6"/>
  <rect class="scorer" x="30" y="134" width="300" height="62" rx="8" fill="{PANEL}" stroke-width="1.5"/>
  <text x="46" y="160" fill="{AMBER}" font-size="13.5" font-weight="700">● scorer</text>
  <text x="46" y="181" fill="{DIM}" font-size="11.5">50% complexity + 30% risk + 20% pts</text>
  <path class="flow" d="M180,196 L180,226" stroke="{AMBER}" stroke-width="1.5" stroke-dasharray="3 6"/>

  <g class="legend" font-size="12.5" xml:space="preserve">
    <text x="30" y="290" fill="{DIM}">rules, in order</text>
    <text x="30" y="322" fill="{TEXT}">ui/ux tag       <tspan fill="{CORAL}">→ opus-5.5</tspan></text>
    <text x="30" y="348" fill="{TEXT}">score ≥ 55      <tspan fill="{CORAL}">→ opus-5.5</tspan></text>
    <text x="30" y="374" fill="{TEXT}">anything else   <tspan fill="{CORAL}">→ gpt-6.1-sol</tspan></text>
    <text x="30" y="414" fill="{TEXT}">ui/ux review    <tspan fill="{TEAL}">→ astra</tspan></text>
    <text x="30" y="440" fill="{TEXT}">other reviews   <tspan fill="{BLUE}">→ critic</tspan></text>
  </g>

  {lane(30, 222, "claude-opus-5.5 · Claude Code", "UI/UX stories, or score 55 and up")}
  {lane(284, 222, "gpt-6.1-sol · Codex", "score under 55")}
  {reviews}
  {cards}
</svg>
'''


if __name__ == "__main__":
    with open(sys.argv[1], "w", encoding="utf-8") as f:
        f.write(build())
