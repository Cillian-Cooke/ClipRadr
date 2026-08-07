"""YouTube clip-range download via yt-dlp (local only) — optimized for speed."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from backend.services.ffmpeg import FFmpegError, export_clip, ffmpeg_binary, remux_faststart


class YtDlpError(RuntimeError):
    pass


def ytdlp_binary() -> str | None:
    if shutil.which("yt-dlp"):
        return shutil.which("yt-dlp")
    try:
        import yt_dlp  # noqa: F401

        return "module"
    except Exception:
        return None


def ytdlp_available() -> bool:
    return ytdlp_binary() is not None


def _ytdlp_cmd_prefix() -> list[str]:
    binary = ytdlp_binary()
    if not binary:
        raise YtDlpError(
            "yt-dlp is not installed. Run: pip install yt-dlp  (and ensure ffmpeg is available)."
        )
    if binary == "module":
        import sys

        return [sys.executable, "-m", "yt_dlp"]
    return [binary]


def download_clip_section(
    *,
    youtube_video_id: str,
    start_seconds: float,
    end_seconds: float,
    output_path: str | Path,
) -> Path:
    """Download only [start, end] from YouTube into output_path (mp4 preferred)."""
    start = max(0.0, float(start_seconds))
    end = max(start + 0.5, float(end_seconds))
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    url = f"https://www.youtube.com/watch?v={youtube_video_id}"
    section = f"*{start:.3f}-{end:.3f}"

    with tempfile.TemporaryDirectory(prefix="clipradar_yt_") as tmp:
        tmp_base = Path(tmp) / "section"
        # Prefer a single progressive MP4 when possible (avoids merge + double work).
        # Fall back to best video+audio ≤1080p.
        cmd = [
            *_ytdlp_cmd_prefix(),
            "--no-playlist",
            "--force-keyframes-at-cuts",
            "--download-sections",
            section,
            "-f",
            "bv*[ext=mp4][height<=1080]+ba[ext=m4a]/b[ext=mp4][height<=1080]/bv*[height<=1080]+ba/b",
            "--merge-output-format",
            "mp4",
            "-o",
            str(tmp_base) + ".%(ext)s",
            "--no-warnings",
            "--newline",
            url,
        ]
        ff = ffmpeg_binary()
        if ff:
            cmd.extend(["--ffmpeg-location", str(Path(ff).parent)])

        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            err = (result.stderr or result.stdout or "yt-dlp failed").strip()
            raise YtDlpError(err[-2000:])

        produced = sorted(Path(tmp).glob("section.*"))
        if not produced:
            raise YtDlpError("yt-dlp finished but produced no file.")

        src = produced[0]
        if src.suffix.lower() == ".mp4":
            shutil.copy2(src, out)
        else:
            ff_bin = ffmpeg_binary()
            if not ff_bin:
                raise YtDlpError("ffmpeg required to remux yt-dlp output")
            remux = subprocess.run(
                [ff_bin, "-y", "-i", str(src), "-c", "copy", "-movflags", "+faststart", str(out)],
                capture_output=True,
                text=True,
            )
            if remux.returncode != 0 or not out.exists():
                raise YtDlpError(remux.stderr[-1500:] or "Remux failed")

    if not out.exists():
        raise YtDlpError("Clip file missing after download.")
    return out


def export_youtube_clip(
    *,
    youtube_video_id: str,
    output_path: str | Path,
    start_seconds: float,
    end_seconds: float,
    aspect_ratio: str = "16:9",
    width: int | None = None,
    height: int | None = None,
    crop_position: str = "CENTER",
    on_progress=None,
) -> Path:
    """
    Fetch the IN→OUT section once, then finalize.

    For standard YouTube 16:9 CENTER exports we only remux (+faststart) —
    avoiding a full second H.264 encode. Other aspects still re-encode once.
    """
    out = Path(output_path)
    if on_progress:
        on_progress(30)
    with tempfile.TemporaryDirectory(prefix="clipradar_yt_raw_") as tmp:
        raw = Path(tmp) / "raw.mp4"
        download_clip_section(
            youtube_video_id=youtube_video_id,
            start_seconds=start_seconds,
            end_seconds=end_seconds,
            output_path=raw,
        )
        if on_progress:
            on_progress(70)

        needs_crop = aspect_ratio != "16:9" or (crop_position or "CENTER").upper() != "CENTER"
        if not needs_crop and (width in (None, 1920)) and (height in (None, 1080)):
            try:
                remux_faststart(raw, out)
                if on_progress:
                    on_progress(95)
                return out
            except FFmpegError:
                pass  # fall through to encode

        duration = max(0.5, float(end_seconds) - float(start_seconds))
        result = export_clip(
            source_path=raw,
            output_path=out,
            start_seconds=0,
            end_seconds=duration,
            aspect_ratio=aspect_ratio,
            width=width,
            height=height,
            crop_position=crop_position,
            fast=True,
        )
        if on_progress:
            on_progress(95)
        return result
