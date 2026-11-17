"""Renders the app icons (a glossy ball on a deep indigo gradient). Pure Pillow:  npm run icons"""
import math, os
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
os.makedirs(OUT, exist_ok=True)
S = 1024            # master size
SS = 1              # (pixel loop is already 1024 -> downsampled later)


def lerp(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def background():
    img = Image.new('RGB', (S, S))
    px = img.load()
    top, bot = (52, 30, 140), (7, 14, 40)
    for y in range(S):
        for x in range(S):
            t = (x * 0.35 + y * 0.65) / S
            px[x, y] = tuple(int(v) for v in lerp(top, bot, min(1, t * 1.15)))
    glow = Image.new('RGB', (S, S), (0, 0, 0))
    g = ImageDraw.Draw(glow)
    g.ellipse((S * 0.52, -S * 0.12, S * 1.22, S * 0.58), fill=(0, 150, 255))      # cyan, top right
    g.ellipse((-S * 0.25, S * 0.55, S * 0.55, S * 1.2), fill=(255, 70, 160))      # pink, bottom left
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.16))
    return Image.blend(img, Image.composite(glow, img, Image.new('L', (S, S), 255)), 0.0).convert('RGB'), glow


def screen(base, glow, k):
    b, g = base.load(), glow.load()
    for y in range(S):
        for x in range(S):
            r1, g1, b1 = b[x, y]
            r2, g2, b2 = g[x, y]
            b[x, y] = tuple(int(255 - (255 - c1) * (255 - c2 * k) / 255) for c1, c2 in ((r1, r2), (g1, g2), (b1, b2)))
    return base


def seam_mask(size, R, width):
    """Basketball-style seams drawn in 2D, then clipped to the ball."""
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    c = size / 2
    d.line((c, c - R, c, c + R), fill=255, width=width)
    d.line((c - R, c, c + R, c), fill=255, width=width)
    k = R * 1.02
    d.arc((c - R * 2.02 + R * 0.0 - k * 0.0, c - R * 1.02, c - R * 0.02 + 0, c + R * 1.02), 295, 65, fill=255, width=width)  # right-side bulge seam
    d.arc((c + R * 0.02 - 0, c - R * 1.02, c + R * 2.02, c + R * 1.02), 115, 245, fill=255, width=width)                    # left-side bulge seam
    return m.filter(ImageFilter.GaussianBlur(width * 0.28))


def ball(size, R, base=(255, 132, 48), seam=(70, 28, 10)):
    """Returns (RGBA ball image, seam mask)."""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    px = img.load()
    cx = cy = size / 2
    L = (-0.52, -0.62, 0.59)
    ln = math.sqrt(sum(v * v for v in L))
    L = tuple(v / ln for v in L)
    for y in range(size):
        for x in range(size):
            dx, dy = (x + 0.5 - cx) / R, (y + 0.5 - cy) / R
            r2 = dx * dx + dy * dy
            if r2 >= 1.02:
                continue
            nz = math.sqrt(max(0.0, 1 - r2))
            diff = max(0.0, dx * L[0] + dy * L[1] + nz * L[2])
            rim = (1 - nz) ** 2.2
            shade = 0.32 + 0.78 * diff
            col = [min(255, base[i] * shade + (40 if i == 0 else 20) * rim * 1.5) for i in range(3)]
            # soft bounce light from below-right
            bounce = max(0.0, dx * 0.5 + dy * 0.55) * rim
            col = [min(255, col[0] + 60 * bounce), min(255, col[1] + 90 * bounce), min(255, col[2] + 160 * bounce)]
            a = 255 if r2 < 0.985 else int(255 * max(0, (1.02 - r2) / 0.035))
            px[x, y] = (int(col[0]), int(col[1]), int(col[2]), a)
    mask = seam_mask(size, R, max(6, int(R * 0.045)))
    alpha = img.getchannel('A')
    dark = Image.new('RGBA', (size, size), seam + (255,))
    shaded = Image.composite(dark, img, mask.point(lambda v: int(v * 0.82)))
    shaded.putalpha(alpha)
    return shaded, mask, alpha


def gloss(size, R):
    """Specular highlight + glassy rim light."""
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    c = size / 2
    d.ellipse((c - R * 0.62, c - R * 0.80, c - R * 0.02, c - R * 0.34), fill=(255, 255, 255, 150))
    layer = layer.filter(ImageFilter.GaussianBlur(R * 0.07))
    rim = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rim)
    rd.arc((c - R * 0.97, c - R * 0.97, c + R * 0.97, c + R * 0.97), 200, 275, fill=(255, 255, 255, 60), width=max(6, int(R * 0.05)))
    rim = rim.filter(ImageFilter.GaussianBlur(R * 0.03))
    return Image.alpha_composite(layer, rim)


def master():
    base, glow = background()
    base = screen(base, glow, 0.55).convert('RGBA')
    R = int(S * 0.30)
    # ground shadow
    sh = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse((S / 2 - R * 0.9, S / 2 + R * 1.06, S / 2 + R * 0.9, S / 2 + R * 1.30), fill=(0, 0, 0, 120))
    base = Image.alpha_composite(base, sh.filter(ImageFilter.GaussianBlur(S * 0.02)))
    b, _, alpha = ball(S, R)
    base = Image.alpha_composite(base, b)
    g = gloss(S, R)
    clipped = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    clipped.paste(g, (0, 0), alpha)
    return Image.alpha_composite(base, clipped).convert('RGB')


def badge():
    """Monochrome notification badge (Android): white ball with seams cut out."""
    size, R = 384, 176
    _, mask, alpha = ball(size, R)
    out = Image.new('RGBA', (size, size), (255, 255, 255, 0))
    cut = Image.composite(Image.new('L', (size, size), 0), alpha, mask.point(lambda v: min(255, v * 2)))
    out.putalpha(cut)
    return out.resize((96, 96), Image.LANCZOS)


m = master()
m.save(os.path.join(OUT, 'icon-1024.png'))
for name, px in (('icon-512.png', 512), ('icon-192.png', 192), ('apple-touch-icon.png', 180), ('favicon-32.png', 32)):
    m.resize((px, px), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)
m.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, 'icon-maskable-512.png'), optimize=True)  # ball already sits in the safe zone
badge().save(os.path.join(OUT, 'badge-96.png'), optimize=True)
os.remove(os.path.join(OUT, 'icon-1024.png'))
print('icons written to', os.path.abspath(OUT))
