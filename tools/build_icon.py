#!/usr/bin/env python3
"""Build the macOS .icns app icon from a single resting tile of the source art.

Takes the at-rest frame of one character's transition GIF, insets it on a
1024x1024 canvas with the margin macOS expects, rounds the corners, and runs
`iconutil` to produce build/icon.icns.
"""

from __future__ import annotations

import argparse
import glob
import os
import shutil
import subprocess
import sys
import tempfile

try:
    from PIL import Image, ImageDraw, ImageSequence
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required: python3 -m pip install --user Pillow")

CANVAS = 1024
# macOS leaves roughly a 10% margin around the art on each side.
MARGIN = 96
CORNER_RATIO = 0.225

# iconutil expects exactly these names.
VARIANTS = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
]


def find_source(src_dir: str | None, char: str) -> str:
    """The GIF whose frame 0 is `char` sitting still, i.e. the one leaving it."""
    if src_dir is None:
        candidates = [
            p for p in glob.glob("*") if os.path.isdir(p) and glob.glob(os.path.join(p, "*.gif"))
        ]
        if len(candidates) != 1:
            sys.exit(f"could not auto-detect the GIF directory, pass --src (found {candidates})")
        src_dir = candidates[0]

    matches = [
        p
        for p in glob.glob(os.path.join(src_dir, f"{char}-*.gif"))
        if not p.endswith("_1.gif")
    ]
    if not matches:
        sys.exit(f"no transition leaves {char!r} in {src_dir!r}")
    return matches[0]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--src", help="directory of per-transition GIFs (auto-detected by default)")
    ap.add_argument("--char", default="F", help="character to show on the icon tile (default: F)")
    ap.add_argument("--out", default="build/icon.icns", help="output .icns path")
    args = ap.parse_args()

    if not shutil.which("iconutil"):
        sys.exit("iconutil not found; this script needs macOS")

    path = find_source(args.src, args.char)
    with Image.open(path) as gif:
        tile = next(ImageSequence.Iterator(gif)).convert("RGB").copy()

    size = CANVAS - MARGIN * 2
    art = tile.resize((size, size), Image.LANCZOS)

    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=int(size * CORNER_RATIO), fill=255
    )

    icon = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    icon.paste(art, (MARGIN, MARGIN), mask)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        iconset = os.path.join(tmp, "icon.iconset")
        os.makedirs(iconset)
        for name, px in VARIANTS:
            icon.resize((px, px), Image.LANCZOS).save(os.path.join(iconset, name))
        subprocess.run(["iconutil", "-c", "icns", iconset, "-o", args.out], check=True)

    print(f"wrote {args.out} from {os.path.basename(path)} ({args.char} tile)")


if __name__ == "__main__":
    main()
