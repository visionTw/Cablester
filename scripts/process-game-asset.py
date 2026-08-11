#!/usr/bin/env python3
"""Finish a chroma-keyed game sprite for the Cablester asset library.

The ImageGen workflow first uses the bundled remove_chroma_key.py helper to
produce a soft alpha matte. This script then removes the sampled background
colour from partially transparent pixels, crops to visible content, downsizes,
and writes a matching editor thumbnail.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="RGBA image produced by remove_chroma_key.py")
    parser.add_argument("--source", required=True, help="Original flat-background ImageGen output")
    parser.add_argument("--out", required=True, help="Final WebP asset path")
    parser.add_argument("--thumbnail", required=True, help="Final WebP thumbnail path")
    parser.add_argument("--max-width", type=int, required=True)
    parser.add_argument("--max-height", type=int, required=True)
    parser.add_argument("--thumb-width", type=int, default=128)
    parser.add_argument("--thumb-height", type=int, default=96)
    parser.add_argument("--quality", type=int, default=88)
    parser.add_argument("--alpha-threshold", type=int, default=8)
    return parser.parse_args()


def sample_corner_key(image: Image.Image) -> tuple[int, int, int]:
    rgb = image.convert("RGB")
    width, height = rgb.size
    sample_size = max(2, min(width, height) // 128)
    samples: list[tuple[int, int, int]] = []
    for left, top in (
        (0, 0),
        (width - sample_size, 0),
        (0, height - sample_size),
        (width - sample_size, height - sample_size),
    ):
        samples.extend(rgb.crop((left, top, left + sample_size, top + sample_size)).getdata())
    return tuple(sorted(pixel[channel] for pixel in samples)[len(samples) // 2] for channel in range(3))


def remove_key_contamination(image: Image.Image, key: tuple[int, int, int]) -> Image.Image:
    rgba = image.convert("RGBA")
    cleaned: list[tuple[int, int, int, int]] = []
    for red, green, blue, alpha in rgba.getdata():
        if alpha == 0:
            cleaned.append((0, 0, 0, 0))
            continue
        if alpha == 255:
            cleaned.append((red, green, blue, alpha))
            continue
        fraction = alpha / 255.0
        recovered = tuple(
            max(0, min(255, round((channel - (1.0 - fraction) * key_channel) / fraction)))
            for channel, key_channel in zip((red, green, blue), key)
        )
        cleaned.append((*recovered, alpha))
    rgba.putdata(cleaned)
    return rgba


def crop_visible(image: Image.Image, alpha_threshold: int) -> Image.Image:
    alpha = image.getchannel("A")
    mask = alpha.point(lambda value: 255 if value >= alpha_threshold else 0)
    bbox = mask.getbbox()
    if not bbox:
        raise ValueError("No visible pixels remain after chroma-key extraction")
    left, top, right, bottom = bbox
    padding = max(3, round(max(right - left, bottom - top) * 0.02))
    return image.crop((
        max(0, left - padding),
        max(0, top - padding),
        min(image.width, right + padding),
        min(image.height, bottom + padding),
    ))


def contain(image: Image.Image, max_width: int, max_height: int) -> Image.Image:
    scale = min(max_width / image.width, max_height / image.height, 1.0)
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    return image.resize(size, Image.Resampling.LANCZOS)


def save_webp(image: Image.Image, path: Path, quality: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "WEBP", quality=quality, method=6, exact=True)


def alpha_metrics(image: Image.Image, threshold: int) -> dict[str, float | int]:
    alpha = list(image.getchannel("A").getdata())
    visible = sum(value >= threshold for value in alpha)
    partial = sum(0 < value < 255 for value in alpha)
    return {
        "visiblePixelRatio": round(visible / len(alpha), 6),
        "partialAlphaPixels": partial,
        "estimatedDecodedBytes": image.width * image.height * 4,
    }


def main() -> None:
    args = parse_args()
    keyed = Image.open(args.input)
    source = Image.open(args.source)
    key = sample_corner_key(source)
    cleaned = remove_key_contamination(keyed, key)
    cropped = crop_visible(cleaned, args.alpha_threshold)
    asset = contain(cropped, args.max_width, args.max_height)
    thumbnail = contain(asset, args.thumb_width, args.thumb_height)
    output_path = Path(args.out)
    thumbnail_path = Path(args.thumbnail)
    save_webp(asset, output_path, args.quality)
    save_webp(thumbnail, thumbnail_path, args.quality)
    print(json.dumps({
        "keyColor": "#" + "".join(f"{channel:02x}" for channel in key),
        "width": asset.width,
        "height": asset.height,
        "fileSizeBytes": output_path.stat().st_size,
        "thumbnailWidth": thumbnail.width,
        "thumbnailHeight": thumbnail.height,
        "thumbnailFileSizeBytes": thumbnail_path.stat().st_size,
        **alpha_metrics(asset, args.alpha_threshold),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
