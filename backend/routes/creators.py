from __future__ import annotations

import threading

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from backend.config import settings
from backend.database.database import SessionLocal, get_db
from backend.database import models
from backend.services.auth_deps import AuthContext, get_current_user
from backend.services.pipeline import import_creator_videos, scan_creator, scan_video
from backend.services.serializers import creator_to_dict, video_to_dict
from backend.services.youtube import YouTubeAPIError, api_configured, get_channel, resolve_channel

router = APIRouter(prefix="/api/creators", tags=["creators"])


class AddCreatorBody(BaseModel):
    url: str | None = None
    youtube_channel_id: str | None = None
    auto_scan: bool | None = None


def _counts(db: Session, creator_id: int) -> tuple[int, int]:
    videos = db.query(models.Video).filter_by(creator_id=creator_id).count()
    moments = (
        db.query(models.Moment)
        .join(models.Video)
        .filter(models.Video.creator_id == creator_id)
        .count()
    )
    return videos, moments


def _run_scan_creator_async(creator_id: int) -> None:
    def worker():
        db = SessionLocal()
        try:
            scan_creator(db, creator_id)
        except Exception:
            pass
        finally:
            db.close()

    threading.Thread(target=worker, daemon=True).start()


@router.get("")
def list_creators(
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_user),
):
    user = auth.sql_user
    links = db.query(models.UserCreator).filter_by(user_id=user.id).all()
    result = []
    for link in links:
        creator = db.get(models.Creator, link.creator_id)
        if not creator:
            continue
        vc, mc = _counts(db, creator.id)
        result.append(creator_to_dict(creator, video_count=vc, moment_count=mc))
    return {"creators": result}


@router.get("/{creator_id}")
def get_creator(creator_id: int, db: Session = Depends(get_db)):
    creator = db.get(models.Creator, creator_id)
    if not creator:
        raise HTTPException(404, "Creator not found")
    vc, mc = _counts(db, creator.id)
    return creator_to_dict(creator, video_count=vc, moment_count=mc)


@router.post("")
def add_creator(
    body: AddCreatorBody,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_user),
):
    if not api_configured():
        raise HTTPException(
            400,
            "YOUTUBE_API_KEY is not set. Add it to .env and restart, then try again.",
        )

    user = auth.sql_user
    try:
        if body.youtube_channel_id:
            info = get_channel(body.youtube_channel_id.strip())
        elif body.url:
            info = resolve_channel(body.url)
        else:
            raise HTTPException(400, "Provide a channel URL or youtube_channel_id.")
    except YouTubeAPIError as exc:
        raise HTTPException(400, str(exc)) from exc

    creator = db.query(models.Creator).filter_by(youtube_channel_id=info["youtube_channel_id"]).first()
    if not creator:
        creator = models.Creator(**info, is_demo=0)
        db.add(creator)
        db.flush()
    else:
        for key, value in info.items():
            setattr(creator, key, value)

    link = (
        db.query(models.UserCreator)
        .filter_by(user_id=user.id, creator_id=creator.id)
        .first()
    )
    if not link:
        db.add(models.UserCreator(user_id=user.id, creator_id=creator.id))

    # Persist creator immediately so a later video-import timeout doesn't lose the follow.
    db.commit()
    db.refresh(creator)

    import_error = None
    added_videos = 0
    try:
        added_videos = import_creator_videos(db, creator)
        db.commit()
    except YouTubeAPIError as exc:
        db.rollback()
        import_error = str(exc)
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        import_error = f"Video import failed: {exc}"

    db.refresh(creator)
    video_rows = (
        db.query(models.Video)
        .filter_by(creator_id=creator.id, is_demo=0)
        .order_by(models.Video.published_at.desc())
        .all()
    )
    video_ids = [v.id for v in video_rows]

    from backend.config import IS_VERCEL

    should_scan = settings.auto_scan_on_add if body.auto_scan is None else body.auto_scan
    scan_started = False
    if should_scan and video_ids and not IS_VERCEL:
        _run_scan_creator_async(creator.id)
        scan_started = True

    vc, mc = _counts(db, creator.id)
    if import_error and not video_ids:
        message = f"Creator saved, but videos didn’t import yet: {import_error}"
    elif import_error:
        message = f"Creator saved with {len(video_ids)} videos. Partial import: {import_error}"
    elif video_ids:
        message = "Creator added. Videos will scan in the background as you browse…"
    else:
        message = "Creator added. Importing videos next…"

    return {
        "message": message,
        "creator": creator_to_dict(creator, video_count=vc, moment_count=mc),
        "videos_imported": added_videos,
        "video_ids": video_ids,
        "scan_started": scan_started,
        "client_should_scan": bool(video_ids),
        "import_error": import_error,
        "ok": True,
    }


@router.delete("/{creator_id}")
def remove_creator(
    creator_id: int,
    db: Session = Depends(get_db),
    auth: AuthContext = Depends(get_current_user),
):
    user = auth.sql_user
    link = (
        db.query(models.UserCreator)
        .filter_by(user_id=user.id, creator_id=creator_id)
        .first()
    )
    if not link:
        raise HTTPException(404, "Creator not followed")
    db.delete(link)
    db.commit()
    return {"ok": True}


@router.get("/{creator_id}/videos")
def creator_videos(
    creator_id: int,
    exclude_shorts: bool = Query(True),
    db: Session = Depends(get_db),
):
    from backend.services.video_filters import is_youtube_short

    creator = db.get(models.Creator, creator_id)
    if not creator:
        raise HTTPException(404, "Creator not found")
    videos = (
        db.query(models.Video)
        .options(joinedload(models.Video.creator), joinedload(models.Video.source_media))
        .filter_by(creator_id=creator_id)
        .order_by(models.Video.published_at.desc())
        .all()
    )
    items = []
    shorts_hidden = 0
    for video in videos:
        if exclude_shorts and is_youtube_short(video.duration_seconds, video.title):
            shorts_hidden += 1
            continue
        moments = db.query(models.Moment).filter_by(video_id=video.id).all()
        high = sum(1 for m in moments if m.score >= 80)
        items.append(video_to_dict(video, moment_count=len(moments), high_confidence=high))
    return {"videos": items, "shorts_hidden": shorts_hidden, "exclude_shorts": exclude_shorts}


@router.post("/{creator_id}/scan")
def scan_creator_route(creator_id: int, db: Session = Depends(get_db)):
    creator = db.get(models.Creator, creator_id)
    if not creator:
        raise HTTPException(404, "Creator not found")
    if creator.is_demo:
        return {"message": "Demo creators are pre-scanned.", "status": "SCANNED", "creator_id": creator_id}
    if not api_configured():
        raise HTTPException(400, "YOUTUBE_API_KEY is not set.")

    # Mark unscanned long-form videos as scanning for UI feedback
    videos = (
        db.query(models.Video)
        .filter_by(creator_id=creator_id, is_demo=0)
        .filter(models.Video.scan_status.in_(["NOT_SCANNED", "FAILED"]))
        .all()
    )
    from backend.services.video_filters import is_youtube_short

    for video in videos:
        if is_youtube_short(video.duration_seconds, video.title):
            continue
        video.scan_status = "SCANNING"
    db.commit()
    _run_scan_creator_async(creator_id)
    return {
        "message": "Scan started in the background.",
        "status": "SCANNING",
        "creator_id": creator_id,
    }


@router.post("/{creator_id}/refresh")
def refresh_creator_videos(creator_id: int, db: Session = Depends(get_db)):
    creator = db.get(models.Creator, creator_id)
    if not creator:
        raise HTTPException(404, "Creator not found")
    if not api_configured():
        raise HTTPException(400, "YOUTUBE_API_KEY is not set.")
    try:
        info = resolve_channel(f"https://youtube.com/channel/{creator.youtube_channel_id}")
        for key, value in info.items():
            setattr(creator, key, value)
        added = import_creator_videos(db, creator)
        db.commit()
    except YouTubeAPIError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"message": f"Imported {added} new videos.", "videos_imported": added}
