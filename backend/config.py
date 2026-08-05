from __future__ import annotations

import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT_DIR = Path(__file__).resolve().parent.parent

# Vercel serverless: filesystem is read-only except /tmp
IS_VERCEL = os.getenv("VERCEL") == "1"
_RUNTIME_DIR = Path("/tmp/clipradar") if IS_VERCEL else ROOT_DIR
_DEFAULT_DB = f"sqlite:///{_RUNTIME_DIR / 'data' / 'clipradar.db'}"
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
    pre_roll_seconds: int = 10
    post_roll_seconds: int = 10
    similarity_threshold: float = 0.78
    # Keep serverless requests short — scan videos one-at-a-time from the UI
    max_comments_per_video: int = 200 if IS_VERCEL else 1000
    recent_videos_limit: int = 8 if IS_VERCEL else 20
    auto_scan_on_add: bool = False if IS_VERCEL else True


settings = Settings()
