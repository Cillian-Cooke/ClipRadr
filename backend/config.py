from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ROOT_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    youtube_api_key: str = ""
    database_url: str = f"sqlite:///{ROOT_DIR / 'data' / 'clipradar.db'}"
    openai_api_key: str = ""
    storage_path: str = str(ROOT_DIR / "media")
    demo_mode: bool = True
    cluster_window_seconds: int = 10
    cluster_radius_seconds: int = 5
    max_cluster_span_seconds: int = 15
    pre_roll_seconds: int = 10
    post_roll_seconds: int = 10
    similarity_threshold: float = 0.78
    max_comments_per_video: int = 1000
    recent_videos_limit: int = 20
    auto_scan_on_add: bool = True


settings = Settings()
