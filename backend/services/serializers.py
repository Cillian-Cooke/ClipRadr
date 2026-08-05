from __future__ import annotations

from backend.database import models
from backend.services.scoring import score_label


def fmt_ts(seconds: int | float) -> str:
    seconds = int(max(0, seconds))
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    if h:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def creator_to_dict(creator: models.Creator, *, video_count: int = 0, moment_count: int = 0) -> dict:
    return {
        "id": creator.id,
        "youtube_channel_id": creator.youtube_channel_id,
        "name": creator.name,
        "handle": creator.handle,
        "thumbnail_url": creator.thumbnail_url,
        "description": creator.description,
        "last_scanned_at": creator.last_scanned_at.isoformat() if creator.last_scanned_at else None,
        "video_count": video_count,
        "clip_opportunities": moment_count,
        "is_demo": bool(creator.is_demo),
    }


def video_to_dict(video: models.Video, *, moment_count: int = 0, high_confidence: int = 0) -> dict:
    return {
        "id": video.id,
        "creator_id": video.creator_id,
        "youtube_video_id": video.youtube_video_id,
        "title": video.title,
        "description": video.description,
        "thumbnail_url": video.thumbnail_url,
        "duration_seconds": video.duration_seconds,
        "duration_label": fmt_ts(video.duration_seconds),
        "published_at": video.published_at.isoformat() if video.published_at else None,
        "view_count": video.view_count,
        "comment_count": video.comment_count,
        "scanned_at": video.scanned_at.isoformat() if video.scanned_at else None,
        "scan_status": video.scan_status,
        "media_mode": video.media_mode,
        "moment_count": moment_count,
        "high_confidence_count": high_confidence,
        "has_source_media": bool(video.source_media),
        "is_demo": bool(video.is_demo),
        "creator": {
            "id": video.creator.id,
            "name": video.creator.name,
            "handle": video.creator.handle,
            "thumbnail_url": video.creator.thumbnail_url,
        }
        if video.creator
        else None,
    }


def comment_to_dict(comment: models.Comment, timestamp_seconds: int | None = None) -> dict:
    ts = timestamp_seconds
    if ts is None and comment.timestamps:
        ts = comment.timestamps[0].timestamp_seconds
    return {
        "id": comment.id,
        "author_name": comment.author_name,
        "author_avatar": comment.author_avatar,
        "text": comment.text,
        "like_count": comment.like_count,
        "published_at": comment.published_at.isoformat() if comment.published_at else None,
        "timestamp_seconds": ts,
        "timestamp_label": fmt_ts(ts) if ts is not None else None,
    }


def moment_to_dict(
    moment: models.Moment,
    *,
    comments: list[dict] | None = None,
    related: list[dict] | None = None,
    include_video: bool = False,
) -> dict:
    confidence = "high" if moment.score >= 80 else "medium" if moment.score >= 55 else "low"
    data = {
        "id": moment.id,
        "video_id": moment.video_id,
        "representative_timestamp": moment.representative_timestamp,
        "representative_label": fmt_ts(moment.representative_timestamp),
        "start_seconds": moment.start_seconds,
        "end_seconds": moment.end_seconds,
        "start_label": fmt_ts(moment.start_seconds),
        "end_label": fmt_ts(moment.end_seconds),
        "cluster_start": max(0, moment.representative_timestamp - max(0, (moment.end_seconds - moment.start_seconds) // 4)),
        "score": moment.score,
        "score_label": score_label(moment.score),
        "confidence": confidence,
        "unique_commenters": moment.unique_commenters,
        "timestamp_mentions": moment.timestamp_mentions,
        "comment_count": moment.unique_commenters,
        "topic": moment.topic,
        "status": moment.status,
        "created_at": moment.created_at.isoformat() if moment.created_at else None,
        "comments": comments or [],
        "related": related or [],
    }
    if include_video and moment.video:
        data["video"] = {
            "id": moment.video.id,
            "title": moment.video.title,
            "thumbnail_url": moment.video.thumbnail_url,
            "youtube_video_id": moment.video.youtube_video_id,
            "creator": {
                "id": moment.video.creator.id,
                "name": moment.video.creator.name,
                "handle": moment.video.creator.handle,
            }
            if moment.video.creator
            else None,
        }
    return data
