"""Firebase Admin initialization (lazy). Safe when credentials are missing."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from backend.config import ROOT_DIR, settings

_app = None
_init_error: str | None = None


def firebase_configured() -> bool:
    if settings.firebase_credentials_json.strip():
        return True
    path = (settings.firebase_credentials_path or "").strip()
    if path:
        p = Path(path)
        if not p.is_absolute():
            p = ROOT_DIR / p
        return p.exists()
    return bool(settings.firebase_project_id.strip() and Path("/var/task").exists())


def firebase_ready() -> bool:
    """True when Admin SDK initialized successfully."""
    if not firebase_configured():
        return False
    try:
        get_firebase_app()
        return True
    except Exception:
        return False


def firebase_init_error() -> str | None:
    get_firebase_app()
    return _init_error


@lru_cache(maxsize=1)
def get_firebase_app():
    global _app, _init_error
    if _app is not None:
        return _app

    try:
        import firebase_admin
        from firebase_admin import credentials
    except ImportError as exc:
        _init_error = "firebase-admin is not installed"
        raise RuntimeError(_init_error) from exc

    if firebase_admin._apps:
        _app = firebase_admin.get_app()
        return _app

    cred = None
    raw = settings.firebase_credentials_json.strip()
    if raw:
        cred = credentials.Certificate(json.loads(raw))
    else:
        path = (settings.firebase_credentials_path or "").strip()
        if path:
            p = Path(path)
            if not p.is_absolute():
                p = ROOT_DIR / p
            if p.exists():
                cred = credentials.Certificate(str(p))

    if cred is None:
        _init_error = (
            "Firebase credentials not configured. "
            "Set FIREBASE_CREDENTIALS_PATH or FIREBASE_CREDENTIALS_JSON in .env."
        )
        raise RuntimeError(_init_error)

    opts: dict[str, Any] = {}
    if settings.firebase_project_id.strip():
        opts["projectId"] = settings.firebase_project_id.strip()

    _app = firebase_admin.initialize_app(cred, opts or None)
    _init_error = None
    return _app


def verify_id_token(token: str) -> dict[str, Any]:
    get_firebase_app()
    from firebase_admin import auth

    return auth.verify_id_token(token)


def get_firestore_client():
    get_firebase_app()
    from firebase_admin import firestore

    return firestore.client()


def web_config_public() -> dict[str, str]:
    """Browser-safe Firebase web config (no service account)."""
    project = settings.firebase_project_id.strip()
    api_key = settings.firebase_web_api_key.strip()
    auth_domain = settings.firebase_auth_domain.strip() or (f"{project}.firebaseapp.com" if project else "")
    return {
        "apiKey": api_key,
        "authDomain": auth_domain,
        "projectId": project,
        "storageBucket": settings.firebase_storage_bucket.strip()
        or (f"{project}.appspot.com" if project else ""),
        "messagingSenderId": settings.firebase_messaging_sender_id.strip(),
        "appId": settings.firebase_app_id.strip(),
    }


def auth_required() -> bool:
    """Require login when Firebase Admin is ready and bypass is off."""
    if settings.dev_auth_bypass:
        return False
    return firebase_ready()
