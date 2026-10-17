"""Generate the deterministic demo scene and its placeholder artwork.

Run once from backend/:  python scripts/generate_fixture.py
The output (app/data/demo-board.json and app/static/art/*.svg) is checked in;
the API only ever reads it. Re-running produces byte-identical files.
"""

from __future__ import annotations

import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "app"
ART_DIR = ROOT / "static" / "art"
DATA_FILE = ROOT / "data" / "demo-board.json"

IMAGE_W, IMAGE_H = 200, 290
NOTE_W, NOTE_H = 220, 190
BOARD_W, BOARD_H = 280, 300

PALETTES = {
    "root": ["#FF8E72", "#FFD56E", "#6E8BFF", "#72D9A9", "#2B2340", "#FFF4E8"],
    "colour": ["#FF6B4A", "#FFB547", "#FFDFA8", "#7A2E3B", "#FFF1E6", "#E8505B"],
    "sunset": ["#FF7A59", "#FF4F79", "#7B3FA0", "#FFC46B", "#2A1846", "#FFE3C2"],
    "peach": ["#FFB59A", "#FF9472", "#FFE0CF", "#C8654C", "#FFF6EF", "#F2C4A0"],
    "texture": ["#C9B79C", "#8C6E54", "#E9DFCF", "#4E3B31", "#A3B18A", "#F4EFE6"],
    "fabric": ["#5B6BBF", "#E8C547", "#D9D2C5", "#2F3A64", "#C2554A", "#F5F0E6"],
    "form": ["#17131F", "#6E8BFF", "#FFD56E", "#F3EDE2", "#FF8E72", "#C7AEFF"],
    "letters": ["#1F1A2E", "#FF8E72", "#F7F1E8", "#72D9A9", "#6E8BFF", "#FFD56E"],
}

# (board id, parent id, title, description, palette key)
BOARDS = [
    ("root", None, "Summer Light", "A studio moodboard for the summer collection: warm colour, soft texture, bold shapes.", "root"),
    ("colour", "root", "Colour story", "Late-afternoon warmth: coral, apricot and a deep plum to ground it.", "colour"),
    ("texture", "root", "Texture & material", "Linen, paper and clay. Everything should look like you could touch it.", "texture"),
    ("form", "root", "Shape & type", "Chunky geometry and friendly letterforms.", "form"),
    ("sunset", "colour", "Sunset palette", "The hour before dusk, from peach to violet.", "sunset"),
    ("peach", "sunset", "Peach tones", "The softest end of the palette, for backgrounds and packaging.", "peach"),
    ("fabric", "texture", "Fabric swatches", "Woven samples shortlisted for the lookbook set.", "fabric"),
    ("letters", "form", "Lettering", "Display type studies for the campaign headline.", "letters"),
]

# board id -> list of (title, alt, motif)
IMAGES = {
    "root": [
        ("Beach umbrellas", "Abstract poster of coral and butter-yellow half circles over a blue horizon", "suns"),
        ("Pool tiles", "Grid of soft blue and mint squares like a swimming pool floor", "grid"),
        ("Lemon crate", "Stacked yellow circles on a cream background like lemons in a crate", "dots"),
        ("Night swim", "Dark navy field with a single pale moon and rippling stripes", "moon"),
        ("Striped awning", "Bold vertical stripes in coral and cream", "stripes"),
        ("Garden arch", "A tall mint arch framing a coral sun", "arch"),
    ],
    "colour": [
        ("Apricot wall", "Warm apricot rectangle with a soft shadow line", "blocks"),
        ("Plum shadow", "Deep plum arch on a cream background", "arch"),
        ("Coral swatch", "Three overlapping coral circles in different strengths", "suns"),
        ("Heat haze", "Wavy horizontal bands from red to pale yellow", "waves"),
        ("Paint chips", "Grid of warm paint chip squares", "grid"),
    ],
    "sunset": [
        ("Last light", "Large orange sun setting behind violet bands", "sunset"),
        ("Dusk ridge", "Layered purple mountain silhouettes under a pink sky", "hills"),
        ("Neon pier", "Pink and violet stripes reflected in dark water", "waves"),
        ("Orange grove", "Rows of small orange circles on a purple ground", "dots"),
    ],
    "peach": [
        ("Peach skin", "Soft peach circle with a darker blush", "suns"),
        ("Linen tray", "Pale peach rectangles stacked like paper", "blocks"),
        ("Blossom", "Petal shapes in peach and cream radiating from a centre", "petals"),
    ],
    "texture": [
        ("Raw linen", "Fine cross-hatched lines in natural beige", "weave"),
        ("Clay pots", "Three terracotta arches of different heights", "arch"),
        ("Torn paper", "Cream paper pieces with jagged edges on sage", "blocks"),
        ("Olive grove", "Rolling sage green hills with brown earth", "hills"),
        ("Pebbles", "Smooth rounded stones in warm greys", "pebbles"),
    ],
    "fabric": [
        ("Indigo twill", "Diagonal indigo and cream twill weave", "weave"),
        ("Mustard check", "Mustard and navy gingham check", "grid"),
        ("Rust stripe", "Rust red and cream ticking stripes", "stripes"),
        ("Oat bouclé", "Speckled oatmeal texture with tiny loops", "pebbles"),
    ],
    "form": [
        ("Big shapes", "A cobalt circle, butter square and coral triangle composition", "shapes"),
        ("Stacked blocks", "Chunky rounded rectangles stacked like toy blocks", "blocks"),
        ("Half moons", "Rows of half circles alternating periwinkle and butter", "suns"),
        ("Soft grid", "Rounded squares on a dark ground", "grid"),
    ],
    "letters": [
        ("Fat A", "A chunky letter A built from rounded shapes", "letter-a"),
        ("Bubble O", "A thick ring letter O in coral on cream", "letter-o"),
        ("Stencil S", "Two stacked arches forming a stencil S", "letter-s"),
    ],
}

NOTES = {
    "root": [
        ("Brief", "Summer collection for a small homeware brand. Warm, playful and touchable. Nothing that looks like a corporate deck."),
        ("Mood in three words", "Sun-bleached, chunky, generous. Think beach towels and ceramic tableware, not luxury minimalism."),
    ],
    "colour": [("Palette rule", "Coral leads, apricot supports, plum only for type and shadows. Keep blues for accents.")],
    "sunset": [("Use sparingly", "The violet end is for night-time shots only. Daytime images stay on the peach side.")],
    "texture": [("Material check", "Ask the supplier for linen samples in oat and rust before the shoot on Friday.")],
    "form": [("Shape language", "Everything has rounded corners. Circles for product, arches for windows, blocks for type.")],
    "letters": [("Headline", "Try the fat A and bubble O together at poster size. Check legibility at thumbnail scale.")],
}

# Rough board-local layouts: board id -> list of slots (col, row) for children in order
# boards first, then images, then notes. Columns are 320px apart, rows 360px apart.
COL, ROW = 320, 360


def child_boards(board_id: str) -> list[str]:
    return [b[0] for b in BOARDS if b[1] == board_id]


def svg_art(seed: str, motif: str, palette: list[str]) -> str:
    rnd = random.Random(seed)
    p = palette[:]
    bg = p[5] if motif not in ("moon", "sunset") else p[4 if motif == "sunset" else 3]
    w, h = 400, 500
    parts: list[str] = [f'<rect width="{w}" height="{h}" fill="{bg}"/>']

    def c(i: int) -> str:
        return p[i % len(p)]

    if motif == "suns":
        for i in range(3):
            r = rnd.randint(90, 150)
            parts.append(f'<circle cx="{rnd.randint(80, 320)}" cy="{rnd.randint(120, 380)}" r="{r}" fill="{c(i)}" opacity="0.92"/>')
        parts.append(f'<rect y="{h - 120}" width="{w}" height="120" fill="{c(3)}"/>')
    elif motif == "grid":
        s = 92
        for gx in range(4):
            for gy in range(5):
                parts.append(f'<rect x="{12 + gx * 96}" y="{12 + gy * 96}" width="{s - 8}" height="{s - 8}" rx="14" fill="{c(rnd.randint(0, 4))}"/>')
    elif motif == "dots":
        for gx in range(5):
            for gy in range(6):
                r = rnd.randint(22, 36)
                parts.append(f'<circle cx="{40 + gx * 80}" cy="{45 + gy * 82}" r="{r}" fill="{c(rnd.choice([0, 1, 3]))}"/>')
    elif motif == "moon":
        parts.append(f'<circle cx="270" cy="140" r="70" fill="{c(5)}"/>')
        for i in range(6):
            y = 300 + i * 30
            parts.append(f'<path d="M0 {y} Q 100 {y - 14} 200 {y} T 400 {y}" stroke="{c(2 if i % 2 else 5)}" stroke-width="8" fill="none" opacity="{0.4 + i * 0.1:.1f}"/>')
    elif motif == "stripes":
        for i in range(0, 8):
            parts.append(f'<rect x="{i * 50}" width="50" height="{h}" fill="{c(0) if i % 2 == 0 else c(5)}"/>')
        parts.append(f'<path d="M0 0 H400 V90 Q 375 120 350 90 Q 325 120 300 90 Q 275 120 250 90 Q 225 120 200 90 Q 175 120 150 90 Q 125 120 100 90 Q 75 120 50 90 Q 25 120 0 90 Z" fill="{c(3)}" opacity="0.25"/>')
    elif motif == "arch":
        n = rnd.randint(1, 3)
        for i in range(n):
            aw = 300 // n - 10
            x = 50 + i * (300 // n)
            top = rnd.randint(110, 220)
            parts.append(f'<path d="M{x} {h - 40} V{top + aw // 2} A{aw // 2} {aw // 2} 0 0 1 {x + aw} {top + aw // 2} V{h - 40} Z" fill="{c(i + 3)}"/>')
        parts.append(f'<circle cx="200" cy="230" r="46" fill="{c(0)}"/>')
    elif motif == "blocks":
        y = h - 40
        for i in range(5):
            bh = rnd.randint(50, 90)
            bw = rnd.randint(160, 300)
            x = (w - bw) // 2 + rnd.randint(-30, 30)
            y -= bh + 6
            parts.append(f'<rect x="{x}" y="{y}" width="{bw}" height="{bh}" rx="18" fill="{c(i)}"/>')
    elif motif == "waves":
        for i in range(10):
            y = i * 52
            parts.append(f'<path d="M0 {y} Q 100 {y + 30} 200 {y} T 400 {y} V {h} H 0 Z" fill="{c(i % 5)}"/>')
    elif motif == "sunset":
        parts.append(f'<rect width="{w}" height="{h // 2}" fill="{c(5)}"/>')
        parts.append(f'<circle cx="200" cy="250" r="120" fill="{c(0)}"/>')
        for i in range(5):
            parts.append(f'<rect y="{250 + i * 52}" width="{w}" height="{30 + i * 4}" fill="{c([2, 1, 2, 4, 2][i])}" opacity="0.9"/>')
    elif motif == "hills":
        parts.append(f'<rect width="{w}" height="{h}" fill="{c(5) if True else bg}"/>')
        parts.append(f'<circle cx="{rnd.randint(90, 310)}" cy="130" r="54" fill="{c(1)}"/>')
        for i in range(4):
            y = 240 + i * 60
            parts.append(f'<path d="M0 {y} Q {rnd.randint(60, 160)} {y - 90} {rnd.randint(180, 240)} {y - 10} T 400 {y - 30} V {h} H 0 Z" fill="{c([4, 0, 2, 3][i])}"/>')
    elif motif == "petals":
        for i in range(10):
            a = i * 36
            parts.append(f'<ellipse cx="200" cy="140" rx="46" ry="110" fill="{c(i % 3)}" opacity="0.85" transform="rotate({a} 200 250)"/>')
        parts.append(f'<circle cx="200" cy="250" r="40" fill="{c(3)}"/>')
    elif motif == "weave":
        for i in range(-10, 30):
            parts.append(f'<line x1="{i * 22}" y1="0" x2="{i * 22 + 250}" y2="{h}" stroke="{c(0)}" stroke-width="9" opacity="0.55"/>')
        for i in range(0, 30):
            parts.append(f'<line x1="0" y1="{i * 18}" x2="{w}" y2="{i * 18}" stroke="{c(3)}" stroke-width="2" opacity="0.3"/>')
    elif motif == "pebbles":
        for _ in range(16):
            rx = rnd.randint(28, 62)
            parts.append(f'<ellipse cx="{rnd.randint(30, 370)}" cy="{rnd.randint(30, 470)}" rx="{rx}" ry="{int(rx * 0.72)}" fill="{c(rnd.randint(0, 4))}" opacity="0.9"/>')
    elif motif == "shapes":
        parts.append(f'<circle cx="140" cy="160" r="100" fill="{c(1)}"/>')
        parts.append(f'<rect x="190" y="210" width="170" height="170" rx="22" fill="{c(2)}"/>')
        parts.append(f'<path d="M60 460 L160 290 L260 460 Z" fill="{c(4)}"/>')
    elif motif == "letter-a":
        parts.append(f'<path d="M200 70 L340 440 H260 L235 370 H165 L140 440 H60 Z M200 200 L180 300 H220 Z" fill="{c(1)}" fill-rule="evenodd"/>')
        parts.append(f'<circle cx="320" cy="110" r="34" fill="{c(5)}"/>')
    elif motif == "letter-o":
        parts.append(f'<circle cx="200" cy="250" r="150" fill="{c(1)}"/>')
        parts.append(f'<circle cx="200" cy="250" r="66" fill="{bg}"/>')
    elif motif == "letter-s":
        parts.append(f'<path d="M90 230 A110 100 0 0 1 310 130 H250 A50 50 0 0 0 150 200 Z" fill="{c(3)}"/>')
        parts.append(f'<path d="M310 270 A110 100 0 0 1 90 370 H150 A50 50 0 0 0 250 300 Z" fill="{c(4)}"/>')
        parts.append(f'<rect x="90" y="235" width="220" height="30" rx="15" fill="{c(1)}"/>')

    body = "".join(parts)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
        f'width="{w}" height="{h}">{body}</svg>\n'
    )


def build() -> dict:
    nodes: list[dict] = []
    palettes = {b[0]: PALETTES[b[4]] for b in BOARDS}

    for board_id, parent_id, title, desc, _ in BOARDS:
        rnd = random.Random(f"layout:{board_id}")
        items: list[tuple[str, dict]] = []
        for child in child_boards(board_id):
            items.append(("board", {"id": child}))
        for i, (t, alt, motif) in enumerate(IMAGES.get(board_id, [])):
            items.append(("image", {"id": f"{board_id}-img-{i + 1}", "title": t, "alt": alt, "motif": motif}))
        for i, (t, body) in enumerate(NOTES.get(board_id, [])):
            items.append(("note", {"id": f"{board_id}-note-{i + 1}", "title": t, "body": body}))

        # Interleave: boards are spread across the top row so they read first.
        cols = 4 if len(items) > 6 else 3
        for idx, (kind, data) in enumerate(items):
            col, row = idx % cols, idx // cols
            x = col * COL + rnd.randint(-18, 18) + (40 if row % 2 else 0)
            y = row * ROW + rnd.randint(-16, 16)
            w, h = {"board": (BOARD_W, BOARD_H), "image": (IMAGE_W, IMAGE_H), "note": (NOTE_W, NOTE_H)}[kind]
            if kind == "note":
                y += 40
            node: dict = {"id": data["id"], "type": kind, "parentId": board_id, "x": x, "y": y, "w": w, "h": h}
            if kind == "board":
                b = next(bb for bb in BOARDS if bb[0] == data["id"])
                node["content"] = {"title": b[2], "description": b[3]}
            elif kind == "image":
                fname = f"{data['id']}.svg"
                (ART_DIR / fname).write_text(svg_art(data["id"], data["motif"], palettes[board_id]))
                node["content"] = {"title": data["title"], "src": f"/api/assets/art/{fname}", "alt": data["alt"]}
            else:
                node["content"] = {"title": data["title"], "body": data["body"]}
            nodes.append(node)

    root = BOARDS[0]
    nodes.insert(0, {
        "id": "root", "type": "board", "parentId": None, "x": 0, "y": 0, "w": BOARD_W, "h": BOARD_H,
        "content": {"title": root[2], "description": root[3]},
    })
    return {"rootBoardId": "root", "nodes": nodes}


def main() -> None:
    ART_DIR.mkdir(parents=True, exist_ok=True)
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    scene = build()
    DATA_FILE.write_text(json.dumps(scene, indent=2) + "\n")
    counts: dict[str, int] = {}
    for n in scene["nodes"]:
        counts[n["type"]] = counts.get(n["type"], 0) + 1
    print(f"wrote {DATA_FILE.name}: {counts}")


if __name__ == "__main__":
    main()
