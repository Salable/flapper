#!/usr/bin/env python3
"""Build flipboard sprite strips from the designer's per-transition clips.

The source art is one animated clip per split-flap transition - a GIF (the
original "classic" set) or an MP4 (the "canary" set) - named ``FROM-TO``
(e.g. ``A-B.gif``, ``9-fullstop.mp4``, ``)-blank.gif``). MP4s are read through
``ffmpeg``, which must be on PATH.
Together they form a single closed cycle of 42 states:

    blank -> A..Z -> 0..9 -> . -> , -> ! -> ( -> ) -> blank

Each clip has 11 frames at 40ms. Frame 0 is the source character at rest and the
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
import re
import shutil
import subprocess
import sys
import tempfile

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

SOURCE_EXTENSIONS = (".gif", ".mp4")

# The 42 states the renderer knows. Anything else in a source folder is art
# drawn ahead of the cycle and is skipped.
CYCLE_STATES = (
    ["blank"]
    + [chr(c) for c in range(ord("A"), ord("Z") + 1)]
    + [str(d) for d in range(10)]
    + ["fullstop", "comma", "!", "(", ")"]
)

# The filename suffixes the designer's exports carry: ``_1``, ``_2``, ``_2_1``,
# ``_3``... are re-renders or re-encodes of the same transition. They are
# stripped before parsing and the first file (in sorted order) wins; a later
# duplicate is only an error if its frames differ from the one already taken.
VARIANT_SUFFIX = r"(?:_\d+)+$"

FRAMES_PER_STRIP = 10


def normalise(token: str) -> str:
    """Canonicalise a filename token into a state name."""
    # The canary exports spell punctuation as "- fullstop" / "_ fullstop" /
    # ", comma": the literal glyph, a separator, then the word. The word wins.
    token = token.strip()
    for word in TOKEN_CHARS:
        if token.lower().endswith(word):
            return word
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
    candidates = [p for p in glob.glob("*") if os.path.isdir(p) and source_files(p)]
    if len(candidates) == 1:
        return candidates[0]
    if not candidates:
        sys.exit("no directory containing .gif/.mp4 files found; pass --src")
    sys.exit(f"multiple candidate source directories, pass --src: {candidates}")


def source_files(src: str) -> list[str]:
    files = []
    for ext in SOURCE_EXTENSIONS:
        files.extend(glob.glob(os.path.join(src, f"*{ext}")))
    return sorted(files)


def parse_transition(path: str) -> tuple[str, str] | None:
    """``(from, to)`` state names for a clip, or None if it is not one we can use.

    Clips naming glyphs outside the cycle (the canary set ships £ $ @ % ° # and
    friends) are skipped, not rejected: the renderer's cycle is fixed and the
    designer is free to draw ahead of it.
    """
    stem = os.path.basename(path)
    # Strip every extension (one export is literally "?-:.mp4.mp4").
    while True:
        stem, ext = os.path.splitext(stem)
        if not ext:
            break
    stem = re.sub(VARIANT_SUFFIX, "", stem)
    if stem.endswith("end"):
        # "---end", "\"end-£": the designer's own markers, not transitions.
        return None
    # Split on the *last* dash that leaves something on both sides, so a glyph
    # that is itself a dash ("--&", "---") still parses.
    for cut in range(len(stem) - 1, 0, -1):
        if stem[cut] == "-" and stem[:cut] and stem[cut + 1 :]:
            raw_from, raw_to = stem[:cut], stem[cut + 1 :]
            break
    else:
        return None
    try:
        frm, to = normalise(raw_from), normalise(raw_to)
    except ValueError:
        return None
    if frm not in CYCLE_STATES or to not in CYCLE_STATES:
        return None
    return frm, to


def discover_edges(src: str) -> dict[str, tuple[str, str]]:
    """Map source state -> (destination state, clip path)."""
    edges: dict[str, tuple[str, str]] = {}
    skipped = []
    for path in source_files(src):
        parsed = parse_transition(path)
        if parsed is None:
            skipped.append(os.path.basename(path))
            continue
        frm, to = parsed
        if frm in edges:
            prior_to, prior_path = edges[frm]
            if prior_to != to:
                sys.exit(f"two transitions leave {frm!r}: {prior_path} and {path}")
            continue  # a variant export of the same transition
        edges[frm] = (to, path)
    if skipped:
        print(f"skipped {len(skipped)} clips outside the cycle: {' '.join(sorted(skipped))}")
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
    if path.lower().endswith(".mp4"):
        return read_video_frames(path)
    with Image.open(path) as im:
        return [f.convert("RGB").copy() for f in ImageSequence.Iterator(im)]


def read_video_frames(path: str) -> list[Image.Image]:
    """Decode every frame of a clip with ffmpeg (Pillow cannot read video)."""
    if shutil.which("ffmpeg") is None:
        sys.exit("ffmpeg is required on PATH to read .mp4 source art")
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", path, os.path.join(tmp, "%03d.png")],
            check=True,
        )
        frames = []
        for name in sorted(os.listdir(tmp)):
            with Image.open(os.path.join(tmp, name)) as im:
                frames.append(im.convert("RGB").copy())
        return frames


def body_colour(frame: Image.Image) -> tuple[int, int, int]:
    """The tile's face colour: the middle of the top flap (call it on the blank)."""
    w, h = frame.size
    return frame.getpixel((w // 2, h // 4))  # type: ignore[return-value]


def is_grey(rgb: tuple[int, int, int]) -> bool:
    r, g, b = rgb
    lum = (r + g + b) / 3
    return max(rgb) - min(rgb) < 14 and 25 < lum < 110


def retint_grey(frame: Image.Image, target: tuple[int, int, int]) -> Image.Image:
    """Map a neutral-grey tile body onto ``target``, keeping the shading.

    Some clips in a coloured set are exported with the old grey face (the
    glyph was drawn, the recolour forgotten). Black hardware and white glyphs
    are well outside the grey band and pass through untouched; anti-aliased
    grey-to-white edges sit on the glyph and read as glyph.
    """
    pixels = frame.load()
    w, h = frame.size

    def on_face(x: int, y: int) -> bool:
        # The hinge knobs at either end of the spindle are grey hardware, not
        # face: leave the strip around the hinge line alone at the edges.
        return abs(y - h / 2) > h * 0.07 or w * 0.12 < x < w * 0.88

    greys = [
        pixels[x, y]
        for y in range(0, h, 4)
        for x in range(0, w, 4)
        if on_face(x, y) and is_grey(pixels[x, y])
    ]
    if len(greys) < (w * h) // 16 // 20:
        return frame  # no grey body worth speaking of
    ref = sorted(sum(px) / 3 for px in greys)[len(greys) // 2]
    out = frame.copy()
    op = out.load()
    for y in range(h):
        for x in range(w):
            px = pixels[x, y]
            if on_face(x, y) and is_grey(px):
                k = (sum(px) / 3) / ref
                op[x, y] = tuple(min(255, int(round(c * k))) for c in target)
    return out


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
    ap.add_argument(
        "--fix-grey",
        action="store_true",
        help="retint any neutral-grey tile face to the set's own colour (sampled from the "
        "blank tile). For coloured sets where a clip or two was exported in the old grey.",
    )
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
    tint = None
    if args.fix_grey:
        tint = body_colour(read_frames(edges["blank"][1])[0])
        print(f"retinting grey faces to {tint}")

    def prep(frame: Image.Image) -> Image.Image:
        small = frame.resize((size, size), Image.LANCZOS)
        return retint_grey(small, tint) if tint else small

    resting: dict[str, Image.Image] = {}
    for name in cycle:
        resting[name] = prep(read_frames(edges[name][1])[0])

    entries = []
    total_bytes = 0
    for i, name in enumerate(cycle):
        dest, path = edges[name]
        frames = read_frames(path)
        if len(frames) < FRAMES_PER_STRIP:
            sys.exit(f"{path} has {len(frames)} frames, need at least {FRAMES_PER_STRIP}")

        # frames[0..8] as authored, then the canonical resting frame of `dest`.
        chosen = [prep(f) for f in frames[: FRAMES_PER_STRIP - 1]]
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
