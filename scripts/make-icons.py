"""Renders the app icons: the Claude Code mascot (the little orange pixel character from the CLI
welcome screen) on a dark, warm background. Pure Pillow:  npm run icons

The mascot is drawn on a 16 x 10 grid. In the terminal it is built from half-block characters, so one
grid column is half a character wide and one grid row is half a character tall; here each row is
drawn two units high, which keeps the CLI's proportions (a wide body with tall, thin eyes).
"""
import os
from PIL import Image, ImageChops, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
os.makedirs(OUT, exist_ok=True)

ORANGE = (217, 119, 87)      # Claude "clay"
EYE = (24, 18, 15)
BG_TOP, BG_BOT = (38, 30, 26), (13, 10, 9)

# (x, y, w, h) in grid units. y is already doubled (each terminal row = 2 units tall).
BODY = [(2, 0, 12, 8), (0, 4, 2, 2), (14, 4, 2, 2), (3, 8, 1, 2), (5, 8, 1, 2), (10, 8, 1, 2), (12, 8, 1, 2)]
EYES = [(4, 2, 1, 2), (11, 2, 1, 2)]
GW, GH = 16, 10


def mascot_mask(size, u, ox, oy):
    """White-on-black silhouette (eyes cut out) of the mascot at unit size u, offset (ox, oy)."""
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    for x, y, w, h in BODY:
        d.rectangle((ox + x * u, oy + y * u, ox + (x + w) * u - 1, oy + (y + h) * u - 1), fill=255)
    for x, y, w, h in EYES:
        d.rectangle((ox + x * u, oy + y * u, ox + (x + w) * u - 1, oy + (y + h) * u - 1), fill=0)
    return m


def background(size):
    img = Image.new('RGB', (size, size))
    px = img.load()
    for y in range(size):
        t = y / (size - 1)
        row = tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3))
        for x in range(size):
            px[x, y] = row
    return img


def icon(size, u):
    ox, oy = (size - GW * u) // 2, (size - GH * u) // 2
    img = background(size).convert('RGBA')
    mask = mascot_mask(size, u, ox, oy)

    # warm glow behind the character
    glow = Image.new('RGBA', (size, size), ORANGE + (0,))
    glow.putalpha(mask.filter(ImageFilter.GaussianBlur(size * 0.07)).point(lambda v: int(v * 0.30)))
    img = Image.alpha_composite(img, glow)

    # ground shadow under the legs
    sh = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse((ox + 1 * u, oy + (GH + 0.1) * u, ox + 15 * u, oy + (GH + 1.1) * u), fill=(0, 0, 0, 150))
    img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(u * 0.55)))

    # the mascot itself: flat orange with a faint top-light so it sits on the background
    body = Image.new('RGBA', (size, size), ORANGE + (255,))
    light = Image.new('L', (size, size), 0)
    ld = ImageDraw.Draw(light)
    for i in range(GH * u):
        ld.line((0, oy + i, size, oy + i), fill=int(34 * (1 - i / (GH * u))))
    body = Image.composite(Image.new('RGBA', (size, size), (255, 255, 255, 255)), body, light)
    body.putalpha(mask)
    img = Image.alpha_composite(img, body)

    # eyes show the background through the cut-outs; give them a little depth
    eyes = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ed = ImageDraw.Draw(eyes)
    for x, y, w, h in EYES:
        ed.rectangle((ox + x * u, oy + y * u, ox + (x + w) * u - 1, oy + (y + h) * u - 1), fill=EYE + (255,))
    return Image.alpha_composite(img, eyes).convert('RGB')


def badge():
    """Monochrome notification badge (Android status bar): white silhouette on transparent."""
    size, u = 96, 5
    ox, oy = (size - GW * u) // 2, (size - GH * u) // 2
    out = Image.new('RGBA', (size, size), (255, 255, 255, 0))
    out.putalpha(mascot_mask(size, u, ox, oy))
    return out


master = icon(1024, 40)                      # 640 x 400 mascot, still inside Android's maskable safe zone (80% circle)
master.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, 'icon-512.png'), optimize=True)
master.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, 'icon-maskable-512.png'), optimize=True)
master.resize((192, 192), Image.LANCZOS).save(os.path.join(OUT, 'icon-192.png'), optimize=True)
master.resize((180, 180), Image.LANCZOS).save(os.path.join(OUT, 'apple-touch-icon.png'), optimize=True)
icon(256, 12).resize((32, 32), Image.LANCZOS).save(os.path.join(OUT, 'favicon-32.png'), optimize=True)  # bigger mascot for tiny sizes
badge().save(os.path.join(OUT, 'badge-96.png'), optimize=True)
print('icons written to', os.path.abspath(OUT))
