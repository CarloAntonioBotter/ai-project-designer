"""Generate resources/icon.png, the 128x128 extension tile icon.

The mark: one plan node (with a check) branching into two isolated task runs.

Run: python resources/make_icon.py
"""

from PIL import Image, ImageDraw

S = 4  # supersample factor
N = 128  # final size
C = N * S
OUTLINE = 8 * S
LINK = 7 * S
CHECK = 9 * S


def s(*v):
    return [x * S for x in v]


# Diagonal gradient background (#7C3AED -> #1D4ED8).
grad = Image.new("RGB", (2, 2))
grad.putpixel((0, 0), (124, 58, 237))
grad.putpixel((1, 0), (37, 99, 235))
grad.putpixel((0, 1), (37, 99, 235))
grad.putpixel((1, 1), (29, 78, 216))
bg = grad.resize((C, C), Image.BICUBIC).convert("RGBA")

mask = Image.new("L", (C, C), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, C - 1, C - 1], radius=26 * S, fill=255)
bg.putalpha(mask)

glyph = Image.new("RGBA", (C, C), (0, 0, 0, 0))
d = ImageDraw.Draw(glyph)
W = (255, 255, 255, 255)

# Branching links, behind the nodes.
d.line(s(64, 56, 64, 72, 28, 72, 28, 92), fill=W, width=LINK, joint="curve")
d.line(s(64, 56, 64, 72, 100, 72, 100, 92), fill=W, width=LINK, joint="curve")

# Plan node + two isolated task nodes.
d.rounded_rectangle(s(40, 16, 88, 56), radius=10 * S, outline=W, width=OUTLINE)
d.rounded_rectangle(s(8, 88, 48, 116), radius=8 * S, outline=W, width=OUTLINE)
d.rounded_rectangle(s(80, 88, 120, 116), radius=8 * S, outline=W, width=OUTLINE)

# Check inside the plan node.
d.line(s(50, 37, 59, 46, 78, 26), fill=W, width=CHECK, joint="curve")

Image.alpha_composite(bg, glyph).resize((N, N), Image.LANCZOS).save("resources/icon.png")
print("wrote resources/icon.png")
