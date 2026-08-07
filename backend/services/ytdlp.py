"""YouTube clip-range download via yt-dlp (local only) — optimized for speed."""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from backend.services.ffmpeg import FFmpegError, export_clip, ffmpeg_binary, remux_faststart


class YtDlpError(RuntimeError):
    pass


def ytdlp_binary() -> str | None:
    """Prefer the app venv's yt-dlp module over a stale system binary."""
    try:
        import yt_dlp  # noqa: F401

        return "module"
    except Exception:
        pass
    return shutil.which("yt-dlp")


def ytdlp_available() -> bool:
    return ytdlp_binary() is not None


def _ytdlp_cmd_prefix() -> list[str]:
    binary = ytdlp_binary()
    if not binary:
        raise YtDlpError(
            "yt-dlp is not installed. Run: pip install -U yt-dlp  (and ensure ffmpeg is available)."
        )
    if binary == "module":
        return [sys.executable, "-m", "yt_dlp"]
    return [binary]


def _ffmpeg_location_dir() -> str | None:
    """
    Directory yt-dlp can use with --ffmpeg-location.

    imageio-ffmpeg ships a binary not named `ffmpeg`, so we expose a stable
    symlink directory when needed.
    """
    ff = ffmpeg_binary()
    if not ff:
        return None
    path = Path(ff)
    if path.name == "ffmpeg":
        return str(path.parent)
    link_dir = Path(tempfile.gettempdir()) / "clipradar_ffmpeg_bin"
    link_dir.mkdir(parents=True, exist_ok=True)
    link = link_dir / "ffmpeg"
    try:
        if link.exists() or link.is_symlink():
            link.unlink()
        link.symlink_to(path.resolve())
    except OSError:
        return str(path.parent)
    return str(link_dir)


# Prefer progressive 360p (18) when available — works with android client and
# avoids SABR/DRM-only adaptive streams. Fall back to merged ≤1080p.
_FORMAT = "18/bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b"

# Avoid `tv` client — YouTube currently marks many tv formats as DRM.
_PLAYER_CLIENTS = "android,web"


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
    duration = max(0.5, end - start)
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    url = f"https://www.youtube.com/watch?v={youtube_video_id}"
    ff_bin = ffmpeg_binary()
    if not ff_bin:
        raise YtDlpError("ffmpeg is required for clip export.")

    # Preferred path: resolve a progressive stream URL, then ffmpeg-cut the range.
    # Avoids fragile --download-sections + DRM/tv clients.
    try:
        return _cut_from_direct_url(
            page_url=url,
            start=start,
            duration=duration,
            output_path=out,
            ff_bin=ff_bin,
        )
    except YtDlpError:
        pass

    section = f"*{start:.3f}-{end:.3f}"
    ff_dir = _ffmpeg_location_dir()

    with tempfile.TemporaryDirectory(prefix="clipradar_yt_") as tmp:
        tmp_base = Path(tmp) / "section"
        cmd = [
            *_ytdlp_cmd_prefix(),
            "--no-playlist",
            "--force-keyframes-at-cuts",
            "--download-sections",
            section,
            "-f",
            _FORMAT,
            "--merge-output-format",
            "mp4",
            "--extractor-args",
            f"youtube:player_client={_PLAYER_CLIENTS}",
            "-o",
            str(tmp_base) + ".%(ext)s",
            "--no-warnings",
            "--newline",
            url,
        ]
        if ff_dir:
            cmd.extend(["--ffmpeg-location", ff_dir])

        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            err = (result.stderr or result.stdout or "yt-dlp failed").strip()
            result = _download_fallback(
                url=url,
                section=section,
                tmp_base=tmp_base,
                ff_dir=ff_dir,
            )
            if result.returncode != 0:
                err2 = (result.stderr or result.stdout or err).strip()
                raise YtDlpError(err2[-2000:])

        produced = sorted(Path(tmp).glob("section.*"))
        if not produced:
            raise YtDlpError("yt-dlp finished but produced no file.")

        src = produced[0]
        if src.suffix.lower() == ".mp4":
            shutil.copy2(src, out)
        else:
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


def _cut_from_direct_url(
    *,
    page_url: str,
    start: float,
    duration: float,
    output_path: Path,
    ff_bin: str,
) -> Path:
    """Resolve a progressive media URL with yt-dlp, then cut with ffmpeg."""
    probe = subprocess.run(
        [
            *_ytdlp_cmd_prefix(),
            "--no-playlist",
            "-f",
            "18/best[ext=mp4]/best",
            "--extractor-args",
            f"youtube:player_client={_PLAYER_CLIENTS}",
            "-g",
            page_url,
        ],
        capture_output=True,
        text=True,
    )
    if probe.returncode != 0:
        raise YtDlpError((probe.stderr or probe.stdout or "Could not resolve stream URL")[-1500:])

    lines = [ln.strip() for ln in (probe.stdout or "").splitlines() if ln.strip()]
    if not lines:
        raise YtDlpError("No stream URL from yt-dlp.")
    media_url = lines[0]

    # Input seek after -ss is slower but more accurate for remote progressive MP4.
    cut = subprocess.run(
        [
            ff_bin,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            f"{start:.3f}",
            "-i",
            media_url,
            "-t",
            f"{duration:.3f}",
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            str(output_path),
        ],
        capture_output=True,
        text=True,
    )
    if cut.returncode != 0 or not output_path.exists() or output_path.stat().st_size < 1000:
        # Re-encode if stream copy fails (odd timestamps / keyframes).
        cut = subprocess.run(
            [
                ff_bin,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-ss",
                f"{start:.3f}",
                "-i",
                media_url,
                "-t",
                f"{duration:.3f}",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-crf",
                "23",
                "-c:a",
                "aac",
                "-movflags",
                "+faststart",
                str(output_path),
            ],
            capture_output=True,
            text=True,
        )
        if cut.returncode != 0 or not output_path.exists():
            raise YtDlpError(cut.stderr[-1500:] or "ffmpeg cut from stream URL failed")
    return output_path


def _download_fallback(
    *,
    url: str,
    section: str,
    tmp_base: Path,
    ff_dir: str | None,
) -> subprocess.CompletedProcess:
    """Looser second attempt — android progressive, then cut."""
    cmd = [
        *_ytdlp_cmd_prefix(),
        "--no-playlist",
        "--force-keyframes-at-cuts",
        "--download-sections",
        section,
        "-f",
        "18/best",
        "--merge-output-format",
        "mp4",
        "--extractor-args",
        "youtube:player_client=android",
        "-o",
        str(tmp_base) + ".%(ext)s",
        "--newline",
        url,
    ]
    if ff_dir:
        cmd.extend(["--ffmpeg-location", ff_dir])
    return subprocess.run(cmd, capture_output=True, text=True)


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
