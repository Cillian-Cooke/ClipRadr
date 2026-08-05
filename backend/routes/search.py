from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload

from backend.database.database import get_db
from backend.database import models
from backend.services.serializers import creator_to_dict, moment_to_dict, video_to_dict
from backend.services.youtube import YouTubeAPIError, api_configured, search_channels

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("")
def search(
    q: str = Query("", min_length=1),
    include_youtube: bool = Query(False),
    db: Session = Depends(get_db),
):
    query = q.strip()
    like = f"%{query}%"

    creators = (
        db.query(models.Creator)
        .filter(
            (models.Creator.name.ilike(like))
            | (models.Creator.handle.ilike(like))
            | (models.Creator.description.ilike(like))
        )
        .limit(10)
        .all()
    )
    videos = (
        db.query(models.Video)
        .options(joinedload(models.Video.creator))
        .filter(
            (models.Video.title.ilike(like))
            | (models.Video.description.ilike(like))
        )
        .limit(10)
        .all()
    )
    moments = (
        db.query(models.Moment)
        .options(joinedload(models.Moment.video).joinedload(models.Video.creator))
        .filter(models.Moment.topic.ilike(like))
        .order_by(models.Moment.score.desc())
        .limit(20)
        .all()
    )

    if len(moments) < 10:
        comment_hits = (
            db.query(models.Comment)
            .filter(models.Comment.text.ilike(like))
            .limit(50)
            .all()
        )
        moment_ids = {m.id for m in moments}
        for comment in comment_hits:
            links = db.query(models.MomentComment).filter_by(comment_id=comment.id).all()
            for link in links:
                if link.moment_id in moment_ids:
                    continue
                moment = (
                    db.query(models.Moment)
                    .options(joinedload(models.Moment.video).joinedload(models.Video.creator))
                    .filter_by(id=link.moment_id)
                    .first()
                )
                if moment:
                    moments.append(moment)
                    moment_ids.add(moment.id)
                if len(moments) >= 20:
                    break

    youtube_channels = []
    if include_youtube and api_configured():
        try:
            youtube_channels = search_channels(query, max_results=6)
        except YouTubeAPIError:
            youtube_channels = []

    return {
        "query": query,
        "creators": [creator_to_dict(c) for c in creators],
        "videos": [video_to_dict(v) for v in videos],
        "moments": [moment_to_dict(m, include_video=True) for m in moments],
        "youtube_channels": youtube_channels,
    }
