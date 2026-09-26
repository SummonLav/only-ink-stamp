#!/usr/bin/env python3
"""Seeded, non-destructive rubber-stamp renderer; CLI and studio share this engine."""
import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageColor, ImageDraw, ImageFilter, ImageOps

DEFAULTS = dict(color="#217451", density=.78, variation=.48, edge=.55,
                edge_variation=.72, grain=.30, wear=.18, bleed=.12,
                threshold=.18, softness=.20, tolerance=.30,
                mode="auto", source_color="#217451", invert=False, seed=26,
                region=[0, 0, 1, 1], polygon=[], padding=.08, size=1600)
SLIDERS = ("density", "variation", "edge", "edge_variation", "grain", "wear",
           "bleed", "threshold", "softness", "tolerance")


def settings(raw=None):
    p = DEFAULTS | (raw or {})
    for key in SLIDERS:
        p[key] = float(p[key])
        if not math.isfinite(p[key]) or not 0 <= p[key] <= 1:
            raise ValueError(f"{key} must be between 0 and 1")
    p["size"] = int(p["size"])
    if not 64 <= p["size"] <= 4096:
        raise ValueError("size must be 64–4096")
    p["seed"] = int(p["seed"]) % 2**32
    p["padding"] = float(p["padding"])
    if not 0 <= p["padding"] <= .3:
        raise ValueError("padding must be 0–0.3")
    for k in ("color", "source_color"):
        if not isinstance(p[k], str) or len(p[k]) != 7 or not p[k].startswith("#"):
            raise ValueError(f"{k} must be #RRGGBB")
        ImageColor.getrgb(p[k])
    if p["mode"] not in ("auto", "luminance", "color", "alpha"):
        raise ValueError("Unknown extraction mode")
    r = p["region"]
    if not isinstance(r, list) or len(r) != 4 or not all(isinstance(v, (float, int)) and math.isfinite(v) for v in r):
        raise ValueError("region must be normalized [x,y,width,height]")
    x, y, w, h = r
    if min(x, y) < 0 or min(w, h) <= 0 or x + w > 1.00001 or y + h > 1.00001:
        raise ValueError("region must stay inside the input image")
    poly = p["polygon"]
    if not isinstance(poly, list) or len(poly) > 2000 or (poly and len(poly) < 3):
        raise ValueError("polygon needs 3–2000 normalized points")
    for point in poly:
        if len(point) != 2 or not all(isinstance(v, (int, float)) and math.isfinite(v) and 0 <= v <= 1 for v in point):
            raise ValueError("Invalid polygon point")
    return p


def open_image(path):
    with Image.open(path) as src:
        if src.width * src.height > 30_000_000:
            raise ValueError("Image exceeds 30 megapixels; resize it first")
        return ImageOps.exif_transpose(src).convert("RGBA")


def gray(a):
    return Image.fromarray(np.uint8(np.clip(a, 0, 1) * 255))


def blur(a, radius):
    return np.asarray(gray(a).filter(ImageFilter.GaussianBlur(radius)), dtype=np.float32) / 255


def field(rng, shape, cells):
    h, w = shape
    small = rng.random((max(2, round(cells * h / max(h, w))),
                        max(2, round(cells * w / max(h, w))))).astype(np.float32)
    return np.clip(np.asarray(Image.fromarray(small).resize((w, h), Image.Resampling.BICUBIC)), 0, 1)


def render(source, raw=None):
    p = settings(raw)
    iw, ih = source.size
    x, y, rw, rh = p["region"]
    box = (round(x * iw), round(y * ih), round((x + rw) * iw), round((y + rh) * ih))
    if box[2] <= box[0] or box[3] <= box[1]:
        raise ValueError("Selection is smaller than one source pixel")
    crop = source.crop(box)
    ratio = p["size"] / max(crop.size)
    crop = crop.resize((max(1, round(crop.width * ratio)), max(1, round(crop.height * ratio))), Image.Resampling.LANCZOS)
    rgb = np.asarray(crop, dtype=np.float32) / 255
    alpha = rgb[:, :, 3]
    lum = rgb[:, :, :3] @ np.array([.2126, .7152, .0722], dtype=np.float32)
    dark = 1 - lum
    sat = np.max(rgb[:, :, :3], axis=2) - np.min(rgb[:, :, :3], axis=2)
    if p["mode"] == "alpha":
        strength = np.ones_like(alpha)
    elif p["mode"] == "color":
        target = np.array(ImageColor.getrgb(p["source_color"]), dtype=np.float32) / 255
        distance = np.sqrt(np.mean((rgb[:, :, :3] - target) ** 2, axis=2))
        strength = np.clip((p["tolerance"] - distance) / max(.025, p["softness"] * .25), 0, 1)
    else:
        strength = np.maximum(dark, sat * .94) if p["mode"] == "auto" else dark
        strength = np.clip((strength - p["threshold"]) / max(.01, p["softness"]), 0, 1)
    if p["invert"]:
        strength = 1 - strength
    mask = strength * alpha
    selection = np.ones_like(mask)
    if p["polygon"]:
        polygon = [((px * iw - box[0]) * crop.width / (box[2] - box[0]),
                    (py * ih - box[1]) * crop.height / (box[3] - box[1])) for px, py in p["polygon"]]
        cut = Image.new("L", crop.size)
        ImageDraw.Draw(cut).polygon(polygon, fill=255)
        selection = np.asarray(cut, dtype=np.float32) / 255
        mask *= selection

    # Fixed seed and resolution make the texture reproducible, including CLI exports.
    rng = np.random.default_rng(p["seed"])
    shape = mask.shape
    coarse = field(rng, shape, 7)
    medium = field(rng, shape, 27)
    fine = field(rng, shape, max(60, p["size"] // 3))
    pressure = .7 * coarse + .3 * medium
    opacity = p["density"] * (1 - p["variation"] * 1.4 * (1 - pressure))
    opacity = np.clip(opacity, 0, 1)

    # Only the interior boundary receives pooled ink. A low-frequency field makes
    # selected portions darker, without drawing a uniform outline around the stamp.
    radius = max(.7, p["size"] * .0035)
    rim = np.clip((mask - blur(mask, radius)) * 2.9, 0, 1)
    patches = np.clip((field(rng, shape, 12) - .28) * 2.1, 0, 1)
    local_edge = (1 - p["edge_variation"]) + p["edge_variation"] * patches
    pool = rim * p["edge"] * local_edge
    opacity += (1 - opacity) * pool * .94
    grain = (fine * .62 + rng.random(shape, dtype=np.float32) * .38)
    opacity *= 1 - p["grain"] * (.16 + .62 * grain)

    # Tiny paper voids plus broader dry patches. At zero wear no holes are added.
    dry = field(rng, shape, max(40, p["size"] // 7))
    holes = np.clip((dry - (1 - p["wear"] * .58)) * 16, 0, 1)
    opacity *= 1 - holes * .96
    ink = mask * np.clip(opacity, 0, 1)
    if p["bleed"]:
        spread = blur(ink, max(.4, p["size"] * .0009)) * p["bleed"] * .32
        ink = np.maximum(ink, spread) * selection
    # Zero density means genuinely no ink, even when edge pooling is enabled.
    ink *= min(1, p["density"] * 12)
    pigment = np.array(ImageColor.getrgb(p["color"]), dtype=np.float32)
    color = np.broadcast_to(pigment, (*shape, 3)).copy()
    color *= (1 - pool[..., None] * .20)
    rgba = np.dstack([np.uint8(np.clip(color, 0, 255)), np.uint8(np.clip(ink, 0, 1) * 255)])
    result = Image.fromarray(rgba)
    pad = round(max(result.size) * p["padding"])
    out = Image.new("RGBA", (result.width + pad * 2, result.height + pad * 2))
    out.paste(result, (pad, pad))
    return out, p


def paper_preview(image, color="#f6f3eb"):
    out = Image.new("RGBA", image.size, color)
    out.alpha_composite(image)
    return out.convert("RGB")


def write_outputs(image, p, output, source_path=None):
    out = Path(output).expanduser().resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    image.save(out, format="PNG")
    paper_preview(image).save(out.with_name(out.stem + "-paper.png"))
    data = {"version": 1, "settings": p}
    if source_path:
        source_path = Path(source_path).resolve()
        data["source"] = {"name": source_path.name, "sha256": hashlib.sha256(source_path.read_bytes()).hexdigest()}
    out.with_suffix(".json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input", type=Path)
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument("--preset", type=Path)
    ap.add_argument("--region", help="Normalized x,y,width,height")
    ap.add_argument("--color")
    ap.add_argument("--source-color")
    ap.add_argument("--mode", choices=["auto", "luminance", "color", "alpha"])
    ap.add_argument("--size", type=int)
    ap.add_argument("--seed", type=int)
    for key in SLIDERS:
        ap.add_argument("--" + key.replace("_", "-"), type=float)
    args = ap.parse_args()
    raw = {}
    if args.preset:
        raw = json.loads(args.preset.read_text())
        raw = raw.get("settings", raw)
    for k in [*SLIDERS, "color", "source_color", "mode", "size", "seed"]:
        if getattr(args, k) is not None:
            raw[k] = getattr(args, k)
    if args.region:
        raw["region"] = [float(v) for v in args.region.split(",")]
        raw["polygon"] = []
    try:
        image, p = render(open_image(args.input), raw)
        out = write_outputs(image, p, args.output, args.input)
    except (ValueError, OSError, TypeError) as e:
        ap.error(str(e))
    print(json.dumps({"png": str(out), "width": image.width, "height": image.height}))


if __name__ == "__main__":
    main()
