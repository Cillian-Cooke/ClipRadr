from __future__ import annotations

from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import NullPool

from backend.config import settings


def _ensure_sqlite_parent(url: str) -> None:
    if not url.startswith("sqlite:///"):
        return
    raw = url.removeprefix("sqlite:///")
    path = Path(raw)
    if not path.is_absolute():
        path = Path.cwd() / path
    path.parent.mkdir(parents=True, exist_ok=True)


def _normalize_database_url(url: str) -> str:
    # Neon / Vercel often provide postgres:// — SQLAlchemy wants postgresql://
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]

    # Prefer psycopg v3 driver (requirements: psycopg[binary])
    if url.startswith("postgresql://") and not url.startswith("postgresql+"):
        url = "postgresql+psycopg://" + url[len("postgresql://") :]

    if not (url.startswith("postgresql") or url.startswith("sqlite")):
        return url

    if not url.startswith("postgresql"):
        return url

    # Ensure TLS for Neon / hosted Postgres when sslmode is omitted
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    if "sslmode" not in query:
        query["sslmode"] = "require"
    return urlunparse(parsed._replace(query=urlencode(query)))


db_url = _normalize_database_url(settings.database_url)
_ensure_sqlite_parent(db_url)

is_sqlite = db_url.startswith("sqlite")
is_postgres = db_url.startswith("postgresql")

connect_args = {"check_same_thread": False} if is_sqlite else {}

engine_kwargs: dict = {
    "connect_args": connect_args,
    "pool_pre_ping": True,
}
# Serverless (Vercel) + Neon: avoid holding pooled connections across invocations
if is_postgres:
    engine_kwargs["poolclass"] = NullPool

engine = create_engine(db_url, **engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
