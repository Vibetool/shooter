#!/usr/bin/env python3
"""Build shoter/index.html: inlines the Kenney sprites/sounds and the game scripts.

Usage: python3 tools/build.py [fragment_out.html]
The optional argument also writes a body-only fragment (for hosts that add their own <head>).
"""
import base64
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
ORDER = ["core.js", "data.js", "mapgen.js", "ui.js", "play.js", "pvp.js", "main.js"]


def data_uri(path, mime):
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def main():
    assets = {"img": {}, "sfx": {}}
    for p in sorted((ROOT / "assets" / "img").glob("*.png")):
        assets["img"][p.stem] = data_uri(p, "image/png")
    for p in sorted((ROOT / "assets" / "sfx").glob("*.wav")):
        assets["sfx"][p.stem] = data_uri(p, "audio/wav")
    assets_js = "const ASSETS = " + json.dumps(assets, separators=(",", ":")) + ";"
    game_js = "\n".join((SRC / f).read_text(encoding="utf-8") for f in ORDER)
    page = (SRC / "page.html").read_text(encoding="utf-8")
    page = page.replace("/*__ASSETS__*/", assets_js).replace("/*__GAME__*/", game_js)

    head_end = page.index("<canvas")
    head, body = page[:head_end], page[head_end:]
    full = (
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">\n"
        + head + "</head>\n<body>\n" + body + "</body>\n</html>\n"
    )
    (ROOT / "index.html").write_text(full, encoding="utf-8")
    print("wrote", ROOT / "index.html", f"{len(full) / 1024:.0f} KB")
    if len(sys.argv) > 1:
        out = pathlib.Path(sys.argv[1])
        out.write_text(page, encoding="utf-8")
        print("wrote", out, f"{len(page) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
