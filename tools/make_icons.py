#!/usr/bin/env python3
"""Make the game's icons (browser tab, phone home screen, desktop shortcut) from the hero sprite.

Usage: python3 tools/make_icons.py   (needs Pillow; the PNGs it writes are committed, so the
build itself does not need Pillow)
"""
import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"
SAND, SAND_D = (243, 205, 172, 255), (223, 169, 136, 255)
HERO_TILE = 12  # the blue monster, standing (enemies sheet, 24 px tiles, 4 per row)


def hero():
    sheet = Image.open(ROOT / "assets" / "img" / "enemies.png").convert("RGBA")
    x, y = (HERO_TILE % 4) * 24, (HERO_TILE // 4) * 24
    tile = sheet.crop((x, y, x + 24, y + 24))
    tile = tile.crop(tile.getbbox())  # just the drawn pixels, so the hero sits centred
    # the sheet cuts the white outline off under the feet (the tile ends there); add it back
    out = Image.new("RGBA", (tile.width, tile.height + 1), (0, 0, 0, 0))
    out.paste(tile, (0, 0))
    for px in range(tile.width):
        if tile.getpixel((px, tile.height - 1))[3]:
            out.putpixel((px, tile.height), (255, 255, 255, 255))
    return out


def icon(size, scale, rounded, name):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle((0, 0, size - 1, size - 1), radius=round(size * 0.22), fill=SAND)
    else:
        d.rectangle((0, 0, size, size), fill=SAND)
    h = hero()
    big = h.resize((h.width * scale, h.height * scale), Image.NEAREST)
    bx, by = (size - big.width) // 2, (size - big.height) // 2
    # a soft ground shadow under the feet, in the game's dark-sand colour
    sw, sh = round(big.width * 0.62), max(2, round(big.height * 0.1))
    sy = by + big.height - sh // 2
    d.ellipse(((size - sw) // 2, sy, (size + sw) // 2, sy + sh), fill=SAND_D)
    img.alpha_composite(big, (bx, by))
    if name:
        img.save(OUT / name)
        print("wrote", OUT / name)
    return img


def main():
    OUT.mkdir(exist_ok=True)
    icon(192, 5, True, "icon-192.png")
    icon(180, 5, False, "apple-touch-icon.png")  # iOS rounds the corners itself
    icon(32, 1, True, "icon-32.png")
    # Windows shortcut icon (the downloaded .url file points at it): crisp pixel sizes, smoothed small ones
    big = {n: icon(n, sc, True, None) for n, sc in ((256, 9), (128, 4), (64, 2), (32, 1))}
    big[48] = big[64].resize((48, 48), Image.LANCZOS)
    big[16] = big[32].resize((16, 16), Image.LANCZOS)
    order = [256, 128, 64, 48, 32, 16]
    big[256].save(OUT / "shortcut.ico", format="ICO", sizes=[(n, n) for n in order], append_images=[big[n] for n in order[1:]])
    print("wrote", OUT / "shortcut.ico")


if __name__ == "__main__":
    main()
