from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.config import IS_VERCEL, ROOT_DIR, settings
from backend.database.database import Base, SessionLocal, engine
from backend.database import models  # noqa: F401
from backend.routes import account, clips, creators, exports, home, moments, search, videos, youtube_search
from backend.services.demo_data import ensure_workspace
from backend.database.migrate import ensure_schema_patches
from backend.services.auth_deps import auth_status_payload
from backend.services.ytdlp import ytdlp_available


FRONTEND = ROOT_DIR / "frontend"
STATIC = FRONTEND / "static"


def create_app() -> FastAPI:
    app = FastAPI(title="ClipRadar", version="0.1.0")

    Base.metadata.create_all(bind=engine)
    ensure_schema_patches()
    db = SessionLocal()
    try:
        ensure_workspace(db)
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
    app.include_router(account.router)

    @app.middleware("http")
    async def prefer_localhost_host(request, call_next):
        """One origin only — 127.0.0.1 and localhost do not share Firebase/localStorage."""
        host = (request.headers.get("host") or "").split(":")[0].strip().lower()
        if host == "127.0.0.1":
            from fastapi.responses import RedirectResponse

            host_header = request.headers.get("host") or "localhost"
            port_part = ""
            if ":" in host_header:
                port_part = ":" + host_header.split(":", 1)[1]
            target = f"http://localhost{port_part}{request.url.path}"
            if request.url.query:
                target += f"?{request.url.query}"
            return RedirectResponse(url=target, status_code=307)
        return await call_next(request)

    @app.middleware("http")
    async def no_cache_frontend_assets(request, call_next):
        """Avoid stale ES modules (entry cache-bust alone does not refresh imports)."""
        response = await call_next(request)
        path = request.url.path
        if path.startswith(("/js/", "/css/")) or path in ("/", "/login", "/index.html", "/login.html"):
            response.headers["Cache-Control"] = "no-store, max-age=0"
            response.headers["Pragma"] = "no-cache"
        return response

    if STATIC.exists():
        app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")
    app.mount("/css", StaticFiles(directory=str(FRONTEND / "css")), name="css")
    app.mount("/js", StaticFiles(directory=str(FRONTEND / "js")), name="js")

    vendor_firebase = ROOT_DIR / "node_modules" / "firebase"
    if vendor_firebase.exists():
        app.mount(
            "/vendor/firebase",
            StaticFiles(directory=str(vendor_firebase)),
            name="vendor_firebase",
        )

    @app.get("/api/health")
    def health():
        return {
            "ok": True,
            "demo_mode": settings.demo_mode,
            "app": "ClipRadar",
        }

    @app.get("/api/status")
    def status(check_youtube: bool = False):
        from backend.config import database_backend, database_is_durable
        from backend.services.ffmpeg import ffmpeg_available
        from backend.services.youtube import api_configured, probe_api_key

        configured = api_configured()
        yt_ok = configured
        yt_error = None
        durable = database_is_durable()
        backend = database_backend()

        # Live probe only when explicitly requested (Settings) — keeps Add/Search snappy.
        if check_youtube and configured:
            yt_probe = probe_api_key()
            yt_ok = bool(yt_probe.get("valid"))
            yt_error = yt_probe.get("error")

        if IS_VERCEL and not durable:
            hint = (
                "Vercel needs a durable DATABASE_URL (Neon Postgres). "
                "Without it, creators disappear on every cold start. "
                "Add DATABASE_URL in Vercel → Settings → Environment Variables, then redeploy."
            )
        elif not configured:
            hint = (
                "Set YOUTUBE_API_KEY in Vercel → Project Settings → Environment Variables, then redeploy."
                if IS_VERCEL
                else "Set YOUTUBE_API_KEY in .env and restart to enable live creators."
            )
        elif check_youtube and not yt_ok:
            hint = yt_error or "YouTube API key is set but invalid."
        else:
            hint = "YouTube API connected. Add a creator to import + scan."

        return {
            "app": "ClipRadar",
            "demo_mode": settings.demo_mode,
            "credentials": {
                "youtube_api_key": configured,
                "youtube_api_valid": yt_ok if check_youtube else configured,
                "youtube_api_error": yt_error,
                "openai_api_key": bool(settings.openai_api_key and settings.openai_api_key.strip()),
                "database_durable": durable,
                "database_backend": backend,
            },
            "capabilities": {
                "add_live_creators": configured,
                "scan_comments": configured,
                "export_clips": ffmpeg_available(),
                "export_youtube_clips": ffmpeg_available() and ytdlp_available() and not IS_VERCEL,
                "ytdlp": ytdlp_available(),
                "semantic_embeddings": "local",
                "persistent_workspace": durable,
            },
            "auth": auth_status_payload(),
            "limits": {
                "max_comments_per_video": settings.max_comments_per_video,
                "recent_videos_limit": settings.recent_videos_limit,
                "cluster_window_seconds": settings.cluster_window_seconds,
                "auto_scan_on_add": settings.auto_scan_on_add,
                "free_exports_per_day": settings.free_exports_per_day,
            },
            "setup": {
                "env_file": "Vercel project env" if IS_VERCEL else str(ROOT_DIR / ".env"),
                "platform": "vercel" if IS_VERCEL else "local",
                "hint": hint,
            },
        }

    @app.get("/")
    def index():
        # Always serve the SPA — it shows a loading state while Firebase
        # restores the session, so we never flash the login form on tab focus.
        return FileResponse(FRONTEND / "index.html", media_type="text/html")

    @app.get("/login")
    def login_page():
        # Same SPA shell; client route renders the sign-in UI only after
        # auth has confirmed there is no session.
        return FileResponse(FRONTEND / "index.html", media_type="text/html")

    # SPA-style fallback for client routes
    @app.get("/{full_path:path}")
    def spa(full_path: str):
        # Don't swallow API or static mounts
        if full_path.startswith(("api/", "static/", "css/", "js/", "vendor/")):
            return {"detail": "Not Found"}
        file_path = FRONTEND / full_path
        if full_path and file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(FRONTEND / "index.html", media_type="text/html")

    return app


app = create_app()
