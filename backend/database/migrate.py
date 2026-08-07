"""Lightweight schema patches for existing SQLite/Postgres DBs."""

from __future__ import annotations

from sqlalchemy import inspect, text

from backend.database.database import engine


def ensure_schema_patches() -> None:
    """Add columns create_all won't alter on existing tables."""
    insp = inspect(engine)
    if "users" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("users")}
    if "firebase_uid" in cols:
        return
    dialect = engine.dialect.name
    with engine.begin() as conn:
        if dialect == "sqlite":
            conn.execute(text("ALTER TABLE users ADD COLUMN firebase_uid VARCHAR(128)"))
        else:
            conn.execute(text("ALTER TABLE users ADD COLUMN firebase_uid VARCHAR(128) UNIQUE"))
