from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.config import IS_VERCEL
from backend.database.database import SessionLocal, get_db
from backend.database import models
from backend.services.auth_deps import AuthContext, get_current_user, require_export_quota
from backend.services.exports import create_export_job, start_export_async
from backend.services.ffmpeg import ASPECT_PRESETS, ffmpeg_available
from backend.services.serializers import fmt_ts
from backend.services.ytdlp import ytdlp_available

router = APIRouter(prefix="/api/export", tags=["export"])


class ExportBody(BaseModel):
    video_id: int
    moment_id: int | None = None
    saved_clip_id: int | None = None
    start_seconds: float
    end_seconds: float
    aspect_ratio: str = "16:9"
    width: int | None = None
    height: int | None = None
    crop_position: str = "CENTER"
    # 360 | 480 | 720 | 1080 — preferred over width/height for YouTube clips
    quality: int | None = None


QUALITY_PRESETS = {
    360: (640, 360),
    480: (854, 480),
    720: (1280, 720),
    1080: (1920, 1080),
}


def _job_dict(job: models.ExportJob) -> dict:
    return {
        "id": job.id,
        "status": job.status,
        "progress": job.progress,
        "start_seconds": job.start_seconds,
        "end_seconds": job.end_seconds,
        "start_label": fmt_ts(job.start_seconds),
        "end_label": fmt_ts(job.end_seconds),
        "duration_seconds": round(job.end_seconds - job.start_seconds, 1),
        "aspect_ratio": job.aspect_ratio,
        "width": job.width,
        "height": job.height,
        "crop_position": job.crop_position,
        "output_path": job.output_path,
        "download_url": f"/api/export/{job.id}/download" if job.status == "COMPLETED" else None,
        "error": job.error,
        "ffmpeg_available": ffmpeg_available(),
        "ytdlp_available": ytdlp_available(),
        "created_at": job.created_at.isoformat() if job.created_at else None,
    }


@router.post("")
def create_export(
    body: ExportBody,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_user),
):
    if IS_VERCEL:
        raise HTTPException(
            400,
            "Clip export runs on the local app (or a dedicated worker), not Vercel serverless. "
            "Start ClipRadr locally to download MP4 clips.",
        )

    require_export_quota(db, auth)

    video = db.get(models.Video, body.video_id)
    if not video:
        raise HTTPException(404, "Video not found")

    source = (
        db.query(models.SourceMedia)
        .filter_by(video_id=video.id)
        .first()
    )
    if not source and not video.youtube_video_id:
        raise HTTPException(
            400,
            "No local source media and no YouTube id on this video — cannot export.",
        )
    if not source and not ytdlp_available():
        raise HTTPException(
            400,
            "No local source media. Install yt-dlp (`pip install yt-dlp`) to auto-fetch the clip range.",
        )
    if not ffmpeg_available():
        raise HTTPException(400, "ffmpeg is not available for encoding.")

    w, h = ASPECT_PRESETS.get(body.aspect_ratio, (1920, 1080))
    if body.quality:
        q = int(body.quality)
        # Snap to nearest supported rung
        if q not in QUALITY_PRESETS:
            q = min(QUALITY_PRESETS.keys(), key=lambda x: abs(x - q))
        w, h = QUALITY_PRESETS[q]
    elif body.width and body.height:
        w, h = body.width, body.height

    job = create_export_job(
        db,
        user_id=auth.sql_user.id,
        video_id=video.id,
        source_media_id=source.id if source else None,
        start_seconds=body.start_seconds,
        end_seconds=body.end_seconds,
        aspect_ratio=body.aspect_ratio,
        width=w,
        height=h,
        crop_position=body.crop_position,
        saved_clip_id=body.saved_clip_id,
    )

    try:
        from backend.services.firestore_sync import mirror_export_job

        mirror_export_job(db, job.id, auth=auth, youtube_video_id=video.youtube_video_id)
    except Exception:
        pass

    start_export_async(SessionLocal, job.id)
    db.refresh(job)
    return _job_dict(job)


@router.get("")
def list_exports(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_user),
):
    jobs = (
        db.query(models.ExportJob)
        .filter_by(user_id=auth.sql_user.id)
        .order_by(models.ExportJob.created_at.desc())
        .limit(50)
        .all()
    )
    return {"exports": [_job_dict(j) for j in jobs]}


@router.get("/{job_id}")
def get_export(
    job_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_user),
):
    job = db.get(models.ExportJob, job_id)
    if not job or job.user_id != auth.sql_user.id:
        raise HTTPException(404, "Export job not found")
    return _job_dict(job)


@router.get("/{job_id}/download")
def download_export(
    job_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_user),
):
    job = db.get(models.ExportJob, job_id)
    if not job or job.user_id != auth.sql_user.id or job.status != "COMPLETED" or not job.output_path:
        raise HTTPException(404, "Export not ready")
    path = Path(job.output_path)
    if not path.exists():
        raise HTTPException(404, "Export file missing")
    return FileResponse(path, media_type="video/mp4", filename=path.name)
