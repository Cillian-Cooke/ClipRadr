from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.config import ROOT_DIR, settings
from backend.database.database import Base, SessionLocal, engine
from backend.database import models  # noqa: F401
from backend.routes import clips, creators, exports, home, moments, search, videos, youtube_search
from backend.services.demo_data import seed_demo_data

FRONTEND = ROOT_DIR / "frontend"
STATIC = FRONTEND / "static"


def create_app() -> FastAPI:
    app = FastAPI(title="ClipRadar", version="0.1.0")

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_demo_data(db)
    finally:
        db.close()

    app.include_router(home.router)
    app.include_router(creators.router)
    app.include_router(videos.router)
    app.include_router(moments.router)
    app.include_router(clips.router)
    app.include_router(exports.router)
    app.include_router(search.router)
    app.include_router(youtube_search.router)

    if STATIC.exists():
        app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")
    app.mount("/css", StaticFiles(directory=str(FRONTEND / "css")), name="css")
    app.mount("/js", StaticFiles(directory=str(FRONTEND / "js")), name="js")

    @app.get("/api/health")
    def health():
        return {
            "ok": True,
            "demo_mode": settings.demo_mode,
            "app": "ClipRadar",
        }

    @app.get("/api/status")
    def status():
        from backend.services.ffmpeg import ffmpeg_available
        from backend.services.youtube import api_configured

        return {
            "app": "ClipRadar",
            "demo_mode": settings.demo_mode,
            "credentials": {
                "youtube_api_key": api_configured(),
                "openai_api_key": bool(settings.openai_api_key and settings.openai_api_key.strip()),
            },
            "capabilities": {
                "add_live_creators": api_configured(),
                "scan_comments": api_configured(),
                "export_clips": ffmpeg_available(),
                "semantic_embeddings": "local",  # OpenAI optional later
            },
            "limits": {
                "max_comments_per_video": settings.max_comments_per_video,
                "recent_videos_limit": settings.recent_videos_limit,
                "cluster_window_seconds": settings.cluster_window_seconds,
                "auto_scan_on_add": settings.auto_scan_on_add,
            },
            "setup": {
                "env_file": str(ROOT_DIR / ".env"),
                "hint": (
                    "Set YOUTUBE_API_KEY in .env and restart to enable live creators."
                    if not api_configured()
                    else "YouTube API connected. Add a creator URL to import + scan."
                ),
            },
        }

    @app.get("/")
    def index():
        return FileResponse(FRONTEND / "index.html", media_type="text/html")

    # SPA-style fallback for client routes
    @app.get("/{full_path:path}")
    def spa(full_path: str):
        # Don't swallow API or static mounts
        if full_path.startswith(("api/", "static/", "css/", "js/")):
            return {"detail": "Not Found"}
        file_path = FRONTEND / full_path
        if full_path and file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(FRONTEND / "index.html", media_type="text/html")

    return app


app = create_app()
