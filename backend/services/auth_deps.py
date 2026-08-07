"""Auth dependency — Firebase ID token or local demo bypass."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from backend.config import settings
from backend.database.database import get_db
from backend.database import models
from backend.services.demo_data import ensure_workspace_user
from backend.services.firebase_app import (
    auth_required,
    firebase_ready,
    verify_id_token,
    web_config_public,
)


FREE_EXPORTS_PER_DAY = settings.free_exports_per_day


@dataclass
class AuthContext:
    sql_user: models.User
    firebase_uid: str | None
    email: str
    name: str
    plan: str  # free | pro
    bypass: bool = False


def _upsert_sql_user(db: Session, *, uid: str, email: str, name: str) -> models.User:
    user = db.query(models.User).filter_by(firebase_uid=uid).first()
    if user:
        if email and user.email != email:
            # Keep email unique — only update if free
            conflict = db.query(models.User).filter_by(email=email).first()
            if not conflict or conflict.id == user.id:
                user.email = email
        if name:
            user.name = name
        db.commit()
        db.refresh(user)
        return user

    by_email = db.query(models.User).filter_by(email=email).first() if email else None
    if by_email:
        by_email.firebase_uid = uid
        if name:
            by_email.name = name
        db.commit()
        db.refresh(by_email)
        return by_email

    user = models.User(
        email=email or f"{uid}@users.clipradar.local",
        name=name or "Editor",
        firebase_uid=uid,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _plan_for_uid(uid: str | None) -> str:
    if not uid or not firebase_ready():
        return "pro" if not auth_required() else "free"
    try:
        from backend.services.firestore_sync import get_user_plan

        return get_user_plan(uid)
    except Exception:
        return "free"


def get_current_user(
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> AuthContext:
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()

    if token and firebase_ready():
        try:
            decoded = verify_id_token(token)
        except Exception as exc:
            raise HTTPException(401, f"Invalid auth token: {exc}") from exc
        uid = decoded.get("uid") or decoded.get("user_id")
        email = decoded.get("email") or ""
        name = decoded.get("name") or email.split("@")[0] or "Editor"
        sql_user = _upsert_sql_user(db, uid=uid, email=email, name=name)
        try:
            from backend.services.firestore_sync import ensure_user_docs

            ensure_user_docs(uid, email=email, name=name)
        except Exception:
            pass
        plan = _plan_for_uid(uid)
        return AuthContext(
            sql_user=sql_user,
            firebase_uid=uid,
            email=email or sql_user.email,
            name=name or sql_user.name,
            plan=plan,
            bypass=False,
        )

    if auth_required():
        raise HTTPException(401, "Sign in required. Missing Authorization Bearer token.")

    # Dev bypass — single workspace user
    user = ensure_workspace_user(db)
    return AuthContext(
        sql_user=user,
        firebase_uid=user.firebase_uid,
        email=user.email,
        name=user.name,
        plan="pro",
        bypass=True,
    )


def require_export_quota(db: Session, auth: AuthContext) -> None:
    if auth.plan == "pro" or auth.bypass:
        return
    start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    count = (
        db.query(models.ExportJob)
        .filter(
            models.ExportJob.user_id == auth.sql_user.id,
            models.ExportJob.created_at >= start,
            models.ExportJob.status.in_(("QUEUED", "PROCESSING", "COMPLETED")),
        )
        .count()
    )
    limit = settings.free_exports_per_day
    if count >= limit:
        raise HTTPException(
            403,
            f"Free plan limit reached ({limit} exports/day). Upgrade plan in Firestore "
            f"(users/{auth.firebase_uid or 'uid'}.plan = \"pro\") or try tomorrow.",
        )


def auth_status_payload() -> dict:
    ready = firebase_ready()
    cfg = web_config_public()
    return {
        "firebase_ready": ready,
        "auth_required": auth_required(),
        "dev_auth_bypass": settings.dev_auth_bypass and not ready,
        "web_config": cfg if cfg.get("apiKey") and cfg.get("projectId") else None,
        "free_exports_per_day": settings.free_exports_per_day,
    }
