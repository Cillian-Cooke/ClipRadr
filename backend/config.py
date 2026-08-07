from __future__ import annotations

import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT_DIR = Path(__file__).resolve().parent.parent

# Vercel serverless: filesystem is read-only except /tmp
IS_VERCEL = os.getenv("VERCEL") == "1"
_RUNTIME_DIR = Path("/tmp/clipradr") if IS_VERCEL else ROOT_DIR
_DEFAULT_DB = f"sqlite:///{_RUNTIME_DIR / 'data' / 'clipradr.db'}"
_DEFAULT_STORAGE = str(_RUNTIME_DIR / "media")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ROOT_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    youtube_api_key: str = ""
    database_url: str = _DEFAULT_DB
    openai_api_key: str = ""
    storage_path: str = _DEFAULT_STORAGE
    demo_mode: bool = False
    cluster_window_seconds: int = 10
    cluster_radius_seconds: int = 5
    max_cluster_span_seconds: int = 15
    pre_roll_seconds: int = 5
    post_roll_seconds: int = 10
    similarity_threshold: float = 0.78
    # Keep serverless requests short — scan videos one-at-a-time from the UI
    max_comments_per_video: int = 200 if IS_VERCEL else 1000
    recent_videos_limit: int = 10 if IS_VERCEL else 20
    auto_scan_on_add: bool = True

    # Firebase (optional until credentials are provided)
    firebase_project_id: str = ""
    firebase_credentials_path: str = ""
    firebase_credentials_json: str = ""  # raw JSON string alternative to path
    firebase_web_api_key: str = ""
    firebase_auth_domain: str = ""
    firebase_storage_bucket: str = ""
    firebase_messaging_sender_id: str = ""
    firebase_app_id: str = ""
    # When Firebase is unset, allow demo-user bypass so local work continues
    dev_auth_bypass: bool = True
    free_exports_per_day: int = 3


settings = Settings()


def database_is_durable() -> bool:
    """True when not using ephemeral Vercel /tmp SQLite."""
    url = (settings.database_url or "").strip().lower()
    if (
        url.startswith("postgresql://")
        or url.startswith("postgres://")
        or url.startswith("postgresql+psycopg://")
    ):
        return True
    if IS_VERCEL:
        # Any sqlite on Vercel is treated as ephemeral (even if path isn't /tmp)
        return False
    return True


def database_backend() -> str:
    url = (settings.database_url or "").strip().lower()
    if (
        url.startswith("postgresql://")
        or url.startswith("postgres://")
        or url.startswith("postgresql+psycopg://")
    ):
        return "postgres"
    if url.startswith("sqlite"):
        return "sqlite"
    return "unknown"
