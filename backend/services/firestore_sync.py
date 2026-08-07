"""Firestore mirrors for users, subscriptions, and finished exports."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from backend.database import models
from backend.services.firebase_app import firebase_ready, get_firestore_client


def _db():
    return get_firestore_client()


def ensure_user_docs(uid: str, *, email: str = "", name: str = "", plan: str | None = None) -> None:
    if not firebase_ready() or not uid:
        return
    db = _db()
    user_ref = db.collection("users").document(uid)
    snap = user_ref.get()
    now = datetime.utcnow().isoformat() + "Z"
    if not snap.exists:
        user_ref.set(
            {
                "email": email,
                "name": name,
                "plan": plan or "free",
                "createdAt": now,
                "updatedAt": now,
            }
        )
    else:
        patch: dict[str, Any] = {"updatedAt": now}
        if email:
            patch["email"] = email
        if name:
            patch["name"] = name
        user_ref.set(patch, merge=True)

    sub_ref = db.collection("subscriptions").document(uid)
    if not sub_ref.get().exists:
        sub_ref.set(
            {
                "plan": plan or (snap.to_dict() or {}).get("plan", "free") if snap.exists else "free",
                "status": "active",
                "updatedAt": now,
            }
        )


def get_user_plan(uid: str) -> str:
    if not firebase_ready() or not uid:
        return "free"
    db = _db()
    sub = db.collection("subscriptions").document(uid).get()
    if sub.exists:
        plan = (sub.to_dict() or {}).get("plan")
        if plan in ("free", "pro"):
            return plan
    user = db.collection("users").document(uid).get()
    if user.exists:
        plan = (user.to_dict() or {}).get("plan")
        if plan in ("free", "pro"):
            return plan
    return "free"


def mirror_export_job(
    db: Session,
    job_id: int,
    *,
    auth=None,
    youtube_video_id: str | None = None,
) -> None:
    if not firebase_ready():
        return
    job = db.get(models.ExportJob, job_id)
    if not job:
        return

    uid = None
    if auth and getattr(auth, "firebase_uid", None):
        uid = auth.firebase_uid
    else:
        user = db.get(models.User, job.user_id)
        uid = user.firebase_uid if user else None
    if not uid:
        return

    video = db.get(models.Video, job.video_id) if job.video_id else None
    yt_id = youtube_video_id or (video.youtube_video_id if video else None)

    payload = {
        "uid": uid,
        "sqlJobId": job.id,
        "videoId": job.video_id,
        "youtubeVideoId": yt_id,
        "startSeconds": job.start_seconds,
        "endSeconds": job.end_seconds,
        "status": job.status,
        "progress": job.progress,
        "error": job.error,
        "downloadPath": job.output_path,
        "downloadUrl": f"/api/export/{job.id}/download" if job.status == "COMPLETED" else None,
        "aspectRatio": job.aspect_ratio,
        "width": job.width,
        "height": job.height,
        "updatedAt": datetime.utcnow().isoformat() + "Z",
        "createdAt": job.created_at.isoformat() + "Z" if job.created_at else datetime.utcnow().isoformat() + "Z",
    }

    fs = _db()
    doc_id = f"job_{job.id}"
    fs.collection("exports").document(doc_id).set(payload, merge=True)
    # Convenience: finished list under user
    fs.collection("users").document(uid).collection("finishedExports").document(doc_id).set(
        payload, merge=True
    )


def list_finished_exports(uid: str, limit: int = 40) -> list[dict]:
    if not firebase_ready() or not uid:
        return []
    fs = _db()
    docs = (
        fs.collection("users")
        .document(uid)
        .collection("finishedExports")
        .order_by("createdAt", direction="DESCENDING")
        .limit(limit)
        .stream()
    )
    return [d.to_dict() | {"id": d.id} for d in docs]
