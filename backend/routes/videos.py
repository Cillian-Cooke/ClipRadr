from __future__ import annotations

import threading

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from backend.config import IS_VERCEL
from backend.database.database import SessionLocal, get_db
from backend.database import models
from backend.services.pipeline import scan_video
from backend.services.serializers import comment_to_dict, moment_to_dict, video_to_dict
from backend.services.youtube import YouTubeAPIError, api_configured

router = APIRouter(prefix="/api", tags=["videos"])


def _run_scan_video_async(video_id: int) -> None:
    import threading

    def worker():
        db = SessionLocal()
        try:
            scan_video(db, video_id)
        except Exception:
            video = db.get(models.Video, video_id)
            if video and video.scan_status == "SCANNING":
                video.scan_status = "FAILED"
                db.commit()
        finally:
            db.close()

    threading.Thread(target=worker, daemon=True).start()


@router.get("/videos/{video_id}")
def get_video(video_id: int, db: Session = Depends(get_db)):
    video = (
        db.query(models.Video)
        .options(
            joinedload(models.Video.creator),
            joinedload(models.Video.source_media),
        )
        .filter_by(id=video_id)
        .first()
    )
    if not video:
        raise HTTPException(404, "Video not found")
    moments = db.query(models.Moment).filter_by(video_id=video.id).all()
    high = sum(1 for m in moments if m.score >= 80)
    data = video_to_dict(video, moment_count=len(moments), high_confidence=high)
    source = video.source_media[0] if video.source_media else None
    data["source_media"] = (
        {
            "id": source.id,
            "path": source.path,
            "storage_type": source.storage_type,
            "duration_seconds": source.duration_seconds,
            "stream_url": f"/api/media/source/{source.id}",
        }
        if source
        else None
    )
    data["embed_video_id"] = None if video.media_mode == "demo" else video.youtube_video_id
    data["playback_mode"] = "local" if video.media_mode == "demo" and source else "youtube"
    return data


@router.get("/videos/{video_id}/moments")
def video_moments(video_id: int, db: Session = Depends(get_db)):
    video = db.get(models.Video, video_id)
    if not video:
        raise HTTPException(404, "Video not found")
    moments = (
        db.query(models.Moment)
        .filter_by(video_id=video_id)
        .order_by(models.Moment.score.desc())
        .all()
    )
    return {"moments": [moment_to_dict(m) for m in moments]}


@router.get("/videos/{video_id}/comments")
def video_comments(video_id: int, db: Session = Depends(get_db)):
    video = db.get(models.Video, video_id)
    if not video:
        raise HTTPException(404, "Video not found")
    comments = (
        db.query(models.Comment)
        .options(joinedload(models.Comment.timestamps))
        .filter_by(video_id=video_id)
        .order_by(models.Comment.like_count.desc())
        .all()
    )
    return {"comments": [comment_to_dict(c) for c in comments]}


@router.post("/videos/{video_id}/scan")
def scan_video_route(
    video_id: int,
    sync: bool = Query(False),
    db: Session = Depends(get_db),
):
    video = db.get(models.Video, video_id)
    if not video:
        raise HTTPException(404, "Video not found")
    if video.is_demo:
        return {
            "message": "Demo video already scanned.",
            "status": "SCANNED",
            "moments": db.query(models.Moment).filter_by(video_id=video.id).count(),
        }
    if not api_configured():
        raise HTTPException(400, "YOUTUBE_API_KEY is not set. Add it to .env and restart.")

    # Vercel kills background threads — run in-request when sync or on Vercel.
    run_sync = sync or IS_VERCEL
    if run_sync:
        try:
            result = scan_video(db, video_id)
        except YouTubeAPIError as exc:
            raise HTTPException(400, str(exc)) from exc
        except Exception as exc:
            video.scan_status = "FAILED"
            db.commit()
            raise HTTPException(500, f"Scan failed: {exc}") from exc
        return {
            "message": "Scan complete.",
            "status": result.get("status", "SCANNED"),
            "video_id": video_id,
            "moments": result.get("moments", 0),
            "comments": result.get("comments", 0),
        }

    video.scan_status = "SCANNING"
    db.commit()
    _run_scan_video_async(video_id)
    return {
        "message": "Scan started. Moments will appear when comment analysis finishes.",
        "status": "SCANNING",
        "video_id": video_id,
    }
