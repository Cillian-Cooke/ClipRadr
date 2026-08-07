"""FFmpeg clip export engine."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from backend.config import ROOT_DIR, settings


ASPECT_PRESETS = {
    "16:9": (1920, 1080),
    "9:16": (1080, 1920),
    "1:1": (1080, 1080),
    "4:5": (1080, 1350),
}


class FFmpegError(RuntimeError):
    pass


def ffmpeg_binary() -> str | None:
    path = shutil.which("ffmpeg")
    if path:
        return path
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def ffmpeg_available() -> bool:
    return ffmpeg_binary() is not None


def resolve_output_size(aspect_ratio: str, width: int | None = None, height: int | None = None) -> tuple[int, int]:
    if width and height:
        return width, height
    return ASPECT_PRESETS.get(aspect_ratio, (1920, 1080))


def crop_filter(aspect_ratio: str, crop_position: str, out_w: int, out_h: int) -> str:
    """Build a crop+scale filter for the target aspect."""
    # Target aspect as float
    target = out_w / out_h

    if crop_position.upper() == "LEFT":
        x_expr = "0"
    elif crop_position.upper() == "RIGHT":
        x_expr = "iw-ow"
    else:
        x_expr = "(iw-ow)/2"

    # Crop to target aspect from source, then scale
    # ow = min(iw, ih * target); oh = ow / target
    crop = (
        f"crop='if(gte(iw/ih\\,{target})\\,ih*{target}\\,iw)':"
        f"'if(gte(iw/ih\\,{target})\\,ih\\,iw/{target})':"
        f"{x_expr}:'(ih-oh)/2'"
    )
    scale = f"scale={out_w}:{out_h}"
    return f"{crop},{scale}"


def export_clip(
    *,
    source_path: str | Path,
    output_path: str | Path,
    start_seconds: float,
    end_seconds: float,
    aspect_ratio: str = "16:9",
    width: int | None = None,
    height: int | None = None,
    crop_position: str = "CENTER",
    stream_copy: bool = False,
    fast: bool = False,
) -> Path:
    ffmpeg = ffmpeg_binary()
    if not ffmpeg:
        raise FFmpegError("ffmpeg is not installed on this system")

    source = Path(source_path)
    if not source.exists():
        raise FFmpegError(f"Source media not found: {source}")

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    duration = max(0.1, float(end_seconds) - float(start_seconds))
    out_w, out_h = resolve_output_size(aspect_ratio, width, height)

    # Fast seek before -i (good enough for editor clips); accurate enough after yt-dlp section cut.
    cmd = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        f"{start_seconds:.3f}",
        "-i",
        str(source),
        "-t",
        f"{duration:.3f}",
    ]

    if stream_copy and aspect_ratio == "16:9":
        cmd += ["-c", "copy", "-movflags", "+faststart"]
    else:
        vf = crop_filter(aspect_ratio, crop_position, out_w, out_h)
        preset = "ultrafast" if fast else "veryfast"
        # Keep 1080p YouTube target but encode quickly for interactive export.
        cmd += [
            "-vf",
            vf,
            "-c:v",
            "libx264",
            "-preset",
            preset,
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-movflags",
            "+faststart",
        ]

    cmd.append(str(out))

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 or not out.exists():
        raise FFmpegError(result.stderr[-2000:] or "FFmpeg failed")
    return out


def remux_faststart(source_path: str | Path, output_path: str | Path) -> Path:
    """Copy streams and add moov atom at front — near-instant finalize."""
    ffmpeg = ffmpeg_binary()
    if not ffmpeg:
        raise FFmpegError("ffmpeg is not installed on this system")
    source = Path(source_path)
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source),
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        str(out),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 or not out.exists():
        raise FFmpegError(result.stderr[-1500:] or "Remux failed")
    return out


def exports_dir() -> Path:
    path = Path(settings.storage_path) / "exports"
    if not path.is_absolute():
        path = ROOT_DIR / path
    path.mkdir(parents=True, exist_ok=True)
    return path
