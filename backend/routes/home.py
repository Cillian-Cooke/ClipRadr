from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pathlib import Path
from sqlalchemy.orm import Session, joinedload

from backend.database.database import get_db
from backend.database import models
from backend.services.serializers import moment_to_dict

router = APIRouter(prefix="/api", tags=["home"])


@router.get("/home")
def home_stats(db: Session = Depends(get_db)):
    creators = db.query(models.Creator).filter_by(is_demo=0).count()
    videos = db.query(models.Video).filter_by(is_demo=0).count()
    moments = (
        db.query(models.Moment)
        .join(models.Video)
        .filter(models.Video.is_demo == 0)
        .count()
    )
    exports = db.query(models.ExportJob).filter_by(status="COMPLETED").count()
    saved = db.query(models.SavedClip).count()

    top = (
        db.query(models.Moment)
        .join(models.Video)
        .options(joinedload(models.Moment.video).joinedload(models.Video.creator))
        .filter(models.Video.is_demo == 0)
        .order_by(models.Moment.score.desc())
        .limit(8)
        .all()
    )
    top_items = []
    for m in top:
        item = moment_to_dict(m, include_video=True)
        comments = (
            db.query(models.Comment)
            .join(models.MomentComment)
            .filter(models.MomentComment.moment_id == m.id)
            .order_by(models.Comment.like_count.desc())
            .limit(1)
            .all()
        )
        item["top_comment"] = comments[0].text if comments else None
        top_items.append(item)

    hour = __import__("datetime").datetime.now().hour
    greeting = "Good morning" if hour < 12 else "Good afternoon" if hour < 18 else "Good evening"

    if moments:
        headline = f"Your creators have {moments} potential clips waiting."
    elif creators:
        headline = "Scan a video to find audience-backed clip moments."
    else:
        headline = "Add a creator to start building your clip queue."

    return {
        "greeting": greeting,
        "headline": headline,
        "stats": {
            "creators_followed": creators,
            "videos_scanned": videos,
            "clip_moments_found": moments,
            "clips_exported": exports,
            "saved_clips": saved,
        },
        "top_opportunities": top_items,
    }


@router.get("/opportunities")
def opportunities(
    status: str | None = None,
    creator_id: int | None = None,
    topic: str | None = None,
    sort: str = Query("score"),
    db: Session = Depends(get_db),
):
    q = db.query(models.Moment).options(
        joinedload(models.Moment.video).joinedload(models.Video.creator)
    ).join(models.Video).filter(models.Video.is_demo == 0)
    if creator_id:
        q = q.filter(models.Video.creator_id == creator_id)
    if topic:
        q = q.filter(models.Moment.topic.ilike(f"%{topic}%"))
    if status == "HIGH":
        q = q.filter(models.Moment.score >= 80)
    elif status == "UNREVIEWED":
        q = q.filter(models.Moment.status == "NEW")
    elif status == "SAVED":
        q = q.filter(models.Moment.status == "SAVED")
    elif status == "EXPORTED":
        q = q.filter(models.Moment.status == "EXPORTED")

    if sort == "newest":
        q = q.order_by(models.Moment.created_at.desc())
    elif sort == "comments":
        q = q.order_by(models.Moment.unique_commenters.desc())
    elif sort == "longest":
        q = q.order_by((models.Moment.end_seconds - models.Moment.start_seconds).desc())
    elif sort == "shortest":
        q = q.order_by((models.Moment.end_seconds - models.Moment.start_seconds).asc())
    else:
        q = q.order_by(models.Moment.score.desc())

    moments = q.limit(100).all()
    items = []
    for m in moments:
        item = moment_to_dict(m, include_video=True)
        top = (
            db.query(models.Comment)
            .join(models.MomentComment)
            .filter(models.MomentComment.moment_id == m.id)
            .order_by(models.Comment.like_count.desc())
            .first()
        )
        item["top_comment"] = top.text if top else None
        items.append(item)
    return {"moments": items}


@router.get("/media/source/{source_id}")
def stream_source(source_id: int, db: Session = Depends(get_db)):
    source = db.get(models.SourceMedia, source_id)
    if not source:
        raise HTTPException(404, "Source media not found")
    path = Path(source.path)
    if not path.exists():
        raise HTTPException(
            404,
            "Demo VOD file missing. Run ./scripts/generate_demo_vod.sh",
        )
    return FileResponse(path, media_type="video/mp4", filename=path.name)
