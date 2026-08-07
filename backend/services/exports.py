"""Export job orchestration — local SourceMedia or YouTube section via yt-dlp."""

from __future__ import annotations

import threading
import uuid

from sqlalchemy.orm import Session

from backend.database import models
from backend.services.ffmpeg import export_clip, exports_dir, ffmpeg_available
from backend.services.ytdlp import YtDlpError, export_youtube_clip, ytdlp_available


def create_export_job(
    db: Session,
    *,
    user_id: int,
    video_id: int | None,
    source_media_id: int | None,
    start_seconds: float,
    end_seconds: float,
    aspect_ratio: str,
    width: int,
    height: int,
    crop_position: str,
    saved_clip_id: int | None = None,
) -> models.ExportJob:
    job = models.ExportJob(
        user_id=user_id,
        video_id=video_id,
        saved_clip_id=saved_clip_id,
        source_media_id=source_media_id,
        start_seconds=start_seconds,
        end_seconds=end_seconds,
        aspect_ratio=aspect_ratio,
        width=width,
        height=height,
        crop_position=crop_position,
        status="QUEUED",
        progress=0,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def run_export_job(db: Session, job_id: int) -> models.ExportJob:
    job = db.get(models.ExportJob, job_id)
    if not job:
        raise ValueError("Export job not found")

    if not ffmpeg_available():
        job.status = "FAILED"
        job.error = "ffmpeg is not installed. Install ffmpeg to enable real clip exports."
        job.progress = 0
        db.commit()
        return job

    source = None
    if job.source_media_id:
        source = db.get(models.SourceMedia, job.source_media_id)
    if source is None and job.video_id:
        source = (
            db.query(models.SourceMedia)
            .filter(models.SourceMedia.video_id == job.video_id)
            .first()
        )

    video = db.get(models.Video, job.video_id) if job.video_id else None
    youtube_id = video.youtube_video_id if video else None

    if source is None and not youtube_id:
        job.status = "FAILED"
        job.error = "No local source media and no YouTube video id — cannot export."
        db.commit()
        return job

    if source is None and not ytdlp_available():
        job.status = "FAILED"
        job.error = (
            "No local source media. Install yt-dlp (`pip install yt-dlp`) "
            "to auto-download the clip range from YouTube."
        )
        db.commit()
        return job

    job.status = "PROCESSING"
    job.progress = 10
    db.commit()

    out_name = f"clip_{job.id}_{uuid.uuid4().hex[:8]}.mp4"
    out_path = exports_dir() / out_name

    try:
        if source is not None:
            job.progress = 35
            db.commit()
            needs_crop = (
                job.aspect_ratio != "16:9"
                or (job.crop_position or "CENTER").upper() != "CENTER"
            )
            if not needs_crop and job.width in (None, 1920) and job.height in (None, 1080):
                # Stream-copy is near-instant when no crop/rescale is required.
                try:
                    export_clip(
                        source_path=source.path,
                        output_path=out_path,
                        start_seconds=job.start_seconds,
                        end_seconds=job.end_seconds,
                        aspect_ratio=job.aspect_ratio,
                        width=job.width,
                        height=job.height,
                        crop_position=job.crop_position,
                        stream_copy=True,
                    )
                except Exception:
                    export_clip(
                        source_path=source.path,
                        output_path=out_path,
                        start_seconds=job.start_seconds,
                        end_seconds=job.end_seconds,
                        aspect_ratio=job.aspect_ratio,
                        width=job.width,
                        height=job.height,
                        crop_position=job.crop_position,
                        fast=True,
                    )
            else:
                export_clip(
                    source_path=source.path,
                    output_path=out_path,
                    start_seconds=job.start_seconds,
                    end_seconds=job.end_seconds,
                    aspect_ratio=job.aspect_ratio,
                    width=job.width,
                    height=job.height,
                    crop_position=job.crop_position,
                    fast=True,
                )
        else:
            def _progress(pct: int) -> None:
                job.progress = max(job.progress or 0, int(pct))
                db.commit()

            export_youtube_clip(
                youtube_video_id=youtube_id,
                output_path=out_path,
                start_seconds=job.start_seconds,
                end_seconds=job.end_seconds,
                aspect_ratio=job.aspect_ratio,
                width=job.width,
                height=job.height,
                crop_position=job.crop_position,
                on_progress=_progress,
            )

        job.status = "COMPLETED"
        job.progress = 100
        job.output_path = str(out_path)
        job.error = None
    except (YtDlpError, Exception) as exc:  # noqa: BLE001
        job.status = "FAILED"
        job.error = str(exc)
        job.progress = 0

    db.commit()
    db.refresh(job)
    return job


def start_export_async(session_factory, job_id: int) -> None:
    def _worker():
        db = session_factory()
        try:
            run_export_job(db, job_id)
            # Best-effort Firestore mirror (imported lazily to avoid circular deps)
            try:
                from backend.services.firestore_sync import mirror_export_job

                mirror_export_job(db, job_id)
            except Exception:
                pass
        finally:
            db.close()

    thread = threading.Thread(target=_worker, daemon=True)
    thread.start()
