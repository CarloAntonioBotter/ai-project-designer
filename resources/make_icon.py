"""Generate resources/icon.png, the 128x128 extension tile icon.

The mark: a pure checklist (the plan) - three ticks with their task lines.
Transparent background, single indigo, so it reads on light and dark themes.

Run: python resources/make_icon.py
"""

from PIL import Image, ImageDraw

S = 4  # supersample factor
N = 128  # final size
C = N * S
INDIGO = (79, 70, 229, 255)  # #4F46E5
TICK = 10 * S
BAR = 13 * S

ROWS = (34, 64, 94)
TICKS = ((16, 0, 26, 10, 46, -14),)
BARS = ((60, 112), (60, 100), (60, 88))


def s(*v):
    return [x * S for x in v]


glyph = Image.new("RGBA", (C, C), (0, 0, 0, 0))
d = ImageDraw.Draw(glyph)

for y, (x1, x2) in zip(ROWS, BARS):
    ax, ay, bx, by, cx, cy = TICKS[0]
    d.line(s(ax, y + ay, bx, y + by, cx, y + cy), fill=INDIGO, width=TICK, joint="curve")
    d.line(s(x1, y, x2, y), fill=INDIGO, width=BAR)

glyph.resize((N, N), Image.LANCZOS).save("resources/icon.png")
print("wrote resources/icon.png")
