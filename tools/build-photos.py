#!/usr/bin/env python3
"""
build-photos.py — every image the site ships, from the untouched originals in
data/source/ to the web-ready files in assets/img/.

    python tools/build-photos.py

Needs Pillow + numpy, and rembg for the cut-out
(`pip install "rembg[cpu]"`; the model downloads once, ~180 MB).
Run it only when an original changes — the outputs are committed.

1. mark-*.webp / logo-256.png / favicons
   Source: data/source/brand/cover-poster.jpg — the cover of the booklet.
   The gold-ringed emblem is cut out of it on its own circle, so the artwork
   carries its own rim and reads identically on cream and on navy.

2. teacher-portrait-*.webp / .jpg  (square, shown as a circle)
   Source: data/source/photos/teacher-portrait-source.jpg. He is standing in
   front of an exhibition banner, and a circle that tight would frame its
   lettering rather than him, so the room is removed with rembg
   (isnet-general-use) and he is composited on the brand's own cream vignette.

3. teacher-standing-*.webp  (4:5, for the arch frame)
   The same photo, cropped head-to-chest and left exactly as it was taken —
   background included. The arch is big enough to carry the real room, and a
   photograph reads as a photograph; it is the tight circle that needed the
   cut-out, not this.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "source"
OUT = ROOT / "assets" / "img"

NAVY = (15, 39, 67)
GOLD = (200, 155, 72)
CREAM = (242, 240, 233)

# --- helpers -------------------------------------------------------------------


def circle_mask(size, supersample=4, inset=0.0):
    """Anti-aliased circular alpha mask, `inset` pixels in from the edge."""
    big = size * supersample
    pad = inset * supersample
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).ellipse((pad, pad, big - 1 - pad, big - 1 - pad), fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def as_circle(square, size, inset=0.0):
    """`square` (RGB) resized to `size` with everything outside a circle cut."""
    img = square.convert("RGB").resize((size, size), Image.LANCZOS)
    out = img.convert("RGBA")
    out.putalpha(circle_mask(size, inset=inset))
    return out


# --- 1. Brand mark -------------------------------------------------------------

# The emblem on the cover, measured on the original: the outer edge of its gold
# ring. The artwork renders the coin with a slight tilt, so on the page it is an
# ellipse — 260 x 240 — not a circle. Cropping that box and squaring it both
# straightens the coin and puts the artwork's own ring exactly on the edge the
# CSS circle clips to, with no pale halo between the two.
SEAL_BOX = (413, 206, 673, 446)


def build_mark():
    poster = Image.open(SRC / "brand" / "cover-poster.jpg").convert("RGB")
    square = poster.crop(SEAL_BOX)

    # 1px in: the crop lands on the ring's own antialiased edge, so shaving a
    # single pixel keeps the paper behind it out of the artwork.
    for size in (560, 300, 144):
        as_circle(square, size, inset=size / 170).save(
            OUT / f"mark-{size}.webp", "WEBP", quality=90, method=6
        )

    # PNG twin of the mark, for anything that cannot read WebP.
    as_circle(square, 256, inset=1.5).save(OUT / "logo-256.png", "PNG", optimize=True)

    # Favicons: the emblem is a dark disc, so it is given a flat colour behind it
    # rather than transparency, which renders as grey or black in most tab bars.
    def on_paper(size, pad_ratio=0.0, bg=CREAM):
        canvas = Image.new("RGB", (size, size), bg)
        inner = round(size * (1 - 2 * pad_ratio))
        disc = as_circle(square, inner, inset=max(1.0, inner / 170))
        canvas.paste(disc, ((size - inner) // 2, (size - inner) // 2), disc)
        return canvas

    on_paper(32).save(OUT / "favicon-32.png", "PNG", optimize=True)
    on_paper(180, 0.06).save(OUT / "apple-touch-icon.png", "PNG", optimize=True)
    # Maskable icons keep the safe zone: the disc covers 74% of the width so a
    # circular or squircle mask cannot clip the ring.
    on_paper(192, 0.13, NAVY).save(OUT / "maskable-192.png", "PNG", optimize=True)
    on_paper(512, 0.13, NAVY).save(OUT / "maskable-512.png", "PNG", optimize=True)

    ico = [on_paper(s) for s in (16, 32, 48)]
    ico[2].save(
        ROOT / "favicon.ico",
        "ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
        append_images=ico[:2],
    )
    return square


# --- 2. The cut-out both photos are cut from -----------------------------------


def estimate_background(rgb, alpha):
    """Fill the subject with the surrounding colour (normalised blur)."""
    arr = np.asarray(rgb).astype(np.float64)
    bg_weight = (alpha < 0.02).astype(np.float64)
    radius = 40
    w_img = Image.fromarray((bg_weight * 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(radius)
    )
    w = np.asarray(w_img).astype(np.float64) / 255.0
    out = np.zeros_like(arr)
    for c in range(3):
        channel = Image.fromarray(
            np.clip(arr[..., c] * bg_weight, 0, 255).astype(np.uint8)
        )
        blurred = np.asarray(channel.filter(ImageFilter.GaussianBlur(radius))).astype(
            np.float64
        )
        out[..., c] = blurred / np.maximum(w, 1e-3)
    return out


def build_cutout():
    """The teacher, with the exhibition hall behind him removed."""
    from rembg import new_session, remove

    src = Image.open(SRC / "photos" / "teacher-portrait-source.jpg").convert("RGB")
    cut = remove(src, session=new_session("isnet-general-use"), post_process_mask=True)
    alpha = np.asarray(cut.split()[-1]).astype(np.float64) / 255.0

    rgb = np.asarray(src).astype(np.float64)
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]

    # The banner behind him carries a vivid green graphic, and the matte keeps a
    # strip of it against his right arm where the two nearly touch. Eroding the
    # whole silhouette enough to lose it would eat the hair, so the strip is
    # removed by its colour instead: that green is far outside the range of his
    # sage shirt (g-r peaks at 37 there but g-b stays near 3), so the two
    # conditions together cannot match clothing or skin. Dilating by 2px takes
    # the antialiased fringe around it with it.
    banner_green = (alpha > 0.12) & (green - red > 25) & (green - blue > 20)
    grown = Image.fromarray((banner_green * 255).astype(np.uint8)).filter(
        ImageFilter.MaxFilter(5)
    )
    alpha[np.asarray(grown) > 0] = 0.0

    # Tighten the matte slightly and remove the room colour the soft edge pixels
    # carry, so the outline stays clean against both backdrops.
    alpha = np.clip((alpha - 0.08) / 0.92, 0, 1)
    bg = estimate_background(src, alpha)
    a = alpha[..., None]
    edge = (a > 0.02) & (a < 0.98)
    fg = np.clip(np.where(edge, (rgb - (1 - a) * bg) / np.maximum(a, 0.02), rgb), 0, 255)

    return Image.fromarray(np.dstack([fg, alpha * 255]).astype(np.uint8), "RGBA")


# --- 3. Portrait ---------------------------------------------------------------

# Square on the original photo: the head with headroom, closing at the shoulders
# so the circle reads as a portrait rather than a cut-off head. The subject sits
# slightly right of centre, so the box is pushed to the right edge of the frame.
PORTRAIT_BOX = (96, 66, 796, 766)


def paper_backdrop(size):
    """A soft cream vignette — the page's own paper, lit from where he stands."""
    yy, xx = np.mgrid[0:size, 0:size]
    distance = np.sqrt((xx / size - 0.5) ** 2 + (yy / size - 0.40) ** 2)
    t = np.clip((distance - 0.16) / 0.46, 0, 1)[..., None]
    centre = np.array([255, 253, 248])  # --paper-50
    rim = np.array([233, 229, 218])  # just under --paper-300
    return Image.fromarray((centre * (1 - t) + rim * t).astype(np.uint8), "RGB")


def build_portrait(cutout):
    subject = cutout.crop(PORTRAIT_BOX)
    square = paper_backdrop(subject.width)
    square.paste(subject, (0, 0), subject)

    for size in (720, 360, 144):
        square.resize((size, size), Image.LANCZOS).save(
            OUT / f"teacher-portrait-{size}.webp", "WEBP", quality=86, method=6
        )

    # JPEG avatar for crawlers and link previews that expect one. Search engines
    # may show it square, so the circle is composited on the brand's cream with
    # a gold ring: nothing outside the circle can show in a corner.
    size, ring = 720, 10
    avatar = Image.new("RGB", (size, size), CREAM)
    ImageDraw.Draw(avatar).ellipse((4, 4, size - 5, size - 5), fill=GOLD)
    inner = size - 2 * (ring + 4)
    disc = as_circle(square, inner, inset=1.0)
    avatar.paste(disc, (ring + 4, ring + 4), disc)
    avatar.save(
        OUT / "teacher-portrait.jpg", "JPEG", quality=88, optimize=True, progressive=True
    )
    return square


# --- 4. Standing photo ---------------------------------------------------------

STANDING_BOX = (0, 66, 796, 1061)  # head to chest, 4:5


def build_standing():
    """The photo as taken. The arch frame covers it edge to edge, so the stage
    behind it never shows and the room becomes the backdrop."""
    out = Image.open(SRC / "photos" / "teacher-portrait-source.jpg").convert("RGB")
    out = out.crop(STANDING_BOX)
    for w in (720, 400):
        h = round(w * out.height / out.width)
        out.resize((w, h), Image.LANCZOS).save(
            OUT / f"teacher-standing-{w}.webp", "WEBP", quality=86, method=6
        )
    return out


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    m = build_mark()
    print("mark     :", m.size, "->", [f.name for f in sorted(OUT.glob("mark-*"))])
    cutout = build_cutout()
    print("cut-out  :", cutout.size)
    p = build_portrait(cutout)
    print("portrait :", p.size, "->", [f.name for f in sorted(OUT.glob("teacher-portrait*"))])
    s = build_standing()
    print("standing :", s.size, "->", [f.name for f in sorted(OUT.glob("teacher-standing*"))])
