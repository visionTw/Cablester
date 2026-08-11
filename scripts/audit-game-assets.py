#!/usr/bin/env python3
"""Audit registered Cablester WebP game assets without modifying them.

The registry remains the source of truth. This script asks Node.js to serialize
``GENERATED_GAME_ASSETS`` from ``src/asset-library.js``, then verifies every
registered main image and thumbnail with Pillow. It emits a compact human report
by default and deterministic machine-readable JSON with ``--format json``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

from PIL import Image, ImageChops, ImageStat


REPORT_VERSION = 1
MEANINGFUL_ALPHA = 8
MAX_BORDER_ALPHA = 4
MAX_THUMBNAIL_WIDTH = 128
MAX_THUMBNAIL_HEIGHT = 96
MAX_THUMBNAIL_ALPHA_MAE = 0.5
MAX_THUMBNAIL_COMPOSITE_RGB_MAE = 4.0

THRESHOLDS = {
    "meaningfulAlpha": MEANINGFUL_ALPHA,
    "maxBorderAlpha": MAX_BORDER_ALPHA,
    "nearChroma": {"redMin": 220, "greenMax": 50, "blueMin": 220},
    "exactChroma": {"redMin": 250, "greenMax": 5, "blueMin": 250},
    "maxThumbnailWidth": MAX_THUMBNAIL_WIDTH,
    "maxThumbnailHeight": MAX_THUMBNAIL_HEIGHT,
    "maxThumbnailAlphaMae": MAX_THUMBNAIL_ALPHA_MAE,
    "maxThumbnailCompositeRgbMae": MAX_THUMBNAIL_COMPOSITE_RGB_MAE,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--format",
        choices=("text", "json"),
        default="text",
        help="Report format written to stdout (default: text)",
    )
    parser.add_argument(
        "--project-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Cablester checkout containing src/asset-library.js",
    )
    return parser.parse_args()


def load_registered_assets(project_root: Path) -> list[dict[str, Any]]:
    script = (
        "import { GENERATED_GAME_ASSETS } from './src/asset-library.js';"
        "process.stdout.write(JSON.stringify(GENERATED_GAME_ASSETS));"
    )
    completed = subprocess.run(
        ["node", "--input-type=module", "--eval", script],
        cwd=project_root,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip() or "unknown Node.js error"
        raise RuntimeError(f"Could not load GENERATED_GAME_ASSETS: {detail}")
    try:
        assets = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Registry export was not valid JSON: {error}") from error
    if not isinstance(assets, list):
        raise RuntimeError("GENERATED_GAME_ASSETS must serialize to a JSON array")
    return assets


def add_error(target: list[dict[str, str]], code: str, message: str) -> None:
    target.append({"code": code, "message": message})


def resolve_registry_path(project_root: Path, value: Any, field: str) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty string")
    relative = value[2:] if value.startswith("./") else value
    candidate = (project_root / relative).resolve()
    asset_root = (project_root / "assets" / "game").resolve()
    if candidate != asset_root and asset_root not in candidate.parents:
        raise ValueError(f"{field} must stay inside assets/game: {value}")
    return candidate


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(64 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def alpha_bbox_margins(alpha: Image.Image, threshold: int) -> list[int] | None:
    mask = alpha.point(lambda value: 255 if value >= threshold else 0)
    bbox = mask.getbbox()
    if not bbox:
        return None
    left, top, right, bottom = bbox
    return [left, top, alpha.width - right, alpha.height - bottom]


def border_alpha_max(alpha: Image.Image) -> int:
    width, height = alpha.size
    values = (
        list(alpha.crop((0, 0, width, 1)).getdata())
        + list(alpha.crop((0, height - 1, width, height)).getdata())
        + list(alpha.crop((0, 0, 1, height)).getdata())
        + list(alpha.crop((width - 1, 0, width, height)).getdata())
    )
    return max(values, default=0)


def inspect_image(path: Path) -> tuple[dict[str, Any], Image.Image]:
    with Image.open(path) as opened:
        opened.load()
        source_format = opened.format
        source_mode = opened.mode
        image = opened.convert("RGBA")

    alpha = image.getchannel("A")
    alpha_values = list(alpha.getdata())
    pixels = list(image.getdata())
    total_pixels = image.width * image.height

    exact_chroma_visible = 0
    near_chroma_meaningful = 0
    near_chroma_transparent = 0
    for red, green, blue, opacity in pixels:
        exact_chroma = red >= 250 and green <= 5 and blue >= 250
        near_chroma = red >= 220 and green <= 50 and blue >= 220
        if opacity > 0 and exact_chroma:
            exact_chroma_visible += 1
        if opacity >= MEANINGFUL_ALPHA and near_chroma:
            near_chroma_meaningful += 1
        if opacity == 0 and near_chroma:
            near_chroma_transparent += 1

    metrics = {
        "format": source_format,
        "mode": source_mode,
        "width": image.width,
        "height": image.height,
        "fileSizeBytes": path.stat().st_size,
        "sha256": sha256(path),
        "estimatedDecodedBytes": total_pixels * 4,
        "alpha": {
            "min": min(alpha_values),
            "max": max(alpha_values),
            "zeroPixels": sum(value == 0 for value in alpha_values),
            "partialPixels": sum(0 < value < 255 for value in alpha_values),
            "opaquePixels": sum(value == 255 for value in alpha_values),
            "meaningfulPixels": sum(value >= MEANINGFUL_ALPHA for value in alpha_values),
            "coveragePercent": round(sum(alpha_values) / (255 * total_pixels) * 100, 6),
            "meaningfulMargins": alpha_bbox_margins(alpha, MEANINGFUL_ALPHA),
            "borderMax": border_alpha_max(alpha),
        },
        "chroma": {
            "exactVisiblePixels": exact_chroma_visible,
            "nearMeaningfulPixels": near_chroma_meaningful,
            "nearTransparentPixels": near_chroma_transparent,
        },
    }
    return metrics, image


def expected_thumbnail_size(width: int, height: int) -> tuple[int, int]:
    scale = min(MAX_THUMBNAIL_WIDTH / width, MAX_THUMBNAIL_HEIGHT / height, 1.0)
    return max(1, round(width * scale)), max(1, round(height * scale))


def composite_rgb_mae(expected: Image.Image, actual: Image.Image, background: int) -> float:
    backdrop = Image.new("RGBA", actual.size, (background, background, background, 255))
    expected_rgb = Image.alpha_composite(backdrop, expected).convert("RGB")
    actual_rgb = Image.alpha_composite(backdrop, actual).convert("RGB")
    difference = ImageChops.difference(expected_rgb, actual_rgb)
    return sum(ImageStat.Stat(difference).mean) / 3


def thumbnail_similarity(main: Image.Image, thumbnail: Image.Image) -> dict[str, float]:
    expected = main.resize(thumbnail.size, Image.Resampling.LANCZOS)
    alpha_difference = ImageChops.difference(expected.getchannel("A"), thumbnail.getchannel("A"))
    return {
        "alphaMae": round(ImageStat.Stat(alpha_difference).mean[0], 6),
        "blackCompositeRgbMae": round(composite_rgb_mae(expected, thumbnail, 0), 6),
        "whiteCompositeRgbMae": round(composite_rgb_mae(expected, thumbnail, 255), 6),
    }


def validate_image_metrics(
    metrics: dict[str, Any],
    errors: list[dict[str, str]],
    prefix: str,
) -> None:
    if metrics["format"] != "WEBP":
        add_error(errors, f"{prefix}.format", f"Expected WEBP, got {metrics['format']!r}")
    if metrics["mode"] != "RGBA":
        add_error(errors, f"{prefix}.mode", f"Expected source mode RGBA, got {metrics['mode']!r}")

    alpha = metrics["alpha"]
    if alpha["zeroPixels"] == 0:
        add_error(errors, f"{prefix}.alpha.transparent", "Image has no fully transparent pixels")
    if alpha["meaningfulPixels"] == 0:
        add_error(errors, f"{prefix}.alpha.visible", "Image has no meaningful visible pixels")
    if alpha["borderMax"] > MAX_BORDER_ALPHA:
        add_error(
            errors,
            f"{prefix}.alpha.border",
            f"Border alpha {alpha['borderMax']} exceeds {MAX_BORDER_ALPHA}",
        )
    margins = alpha["meaningfulMargins"]
    if margins is None or any(margin < 1 for margin in margins):
        add_error(
            errors,
            f"{prefix}.alpha.margin",
            f"Meaningful alpha must leave at least one transparent pixel on every edge; got {margins}",
        )

    chroma = metrics["chroma"]
    if chroma["exactVisiblePixels"]:
        add_error(
            errors,
            f"{prefix}.chroma.exact",
            f"Found {chroma['exactVisiblePixels']} visible flat-magenta pixels",
        )
    if chroma["nearMeaningfulPixels"]:
        add_error(
            errors,
            f"{prefix}.chroma.near",
            f"Found {chroma['nearMeaningfulPixels']} meaningful near-magenta pixels",
        )


def audit_asset(project_root: Path, asset: dict[str, Any]) -> dict[str, Any]:
    asset_id = str(asset.get("id") or "<missing-id>")
    result: dict[str, Any] = {
        "id": asset_id,
        "path": asset.get("path"),
        "thumbnailPath": asset.get("thumbnailPath"),
        "metadata": {
            "width": asset.get("width"),
            "height": asset.get("height"),
            "fileSizeBytes": asset.get("fileSizeBytes"),
        },
        "main": None,
        "thumbnail": None,
        "thumbnailSimilarity": None,
        "errors": [],
    }
    errors: list[dict[str, str]] = result["errors"]

    if asset.get("kind") != "image":
        add_error(errors, "registry.kind", f"Expected image asset, got {asset.get('kind')!r}")

    try:
        main_path = resolve_registry_path(project_root, asset.get("path"), "path")
    except ValueError as error:
        add_error(errors, "registry.path", str(error))
        main_path = None
    try:
        thumbnail_path = resolve_registry_path(project_root, asset.get("thumbnailPath"), "thumbnailPath")
    except ValueError as error:
        add_error(errors, "registry.thumbnailPath", str(error))
        thumbnail_path = None

    main_image: Image.Image | None = None
    if main_path is None or not main_path.is_file():
        if main_path is not None:
            add_error(errors, "main.missing", f"Missing file: {main_path.relative_to(project_root)}")
    else:
        try:
            main_metrics, main_image = inspect_image(main_path)
            result["main"] = main_metrics
            validate_image_metrics(main_metrics, errors, "main")
            expected_dimensions = (asset.get("width"), asset.get("height"))
            actual_dimensions = (main_metrics["width"], main_metrics["height"])
            if actual_dimensions != expected_dimensions:
                add_error(
                    errors,
                    "main.dimensions",
                    f"Registry dimensions {expected_dimensions} do not match decoded {actual_dimensions}",
                )
            if main_metrics["fileSizeBytes"] != asset.get("fileSizeBytes"):
                add_error(
                    errors,
                    "main.fileSizeBytes",
                    f"Registry bytes {asset.get('fileSizeBytes')} do not match {main_metrics['fileSizeBytes']}",
                )
        except (OSError, ValueError) as error:
            add_error(errors, "main.decode", f"Could not decode main image: {error}")

    thumbnail_image: Image.Image | None = None
    if thumbnail_path is None or not thumbnail_path.is_file():
        if thumbnail_path is not None:
            add_error(errors, "thumbnail.missing", f"Missing file: {thumbnail_path.relative_to(project_root)}")
    else:
        try:
            thumbnail_metrics, thumbnail_image = inspect_image(thumbnail_path)
            result["thumbnail"] = thumbnail_metrics
            validate_image_metrics(thumbnail_metrics, errors, "thumbnail")
            if main_image is not None:
                expected_size = expected_thumbnail_size(main_image.width, main_image.height)
                actual_size = (thumbnail_image.width, thumbnail_image.height)
                if actual_size != expected_size:
                    add_error(
                        errors,
                        "thumbnail.dimensions",
                        f"Expected contained thumbnail {expected_size}, got {actual_size}",
                    )
        except (OSError, ValueError) as error:
            add_error(errors, "thumbnail.decode", f"Could not decode thumbnail: {error}")

    if main_image is not None and thumbnail_image is not None:
        similarity = thumbnail_similarity(main_image, thumbnail_image)
        result["thumbnailSimilarity"] = similarity
        if similarity["alphaMae"] > MAX_THUMBNAIL_ALPHA_MAE:
            add_error(
                errors,
                "thumbnail.similarity.alpha",
                f"Alpha MAE {similarity['alphaMae']} exceeds {MAX_THUMBNAIL_ALPHA_MAE}",
            )
        composite_mae = max(
            similarity["blackCompositeRgbMae"],
            similarity["whiteCompositeRgbMae"],
        )
        if composite_mae > MAX_THUMBNAIL_COMPOSITE_RGB_MAE:
            add_error(
                errors,
                "thumbnail.similarity.rgb",
                f"Composite RGB MAE {composite_mae} exceeds {MAX_THUMBNAIL_COMPOSITE_RGB_MAE}",
            )

    result["status"] = "pass" if not errors else "fail"
    return result


def audit(project_root: Path) -> dict[str, Any]:
    project_root = project_root.resolve()
    assets = load_registered_assets(project_root)
    results = [audit_asset(project_root, asset) for asset in assets]

    registry_paths: list[str] = []
    for asset in assets:
        for field in ("path", "thumbnailPath"):
            value = asset.get(field)
            if isinstance(value, str):
                registry_paths.append(value.removeprefix("./"))
    registered = set(registry_paths)
    actual = {
        path.relative_to(project_root).as_posix()
        for path in (project_root / "assets" / "game").rglob("*.webp")
    }
    unregistered_files = sorted(actual - registered)
    missing_registered_files = sorted(registered - actual)

    global_errors: list[dict[str, str]] = []
    ids = [str(asset.get("id") or "") for asset in assets]
    duplicate_ids = sorted({asset_id for asset_id in ids if ids.count(asset_id) > 1})
    if duplicate_ids:
        add_error(global_errors, "registry.duplicateIds", f"Duplicate IDs: {duplicate_ids}")
    duplicate_paths = sorted({path for path in registry_paths if registry_paths.count(path) > 1})
    if duplicate_paths:
        add_error(global_errors, "registry.duplicatePaths", f"Duplicate paths: {duplicate_paths}")
    if unregistered_files:
        add_error(global_errors, "files.unregistered", f"Unregistered WebP files: {unregistered_files}")
    if missing_registered_files:
        add_error(global_errors, "files.missing", f"Missing registered WebP files: {missing_registered_files}")

    asset_error_count = sum(len(result["errors"]) for result in results)
    disk_bytes = sum(
        (record.get("fileSizeBytes", 0) if record else 0)
        for result in results
        for record in (result["main"], result["thumbnail"])
    )
    decoded_bytes = sum(
        (record.get("estimatedDecodedBytes", 0) if record else 0)
        for result in results
        for record in (result["main"], result["thumbnail"])
    )
    error_count = asset_error_count + len(global_errors)
    summary = {
        "assetCount": len(results),
        "expectedFileCount": len(registry_paths),
        "auditedFileCount": len(actual & registered),
        "passedAssets": sum(result["status"] == "pass" for result in results),
        "failedAssets": sum(result["status"] == "fail" for result in results),
        "errorCount": error_count,
        "diskBytes": disk_bytes,
        "estimatedDecodedBytes": decoded_bytes,
        "unregisteredFileCount": len(unregistered_files),
        "missingRegisteredFileCount": len(missing_registered_files),
    }
    return {
        "reportVersion": REPORT_VERSION,
        "registrySource": "src/asset-library.js#GENERATED_GAME_ASSETS",
        "status": "pass" if error_count == 0 else "fail",
        "thresholds": THRESHOLDS,
        "summary": summary,
        "globalErrors": global_errors,
        "unregisteredFiles": unregistered_files,
        "missingRegisteredFiles": missing_registered_files,
        "assets": results,
    }


def format_bytes(value: int) -> str:
    return f"{value / 1024:.1f} KiB"


def print_text(report: dict[str, Any]) -> None:
    summary = report["summary"]
    print(
        f"Game asset audit {report['status'].upper()} · "
        f"{summary['assetCount']} assets · {summary['auditedFileCount']}/{summary['expectedFileCount']} files · "
        f"{summary['errorCount']} errors · {format_bytes(summary['diskBytes'])} on disk · "
        f"{format_bytes(summary['estimatedDecodedBytes'])} decoded"
    )
    for asset in report["assets"]:
        if asset["main"] and asset["thumbnail"] and asset["thumbnailSimilarity"]:
            main = asset["main"]
            thumbnail = asset["thumbnail"]
            similarity = asset["thumbnailSimilarity"]
            print(
                f"{asset['status'].upper():4} {asset['id']} · "
                f"{main['width']}x{main['height']} → {thumbnail['width']}x{thumbnail['height']} · "
                f"alpha {main['alpha']['coveragePercent']:.2f}% · "
                f"magenta {main['chroma']['nearMeaningfulPixels'] + thumbnail['chroma']['nearMeaningfulPixels']} · "
                f"edge {max(main['alpha']['borderMax'], thumbnail['alpha']['borderMax'])}/255 · "
                f"thumb RGB MAE {max(similarity['blackCompositeRgbMae'], similarity['whiteCompositeRgbMae']):.3f}"
            )
        else:
            print(f"{asset['status'].upper():4} {asset['id']}")
        for error in asset["errors"]:
            print(f"     {error['code']}: {error['message']}")
    for error in report["globalErrors"]:
        print(f"FAIL {error['code']}: {error['message']}")


def main() -> int:
    args = parse_args()
    try:
        report = audit(args.project_root)
    except (OSError, RuntimeError, ValueError) as error:
        if args.format == "json":
            print(json.dumps({"reportVersion": REPORT_VERSION, "status": "error", "error": str(error)}))
        else:
            print(f"Game asset audit ERROR · {error}", file=sys.stderr)
        return 2

    if args.format == "json":
        print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    else:
        print_text(report)
    return 0 if report["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
