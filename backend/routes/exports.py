from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.database.database import SessionLocal, get_db
from backend.database import models
from backend.services.exports import create_export_job, start_export_async
from backend.services.ffmpeg import ASPECT_PRESETS, ffmpeg_available
from backend.services.serializers import fmt_ts

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


def _demo_user(db: Session) -> models.User:
    user = db.query(models.User).filter_by(email="editor@clipradar.demo").first()
    if not user:
        raise HTTPException(500, "Demo user missing")
    return user


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
        "created_at": job.created_at.isoformat() if job.created_at else None,
    }


@router.post("")
def create_export(body: ExportBody, db: Session = Depends(get_db)):
    user = _demo_user(db)
    video = db.get(models.Video, body.video_id)
    if not video:
        raise HTTPException(404, "Video not found")

    source = (
        db.query(models.SourceMedia)
        .filter_by(video_id=video.id)
        .first()
    )
    if not source:
        raise HTTPException(
            400,
            "No authorized source media for this video. "
            "Demo export works on videos with local media under /media/demo.",
        )

    w, h = ASPECT_PRESETS.get(body.aspect_ratio, (1920, 1080))
    if body.width and body.height:
        w, h = body.width, body.height

    job = create_export_job(
        db,
        user_id=user.id,
        video_id=video.id,
        source_media_id=source.id,
        start_seconds=body.start_seconds,
        end_seconds=body.end_seconds,
        aspect_ratio=body.aspect_ratio,
        width=w,
        height=h,
        crop_position=body.crop_position,
        saved_clip_id=body.saved_clip_id,
    )
    start_export_async(SessionLocal, job.id)
    db.refresh(job)
    return _job_dict(job)


@router.get("/{job_id}")
def get_export(job_id: int, db: Session = Depends(get_db)):
    job = db.get(models.ExportJob, job_id)
    if not job:
        raise HTTPException(404, "Export job not found")
    return _job_dict(job)


@router.get("/{job_id}/download")
def download_export(job_id: int, db: Session = Depends(get_db)):
    job = db.get(models.ExportJob, job_id)
    if not job or job.status != "COMPLETED" or not job.output_path:
        raise HTTPException(404, "Export not ready")
    path = Path(job.output_path)
    if not path.exists():
        raise HTTPException(404, "Export file missing")
    return FileResponse(path, media_type="video/mp4", filename=path.name)
