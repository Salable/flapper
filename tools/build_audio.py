#!/usr/bin/env python3
"""Cut a split-flap recording into single-flap samples and pack them as a sprite.

The source is a long recording of a real board (freesound 58766): a few quiet
seconds, then runs of the whole board cycling, each run a train of clacks about
96ms apart. A single clack is one flap of one tile - the sound the renderer
wants to play every time a tile steps a state.

The tool finds onsets inside the loud runs, crops each to a short sample
(attack through the body of the clack, before the next one starts), fades the
tail so samples can be fired back to back without clicks, normalises them to a
common peak, and picks a spread of distinct ones. They are packed head to tail
into one mono 16-bit WAV (so a single fetch + decodeAudioData, and no codec
roulette) with a manifest of offsets. The runtime picks a sample at random per
flap so two hundred tiles do not sound like one tile two hundred times.

Pure standard library: wave + array. No numpy.

    python3 tools/build_audio.py --src flap.mp3 --out public/audio
"""

from __future__ import annotations

import argparse
import array
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import wave

SAMPLE_RATE = 24000
# One clack: attack plus body. The next clack in a run lands ~96ms later, so
# anything longer would carry the neighbour's attack.
SAMPLE_MS = 88
FADE_MS = 18
PRE_MS = 2  # a whisker before the onset, so the attack is not chopped
ENV_MS = 1  # envelope resolution


def decode(src: str) -> array.array:
    """Mono 16-bit PCM at SAMPLE_RATE via ffmpeg (the source is an mp3)."""
    if shutil.which("ffmpeg") is None:
        sys.exit("ffmpeg is required on PATH")
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "src.wav")
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", src, "-ac", "1", "-ar", str(SAMPLE_RATE), wav],
            check=True,
        )
        with wave.open(wav) as fh:
            assert fh.getsampwidth() == 2 and fh.getnchannels() == 1
            data = array.array("h")
            data.frombytes(fh.readframes(fh.getnframes()))
            return data


def envelope_db(samples: array.array, step: int) -> list[float]:
    out = []
    for i in range(0, len(samples) - step, step):
        acc = 0
        for v in samples[i : i + step]:
            acc += v * v
        rms = math.sqrt(acc / step) / 32768
        out.append(20 * math.log10(rms + 1e-9))
    return out


def find_onsets(env: list[float], *, loud: float, quiet: float, gap_ms: int) -> list[int]:
    """Envelope indices where the level jumps from below `quiet` to above `loud`.

    `gap_ms` is the refractory period: the body of a clack is lumpy and must
    not register as several onsets.
    """
    onsets = []
    last = -gap_ms
    for t in range(2, len(env)):
        if t - last < gap_ms:
            continue
        if env[t] > loud and min(env[t - 2], env[t - 1]) < quiet:
            onsets.append(t)
            last = t
    return onsets


def cut(samples: array.array, onset_ms: int) -> array.array:
    start = max(0, (onset_ms - PRE_MS) * SAMPLE_RATE // 1000)
    length = SAMPLE_MS * SAMPLE_RATE // 1000
    clip = array.array("h", samples[start : start + length])
    if len(clip) < length:
        clip.extend([0] * (length - len(clip)))
    # Fade in over the pre-roll and out over the tail.
    pre = PRE_MS * SAMPLE_RATE // 1000
    for i in range(pre):
        clip[i] = int(clip[i] * i / pre)
    fade = FADE_MS * SAMPLE_RATE // 1000
    for i in range(fade):
        k = 0.5 - 0.5 * math.cos(math.pi * (fade - i) / fade)  # raised cosine
        clip[length - fade + i] = int(clip[length - fade + i] * k)
    return clip


def normalise(clip: array.array, peak: float) -> array.array:
    top = max(1, max(abs(v) for v in clip))
    k = peak * 32767 / top
    return array.array("h", (max(-32768, min(32767, int(v * k))) for v in clip))


def rms(clip: array.array) -> float:
    return math.sqrt(sum(v * v for v in clip) / len(clip))


def spread(clips: list[tuple[int, array.array]], count: int) -> list[tuple[int, array.array]]:
    """`count` clips spaced evenly through the recording, so the set spans the
    board's whole run rather than one second of it."""
    if len(clips) <= count:
        return clips
    step = len(clips) / count
    return [clips[int(i * step)] for i in range(count)]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", required=True, help="the recording (anything ffmpeg reads)")
    ap.add_argument("--out", default="public/audio", help="output directory")
    ap.add_argument("--count", type=int, default=16, help="samples to keep (default 16)")
    ap.add_argument("--peak", type=float, default=0.7, help="normalised peak, 0..1 (default 0.7)")
    args = ap.parse_args()

    samples = decode(args.src)
    step = SAMPLE_RATE * ENV_MS // 1000
    env = envelope_db(samples, step)
    onsets = find_onsets(env, loud=-14, quiet=-24, gap_ms=70)
    print(f"{len(onsets)} onsets in {len(samples) / SAMPLE_RATE:.1f}s")

    # Keep clacks that are clean: the next onset is far enough away that the
    # crop does not carry it, and the body is properly loud.
    clips: list[tuple[int, array.array]] = []
    for i, t in enumerate(onsets):
        nxt = onsets[i + 1] if i + 1 < len(onsets) else t + 10_000
        if nxt - t < SAMPLE_MS:
            continue
        clip = cut(samples, t)
        if max(abs(v) for v in clip) < 0.2 * 32768:
            continue
        clips.append((t, clip))
    print(f"{len(clips)} clean clacks")
    if len(clips) < 4:
        sys.exit("too few clean clacks - thresholds need a look")

    chosen = spread(clips, args.count)
    # Equal loudness across the set: peak-normalise, then trim by RMS so no one
    # sample sticks out of the crowd.
    chosen = [(t, normalise(c, args.peak)) for t, c in chosen]
    median_rms = sorted(rms(c) for _, c in chosen)[len(chosen) // 2]
    levelled = []
    for t, c in chosen:
        k = min(1.0, median_rms / max(1.0, rms(c)) * 1.25)
        levelled.append((t, array.array("h", (int(v * k) for v in c))))

    os.makedirs(args.out, exist_ok=True)
    sprite = array.array("h")
    manifest = {"sampleRate": SAMPLE_RATE, "file": "flap.wav", "samples": []}
    for t, c in levelled:
        manifest["samples"].append(
            {"offset": len(sprite) / SAMPLE_RATE, "duration": len(c) / SAMPLE_RATE, "sourceMs": t}
        )
        sprite.extend(c)

    path = os.path.join(args.out, manifest["file"])
    with wave.open(path, "wb") as fh:
        fh.setnchannels(1)
        fh.setsampwidth(2)
        fh.setframerate(SAMPLE_RATE)
        fh.writeframes(sprite.tobytes())
    with open(os.path.join(args.out, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
        fh.write("\n")
    print(f"wrote {len(levelled)} samples, {os.path.getsize(path) / 1024:.0f} KB -> {args.out}/")
    for s in manifest["samples"]:
        print(f"  @{s['sourceMs'] / 1000:7.3f}s")


if __name__ == "__main__":
    main()
