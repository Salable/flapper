#!/usr/bin/env python3
"""Build flipboard sprite strips from the designer's per-transition GIFs.

The source art is one animated GIF per split-flap transition, named
``FROM-TO.gif`` (e.g. ``A-B.gif``, ``9-fullstop.gif``, ``)-blank.gif``).
Together they form a single closed cycle of 42 states:

    blank -> A..Z -> 0..9 -> . -> , -> ! -> ( -> ) -> blank

Each GIF has 11 frames at 40ms. Frame 0 is the source character at rest and the
last two frames are pixel-identical, so there are 10 useful frames per
transition.

Two normalisations happen here:

1. The duplicated tail frame is dropped.
2. Each transition's final frame is replaced with frame 0 of the *next*
   transition. The designer rendered every GIF independently, so one GIF's
   "settled A" differs from the next GIF's "settled A" by about a pixel of
   glyph drift plus GIF palette dithering. Substituting the canonical frame
   makes a landing frame byte-identical to the resting frame that follows it,
   so a tile can never twitch when it comes to rest. The substituted
   difference lands on the last moving frame instead, where it is invisible.

Output is one vertical WebP strip per transition (10 frames stacked) plus a
manifest describing the cycle.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys

try:
    from PIL import Image, ImageSequence
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required: python3 -m pip install --user Pillow")

# Filename token -> the character that state displays. A state's "name" is the
# token; its "char" is what a user types to reach it.
TOKEN_CHARS = {
    "blank": " ",
    "fullstop": ".",
    "comma": ",",
}

FRAMES_PER_STRIP = 10


def normalise(token: str) -> str:
    """Canonicalise a filename token into a state name."""
    low = token.lower()
    if low in TOKEN_CHARS:
        return low
    if len(token) == 1:
        return token.upper()
    raise ValueError(f"unrecognised state token: {token!r}")


def state_char(name: str) -> str:
    return TOKEN_CHARS.get(name, name)


def find_source(explicit: str | None) -> str:
    if explicit:
        if not os.path.isdir(explicit):
            sys.exit(f"source directory not found: {explicit}")
        return explicit
    # The designer's folder is literally named "A-Z 0-9 " (with a trailing
    # space), so match it loosely rather than hardcoding it.
    candidates = [p for p in glob.glob("*") if os.path.isdir(p) and glob.glob(os.path.join(p, "*.gif"))]
    if len(candidates) == 1:
        return candidates[0]
    if not candidates:
        sys.exit("no directory containing .gif files found; pass --src")
    sys.exit(f"multiple candidate source directories, pass --src: {candidates}")


def discover_edges(src: str) -> dict[str, tuple[str, str]]:
    """Map source state -> (destination state, gif path)."""
    edges: dict[str, tuple[str, str]] = {}
    for path in sorted(glob.glob(os.path.join(src, "*.gif"))):
        stem = os.path.splitext(os.path.basename(path))[0]
        if stem.endswith("_1"):
            # Re-encodes of another file with frame-identical content.
            continue
        if stem.count("-") != 1:
            sys.exit(f"cannot parse transition from filename: {stem!r}")
        raw_from, raw_to = stem.split("-", 1)
        frm, to = normalise(raw_from), normalise(raw_to)
        if frm in edges:
            sys.exit(f"two transitions leave {frm!r}: {edges[frm][1]} and {path}")
        edges[frm] = (to, path)
    return edges


def build_cycle(edges: dict[str, tuple[str, str]], start: str = "blank") -> list[str]:
    """Walk the edges into an ordered cycle, verifying it closes cleanly."""
    if start not in edges:
        sys.exit(f"no transition leaves the {start!r} state")
    order = [start]
    cur = start
    while True:
        nxt = edges[cur][0]
        if nxt == start:
            break
        if nxt in order:
            sys.exit(f"transitions form a sub-loop at {nxt!r}, not one cycle")
        if nxt not in edges:
            sys.exit(f"dead end: nothing leaves {nxt!r}")
        order.append(nxt)
        cur = nxt
    if len(order) != len(edges):
        missing = sorted(set(edges) - set(order))
        sys.exit(f"cycle covers {len(order)} of {len(edges)} states; unreachable: {missing}")
    return order


def read_frames(path: str) -> list[Image.Image]:
    with Image.open(path) as im:
        return [f.convert("RGB").copy() for f in ImageSequence.Iterator(im)]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", help="directory of per-transition GIFs (auto-detected by default)")
    ap.add_argument("--out", default="assets", help="output directory (default: assets)")
    ap.add_argument(
        "--size",
        type=int,
        default=256,
        help="output tile size in pixels (default: 256). Decoded frames live in "
        "memory at runtime: 420 frames, so 256 costs ~105MB and 384 ~248MB. "
        "Raise it only for very large displays.",
    )
    ap.add_argument("--quality", type=int, default=92, help="WebP quality 1-100 (default: 92)")
    ap.add_argument("--lossless", action="store_true", help="encode lossless WebP (much larger)")
    args = ap.parse_args()

    src = find_source(args.src)
    edges = discover_edges(src)
    cycle = build_cycle(edges)
    print(f"source: {src!r}")
    print(f"cycle:  {len(cycle)} states -> {' '.join(state_char(n) or '_' for n in cycle)}")

    os.makedirs(args.out, exist_ok=True)
    size = args.size

    # Frame 0 of each transition is the canonical at-rest render of its source
    # state. Collected up front so each strip can borrow the next state's.
    resting: dict[str, Image.Image] = {}
    for name in cycle:
        resting[name] = read_frames(edges[name][1])[0].resize((size, size), Image.LANCZOS)

    entries = []
    total_bytes = 0
    for i, name in enumerate(cycle):
        dest, path = edges[name]
        frames = read_frames(path)
        if len(frames) < FRAMES_PER_STRIP:
            sys.exit(f"{path} has {len(frames)} frames, need at least {FRAMES_PER_STRIP}")

        # frames[0..8] as authored, then the canonical resting frame of `dest`.
        chosen = [f.resize((size, size), Image.LANCZOS) for f in frames[: FRAMES_PER_STRIP - 1]]
        chosen.append(resting[dest])

        strip = Image.new("RGB", (size, size * FRAMES_PER_STRIP))
        for k, frame in enumerate(chosen):
            strip.paste(frame, (0, k * size))

        filename = f"strip-{i:02d}.webp"
        out_path = os.path.join(args.out, filename)
        strip.save(out_path, "WEBP", quality=args.quality, lossless=args.lossless, method=6)
        total_bytes += os.path.getsize(out_path)

        entries.append(
            {
                "name": name,
                "char": state_char(name),
                "to": dest,
                "strip": filename,
                "source": os.path.basename(path),
            }
        )
        print(f"  [{i:02d}] {name:>6s} -> {dest:<6s} {filename}  ({os.path.getsize(out_path) / 1024:.0f} KB)")

    manifest = {
        "tileSize": size,
        "framesPerStrip": FRAMES_PER_STRIP,
        "frameMs": 40,
        "cycle": entries,
    }
    with open(os.path.join(args.out, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
        fh.write("\n")

    print(
        f"\nwrote {len(entries)} strips + manifest.json to {args.out}/ "
        f"({total_bytes / 1024 / 1024:.1f} MB on disk, "
        f"~{len(entries) * FRAMES_PER_STRIP * size * size * 4 / 1024 / 1024:.0f} MB decoded)"
    )


if __name__ == "__main__":
    main()
