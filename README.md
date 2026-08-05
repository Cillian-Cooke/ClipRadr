# ClipRadar

> Turn the audience's timestamps and reactions into an editor-ready clip queue — so editors can go from a four-hour VOD to the exact moments worth cutting in seconds.

ClipRadar is an editor workstation for YouTube creators' long-form VODs. It organizes recent videos, clusters audience timestamp comments into clip moments, and exports real MP4 clips via FFmpeg from authorized/demo source media.

## Quick start

```bash
cd ~/Projects/ClipRadar
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env

# Generate local demo VOD (~90s synthetic file)
./scripts/generate_demo_vod.sh

# Run API + frontend
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

Open [http://localhost:8000](http://localhost:8000) → **Open Workspace** → Creators → **4 HOURS OF CHAOS** → click a timeline marker.

## Demo path (2 minutes)

1. Home — creators have moments waiting  
2. Open ChaosCraft → **4 HOURS OF CHAOS**  
3. Timeline markers → select a moment → jump + audience comments  
4. Drag IN/OUT handles → **Preview clip**  
5. **Export MP4** → download the cut  

## Architecture

| Layer | Stack |
|---|---|
| Frontend | HTML / CSS / vanilla JS (componentized) |
| Backend | FastAPI + SQLite |
| Clipping | FFmpeg (`imageio-ffmpeg` bundled if system ffmpeg missing) |
| YouTube | Data API for discovery/comments only (optional key) |

**Media honesty:** YouTube embeds are for discovery/navigation. Clip rendering always uses authorized/demo source media under `media/`.

## Credentials (live YouTube)

1. Create a [Google Cloud API key](https://console.cloud.google.com/) with **YouTube Data API v3** enabled.
2. Copy `.env.example` → `.env` and set:

```bash
YOUTUBE_API_KEY=your_key_here
AUTO_SCAN_ON_ADD=true
```

3. Restart the server.
4. Open **Settings** to confirm “YouTube Data API → Connected”.
5. **Creators → Add Creator** → paste `youtube.com/@handle`.
6. Videos import immediately; comment scanning runs in the background.
7. Open a video → timeline moments appear when the scan finishes. Use **Scan** / **Rescan** on a video card if needed.

Clip export still uses local/authorized source media (demo VOD or uploaded file) — the YouTube API is for discovery + comments only.
