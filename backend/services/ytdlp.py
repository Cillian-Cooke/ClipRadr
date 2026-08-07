"""YouTube clip-range download via yt-dlp (local only) — optimized for speed."""

from __future__ import annotations

import atexit
import base64
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from backend.config import settings
from backend.services.ffmpeg import FFmpegError, export_clip, ffmpeg_binary, remux_faststart

_cookies_tmp: Path | None = None


class YtDlpError(RuntimeError):
    pass


def _normalize_netscape_cookies(raw: str) -> str:
    """
    Build a Netscape cookies file yt-dlp will accept.

    Railway Variable pastes often turn tabs into spaces or smash lines — recover
    what we can, and always include the required header.
    """
    text = (raw or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        return ""

    # Some UIs escape newlines as literal \n
    if "\\n" in text and text.count("\n") < 3:
        text = text.replace("\\n", "\n").replace("\\t", "\t")

    lines_out: list[str] = ["# Netscape HTTP Cookie File"]
    for line in text.split("\n"):
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        # Prefer real tabs; if spaces were substituted, collapse runs into tabs
        # for typical 7-field Netscape rows.
        if "\t" in s:
            parts = s.split("\t")
        else:
            parts = re.split(r"[ ]{2,}|\t+", s)
            if len(parts) < 7:
                parts = s.split()
        if len(parts) < 7:
            continue
        # domain, flag, path, secure, expiry, name, value(+rest)
        domain, flag, path, secure, expiry, name = parts[:6]
        value = "\t".join(parts[6:]) if len(parts) > 7 else parts[6]
        if not domain or not name:
            continue
        lines_out.append("\t".join([domain, flag, path, secure, expiry, name, value]))

    if len(lines_out) <= 1:
        raise YtDlpError(
            "YouTube cookies are invalid/corrupted (not Netscape format). "
            "On Railway, do not paste the raw file — run: "
            "base64 -w0 secrets/youtube-cookies.txt "
            "and set YTDLP_COOKIES_B64 to that single line, then remove YTDLP_COOKIES."
        )
    return "\n".join(lines_out) + "\n"


def _cookies_raw_from_settings() -> str:
    b64 = (settings.ytdlp_cookies_b64 or "").strip()
    if b64:
        try:
            return base64.b64decode(b64, validate=False).decode("utf-8", errors="replace")
        except Exception as exc:
            raise YtDlpError(f"YTDLP_COOKIES_B64 is not valid base64: {exc}") from exc
    return (settings.ytdlp_cookies or "").strip()


def _cookies_file() -> Path | None:
    """Resolve Netscape cookies for yt-dlp (path, B64, or raw env contents)."""
    global _cookies_tmp
    path = (settings.ytdlp_cookies_path or "").strip()
    if path:
        p = Path(path).expanduser()
        if p.is_file():
            return p

    raw = _cookies_raw_from_settings()
    if not raw:
        return None
    if _cookies_tmp and _cookies_tmp.is_file():
        return _cookies_tmp

    normalized = _normalize_netscape_cookies(raw)
    fd, name = tempfile.mkstemp(prefix="clipradr_yt_cookies_", suffix=".txt")
    try:
        os.write(fd, normalized.encode("utf-8"))
    finally:
        os.close(fd)
    _cookies_tmp = Path(name)

    def _cleanup() -> None:
        if _cookies_tmp:
            _cookies_tmp.unlink(missing_ok=True)

    atexit.register(_cleanup)
    return _cookies_tmp


def _cookie_args() -> list[str]:
    cookies = _cookies_file()
    return ["--cookies", str(cookies)] if cookies else []


def _friendly_ytdlp_error(stderr: str) -> str:
    text = (stderr or "").strip()
    low = text.lower()
    if "does not look like a netscape format cookies file" in low or "invalid length" in low:
        return (
            "YouTube cookies were corrupted in Railway Variables (tabs/newlines got mangled). "
            "Delete YTDLP_COOKIES, then set YTDLP_COOKIES_B64 to the output of: "
            "base64 -w0 secrets/youtube-cookies.txt"
        )
    if "Sign in to confirm you’re not a bot" in text or "not a bot" in low:
        return (
            "YouTube blocked this download (bot check). On Railway set YTDLP_COOKIES_B64 "
            "(base64 of a Netscape cookies.txt from a logged-in browser). "
            "See https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies"
        )
    return text[-2000:] if text else "yt-dlp failed"


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

    Bundled builds may not be named `ffmpeg`, so expose a stable symlink dir.
    """
    ff = ffmpeg_binary()
    if not ff:
        return None
    path = Path(ff)
    if path.name == "ffmpeg":
        return str(path.parent)
    link_dir = Path(tempfile.gettempdir()) / "clipradr_ffmpeg_bin"
    link_dir.mkdir(parents=True, exist_ok=True)
    link = link_dir / "ffmpeg"
    try:
        if link.exists() or link.is_symlink():
            link.unlink()
        link.symlink_to(path.resolve())
    except OSError:
        return str(path.parent)
    return str(link_dir)


# Prefer H.264 MP4 up to max_height; avoid format 18 (360p) as a silent downgrade.
def _format_selector(max_height: int = 720) -> str:
    h = max(144, int(max_height or 720))
    return (
        f"bv*[height<={h}][vcodec^=avc1]+ba/"
        f"bv*[height<={h}][ext=mp4]+ba/"
        f"bv*[height<={h}]+ba/"
        f"b[height<={h}]/"
        f"bv*+ba/b"
    )


def _progressive_selector(max_height: int = 720) -> str:
    """Single-file fallback that still respects the requested height."""
    h = max(144, int(max_height or 720))
    return f"b[height<={h}]/best[height<={h}]/best"


# android_vr still returns real https URLs; android/web are often SABR-only.
# Avoid `tv` — frequently DRM'd. Avoid plain `web` — SABR-only.
_PLAYER_CLIENTS = "android_vr,android"


def download_clip_section(
    *,
    youtube_video_id: str,
    start_seconds: float,
    end_seconds: float,
    output_path: str | Path,
    max_height: int = 720,
) -> Path:
    """Download only [start, end] from YouTube into output_path (mp4 preferred)."""
    start = max(0.0, float(start_seconds))
    end = max(start + 0.5, float(end_seconds))
    duration = max(0.5, end - start)
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    height = max(144, int(max_height or 720))

    url = f"https://www.youtube.com/watch?v={youtube_video_id}"
    ff_bin = ffmpeg_binary()
    if not ff_bin:
        raise YtDlpError(
            "ffmpeg is required for clip export. Install static-ffmpeg or system ffmpeg."
        )

    ff_dir = _ffmpeg_location_dir()
    errors: list[str] = []
    fmt = _format_selector(height)

    # 1) Preferred: yt-dlp section download with android_vr (https DASH/progressive).
    try:
        return _download_with_sections(
            url=url,
            start=start,
            end=end,
            output_path=out,
            ff_dir=ff_dir,
            clients=_PLAYER_CLIENTS,
            fmt=fmt,
            max_height=height,
        )
    except YtDlpError as exc:
        errors.append(str(exc))

    # 2) Resolve a progressive/DASH URL and cut with a non-imageio ffmpeg.
    try:
        return _cut_from_direct_url(
            page_url=url,
            start=start,
            duration=duration,
            output_path=out,
            ff_bin=ff_bin,
            clients="android_vr",
            max_height=height,
        )
    except YtDlpError as exc:
        errors.append(str(exc))

    # 3) Last resort: download progressive format fully, then cut locally.
    try:
        return _download_full_then_cut(
            url=url,
            start=start,
            duration=duration,
            output_path=out,
            ff_bin=ff_bin,
            ff_dir=ff_dir,
            max_height=height,
        )
    except YtDlpError as exc:
        errors.append(str(exc))

    raise YtDlpError(" | ".join(e for e in errors if e)[-2000:] or "YouTube clip download failed")


def _download_with_sections(
    *,
    url: str,
    start: float,
    end: float,
    output_path: Path,
    ff_dir: str | None,
    clients: str,
    fmt: str,
    max_height: int = 720,
) -> Path:
    section = f"*{start:.3f}-{end:.3f}"
    with tempfile.TemporaryDirectory(prefix="clipradr_yt_") as tmp:
        tmp_base = Path(tmp) / "section"
        cmd = [
            *_ytdlp_cmd_prefix(),
            "--no-playlist",
            *_cookie_args(),
            "--force-keyframes-at-cuts",
            "--download-sections",
            section,
            "-f",
            fmt,
            "--merge-output-format",
            "mp4",
            "--extractor-args",
            f"youtube:player_client={clients}",
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
            err = (result.stderr or result.stdout or "yt-dlp section download failed").strip()
            # Retry with progressive stream at the same height — never force format 18 (360p).
            cmd_retry = [
                *_ytdlp_cmd_prefix(),
                "--no-playlist",
                *_cookie_args(),
                "--force-keyframes-at-cuts",
                "--download-sections",
                section,
                "-f",
                _progressive_selector(max_height),
                "--merge-output-format",
                "mp4",
                "--extractor-args",
                "youtube:player_client=android_vr",
                "-o",
                str(tmp_base) + ".%(ext)s",
                "--newline",
                url,
            ]
            if ff_dir:
                cmd_retry.extend(["--ffmpeg-location", ff_dir])
            result = subprocess.run(cmd_retry, capture_output=True, text=True)
            if result.returncode != 0:
                err2 = (result.stderr or result.stdout or err).strip()
                raise YtDlpError(_friendly_ytdlp_error(err2))

        produced = sorted(Path(tmp).glob("section.*"))
        if not produced:
            raise YtDlpError("yt-dlp finished but produced no file.")

        src = produced[0]
        ff_bin = ffmpeg_binary()
        if src.suffix.lower() == ".mp4":
            shutil.copy2(src, output_path)
        elif ff_bin:
            remux = subprocess.run(
                [ff_bin, "-y", "-i", str(src), "-c", "copy", "-movflags", "+faststart", str(output_path)],
                capture_output=True,
                text=True,
            )
            if remux.returncode != 0 or not output_path.exists():
                raise YtDlpError(remux.stderr[-1500:] or "Remux failed")
        else:
            raise YtDlpError("Downloaded non-mp4 section and ffmpeg is unavailable.")

    if not output_path.exists() or output_path.stat().st_size < 1000:
        raise YtDlpError("Clip file missing or empty after section download.")
    return output_path


def _cut_from_direct_url(
    *,
    page_url: str,
    start: float,
    duration: float,
    output_path: Path,
    ff_bin: str,
    clients: str = "android_vr",
    max_height: int = 720,
) -> Path:
    """Resolve a media URL with yt-dlp, then cut with ffmpeg."""
    probe = subprocess.run(
        [
            *_ytdlp_cmd_prefix(),
            "--no-playlist",
            *_cookie_args(),
            "-f",
            _format_selector(max_height),
            "--extractor-args",
            f"youtube:player_client={clients}",
            "-g",
            page_url,
        ],
        capture_output=True,
        text=True,
    )
    if probe.returncode != 0:
        raise YtDlpError(
            _friendly_ytdlp_error(probe.stderr or probe.stdout or "Could not resolve stream URL")
        )

    lines = [ln.strip() for ln in (probe.stdout or "").splitlines() if ln.strip()]
    if not lines:
        raise YtDlpError("No stream URL from yt-dlp.")
    # When DASH is selected, -g may return video then audio URL. Prefer first (video)
    # for stream-copy cuts; re-encode path below still works for progressive.
    media_url = lines[0]

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


def _download_full_then_cut(
    *,
    url: str,
    start: float,
    duration: float,
    output_path: Path,
    ff_bin: str,
    ff_dir: str | None,
    max_height: int = 720,
) -> Path:
    """Download selected quality (no remote ffmpeg), then cut locally."""
    with tempfile.TemporaryDirectory(prefix="clipradr_yt_full_") as tmp:
        tmp_base = Path(tmp) / "full"
        cmd = [
            *_ytdlp_cmd_prefix(),
            "--no-playlist",
            *_cookie_args(),
            "-f",
            _format_selector(max_height),
            "--merge-output-format",
            "mp4",
            "--extractor-args",
            "youtube:player_client=android_vr,android",
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
            raise YtDlpError(
                _friendly_ytdlp_error(result.stderr or result.stdout or "Full download failed")
            )
        produced = sorted(Path(tmp).glob("full.*"))
        if not produced:
            raise YtDlpError("Full download produced no file.")
        src = produced[0]
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
                str(src),
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
                    str(src),
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
                raise YtDlpError(cut.stderr[-1500:] or "Local cut after full download failed")
    return output_path


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

    For standard 16:9 CENTER exports at the downloaded resolution we remux
    (+faststart). Other aspects / upscales still re-encode once.
    """
    out = Path(output_path)
    max_height = int(height or 720)
    if on_progress:
        on_progress(30)
    with tempfile.TemporaryDirectory(prefix="clipradr_yt_raw_") as tmp:
        raw = Path(tmp) / "raw.mp4"
        download_clip_section(
            youtube_video_id=youtube_video_id,
            start_seconds=start_seconds,
            end_seconds=end_seconds,
            output_path=raw,
            max_height=max_height,
        )
        if on_progress:
            on_progress(70)

        needs_crop = aspect_ratio != "16:9" or (crop_position or "CENTER").upper() != "CENTER"
        # Remux-only when we are not cropping and not forcing a larger canvas.
        # Downloaded height already matches the chosen quality.
        if not needs_crop:
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
