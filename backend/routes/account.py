"""Account / me / finished exports."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.database.database import get_db
from backend.database import models
from backend.services.auth_deps import AuthContext, auth_status_payload, get_current_user
from backend.services.firestore_sync import list_finished_exports
from backend.services.serializers import fmt_ts

router = APIRouter(prefix="/api/account", tags=["account"])


@router.get("/me")
def me(auth: AuthContext = Depends(get_current_user)):
    return {
        "id": auth.sql_user.id,
        "email": auth.email,
        "name": auth.name,
        "firebase_uid": auth.firebase_uid,
        "plan": auth.plan,
        "bypass": auth.bypass,
        "auth": auth_status_payload(),
    }


@router.get("/exports")
def finished_exports(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_user),
):
    # Prefer Firestore when available; always include SQL jobs for local downloads
    sql_jobs = (
        db.query(models.ExportJob)
        .filter_by(user_id=auth.sql_user.id)
        .order_by(models.ExportJob.created_at.desc())
        .limit(50)
        .all()
    )
    sql_list = [
        {
            "id": f"job_{j.id}",
            "sqlJobId": j.id,
            "videoId": j.video_id,
            "startSeconds": j.start_seconds,
            "endSeconds": j.end_seconds,
            "start_label": fmt_ts(j.start_seconds),
            "end_label": fmt_ts(j.end_seconds),
            "status": j.status,
            "progress": j.progress,
            "error": j.error,
            "downloadUrl": f"/api/export/{j.id}/download" if j.status == "COMPLETED" else None,
            "createdAt": j.created_at.isoformat() + "Z" if j.created_at else None,
            "source": "sql",
        }
        for j in sql_jobs
    ]

    fs_list = []
    if auth.firebase_uid:
        try:
            fs_list = list_finished_exports(auth.firebase_uid)
            for item in fs_list:
                item["source"] = "firestore"
        except Exception:
            fs_list = []

    # Merge by sqlJobId preferring SQL for download URLs
    by_id = {}
    for item in fs_list:
        key = item.get("sqlJobId") or item.get("id")
        by_id[key] = item
    for item in sql_list:
        by_id[item["sqlJobId"]] = item

    exports = sorted(
        by_id.values(),
        key=lambda x: x.get("createdAt") or "",
        reverse=True,
    )
    return {"exports": exports, "plan": auth.plan}
