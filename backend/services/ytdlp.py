"""YouTube clip-range download via yt-dlp (local only)."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from backend.services.ffmpeg import export_clip, ffmpeg_binary


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
    """Download only [start, end] from YouTube into output_path."""
    start = max(0.0, float(start_seconds))
    end = max(start + 0.5, float(end_seconds))
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    url = f"https://www.youtube.com/watch?v={youtube_video_id}"
    section = f"*{start:.3f}-{end:.3f}"

    with tempfile.TemporaryDirectory(prefix="clipradar_yt_") as tmp:
        tmp_base = Path(tmp) / "section"
        cmd = [
            *_ytdlp_cmd_prefix(),
            "--no-playlist",
            "--force-keyframes-at-cuts",
            "--download-sections",
            section,
            "-f",
            "bv*[height<=1080]+ba/b[height<=1080]/b",
            "--merge-output-format",
            "mp4",
            "-o",
            str(tmp_base) + ".%(ext)s",
            "--no-warnings",
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
            # Remux to mp4
            ff_bin = ffmpeg_binary()
            if not ff_bin:
                raise YtDlpError("ffmpeg required to remux yt-dlp output")
            remux = subprocess.run(
                [ff_bin, "-y", "-i", str(src), "-c", "copy", str(out)],
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
) -> Path:
    """Download the section, then normalize with the same crop/scale pipeline as local export."""
    out = Path(output_path)
    with tempfile.TemporaryDirectory(prefix="clipradar_yt_raw_") as tmp:
        raw = Path(tmp) / "raw.mp4"
        download_clip_section(
            youtube_video_id=youtube_video_id,
            start_seconds=start_seconds,
            end_seconds=end_seconds,
            output_path=raw,
        )
        duration = max(0.5, float(end_seconds) - float(start_seconds))
        return export_clip(
            source_path=raw,
            output_path=out,
            start_seconds=0,
            end_seconds=duration,
            aspect_ratio=aspect_ratio,
            width=width,
            height=height,
            crop_position=crop_position,
        )
