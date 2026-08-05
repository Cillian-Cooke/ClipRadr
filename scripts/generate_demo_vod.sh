#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/media/demo/demo-vod.mp4"
cd "$ROOT"

mkdir -p "$(dirname "$OUT")"

if [[ -x "$ROOT/.venv/bin/python" ]]; then
  PY="$ROOT/.venv/bin/python"
else
  PY=python3
fi

"$PY" - <<'PY'
from pathlib import Path
import subprocess
import shutil

out = Path("media/demo/demo-vod.mp4")
ffmpeg = shutil.which("ffmpeg")
if not ffmpeg:
    import imageio_ffmpeg
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()

cmd = [
    ffmpeg, "-y",
    "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30:duration=90",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=90",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "28",
    "-c:a", "aac", "-shortest", str(out),
]
subprocess.check_call(cmd)
print(f"Wrote {out.resolve()} ({out.stat().st_size} bytes)")
PY
