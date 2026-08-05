"""Live YouTube → moments processing pipeline."""

from __future__ import annotations

import json
import logging
from datetime import datetime

from sqlalchemy.orm import Session, joinedload

from backend.config import settings
from backend.database import models
from backend.services.embeddings import (
    cosine_similarity,
    infer_topic,
    relationship_label,
    simple_embedding,
)
from backend.services.moments import TimestampMention, cluster_timestamps, suggested_clip_bounds
from backend.services.scoring import score_cluster
from backend.services.timestamps import extract_timestamps
from backend.services.youtube import YouTubeAPIError, get_video_comments

logger = logging.getLogger(__name__)


def parse_yt_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def clear_video_moments(db: Session, video: models.Video) -> None:
    """Remove previous scan products so rescans are clean."""
    moments = db.query(models.Moment).filter_by(video_id=video.id).all()
    moment_ids = [m.id for m in moments]
    if moment_ids:
        db.query(models.MomentRelation).filter(
            (models.MomentRelation.moment_a_id.in_(moment_ids))
            | (models.MomentRelation.moment_b_id.in_(moment_ids))
        ).delete(synchronize_session=False)
        db.query(models.MomentEmbedding).filter(
            models.MomentEmbedding.moment_id.in_(moment_ids)
        ).delete(synchronize_session=False)
        db.query(models.MomentComment).filter(
            models.MomentComment.moment_id.in_(moment_ids)
        ).delete(synchronize_session=False)
        db.query(models.Moment).filter(models.Moment.id.in_(moment_ids)).delete(
            synchronize_session=False
        )

    comments = db.query(models.Comment).filter_by(video_id=video.id).all()
    comment_ids = [c.id for c in comments]
    if comment_ids:
        db.query(models.CommentTimestamp).filter(
            models.CommentTimestamp.comment_id.in_(comment_ids)
        ).delete(synchronize_session=False)
        db.query(models.Comment).filter(models.Comment.id.in_(comment_ids)).delete(
            synchronize_session=False
        )
    db.flush()


def scan_video(db: Session, video_id: int, *, force: bool = False) -> dict:
    """
    Fetch comments for a video, parse timestamps, cluster, score, embed, relate.
    Safe to call repeatedly; replaces prior scan results for that video.
    """
    video = (
        db.query(models.Video)
        .options(joinedload(models.Video.creator))
        .filter_by(id=video_id)
        .first()
    )
    if not video:
        raise ValueError("Video not found")

    if video.is_demo and not force:
        return {
            "video_id": video.id,
            "status": "SCANNED",
            "message": "Demo video already scanned.",
            "moments": db.query(models.Moment).filter_by(video_id=video.id).count(),
            "comments": video.comment_count,
        }

    if not settings.youtube_api_key:
        raise YouTubeAPIError(
            "YOUTUBE_API_KEY is not set. Add it to .env to scan live videos."
        )

    video.scan_status = "SCANNING"
    db.commit()

    try:
        raw_comments = get_video_comments(
            video.youtube_video_id,
            max_comments=settings.max_comments_per_video,
        )
    except YouTubeAPIError as exc:
        video.scan_status = "FAILED"
        db.commit()
        raise YouTubeAPIError(str(exc)) from exc

    clear_video_moments(db, video)

    mentions: list[TimestampMention] = []
    for idx, raw in enumerate(raw_comments):
        comment = models.Comment(
            video_id=video.id,
            youtube_comment_id=raw.get("youtube_comment_id") or f"{video.youtube_video_id}_{idx}",
            author_name=raw.get("author_name") or "Unknown",
            author_avatar=raw.get("author_avatar"),
            text=raw.get("text") or "",
            like_count=int(raw.get("like_count") or 0),
            published_at=parse_yt_datetime(raw.get("published_at")),
        )
        db.add(comment)
        db.flush()

        for parsed in extract_timestamps(comment.text):
            # Drop timestamps past video duration (+ small slack)
            if video.duration_seconds and parsed.timestamp_seconds > video.duration_seconds + 30:
                continue
            db.add(
                models.CommentTimestamp(
                    comment_id=comment.id,
                    timestamp_seconds=parsed.timestamp_seconds,
                    original_timestamp=parsed.original_timestamp,
                    confidence=parsed.confidence,
                )
            )
            mentions.append(
                TimestampMention(
                    timestamp_seconds=parsed.timestamp_seconds,
                    comment_id=comment.id,
                    author=comment.author_name,
                    text=comment.text,
                    likes=comment.like_count,
                    original_timestamp=parsed.original_timestamp,
                    confidence=parsed.confidence,
                )
            )

    clusters = cluster_timestamps(
        mentions,
        radius_seconds=settings.cluster_radius_seconds,
        max_span_seconds=settings.max_cluster_span_seconds,
        cluster_window_seconds=settings.cluster_window_seconds,
    )

    created_moments: list[models.Moment] = []
    for cluster in clusters:
        if video.duration_seconds and cluster.start_seconds > video.duration_seconds:
            continue
        if video.duration_seconds:
            cluster.end_seconds = min(cluster.end_seconds, video.duration_seconds)
            cluster.start_seconds = min(cluster.start_seconds, video.duration_seconds)

        texts = [m.text for m in cluster.mentions]
        topic = infer_topic(texts + [video.title or ""])
        score = score_cluster(cluster)
        start, end = suggested_clip_bounds(
            cluster,
            video_duration=video.duration_seconds or max(cluster.end_seconds + 30, 1),
            pre_roll=settings.pre_roll_seconds,
            post_roll=settings.post_roll_seconds,
        )

        moment = models.Moment(
            video_id=video.id,
            representative_timestamp=cluster.representative_timestamp,
            start_seconds=start,
            end_seconds=end,
            score=score,
            unique_commenters=cluster.unique_commenters,
            timestamp_mentions=len(cluster.mentions),
            topic=topic,
            status="NEW",
        )
        db.add(moment)
        db.flush()

        linked = {m.comment_id for m in cluster.mentions if m.comment_id}
        for cid in linked:
            db.add(models.MomentComment(moment_id=moment.id, comment_id=cid))

        emb_text = (
            f"{video.title}. Moment at {cluster.representative_timestamp}. "
            + " ".join(texts[:6])
        )
        emb = simple_embedding(emb_text)
        db.add(models.MomentEmbedding(moment_id=moment.id, embedding=json.dumps(emb)))
        created_moments.append(moment)

    _link_similar_moments(db, created_moments)

    video.comment_count = len(raw_comments)
    video.scanned_at = datetime.utcnow()
    video.scan_status = "SCANNED"
    if video.creator:
        video.creator.last_scanned_at = datetime.utcnow()
    db.commit()

    return {
        "video_id": video.id,
        "status": "SCANNED",
        "comments": len(raw_comments),
        "timestamp_mentions": len(mentions),
        "moments": len(created_moments),
        "message": f"Found {len(created_moments)} moments from {len(raw_comments)} comments.",
    }


def _link_similar_moments(db: Session, new_moments: list[models.Moment]) -> None:
    if not new_moments:
        return
    threshold = settings.similarity_threshold
    existing = (
        db.query(models.Moment)
        .join(models.MomentEmbedding)
        .filter(models.Moment.id.notin_([m.id for m in new_moments]))
        .all()
    )
    candidates = list(new_moments) + existing

    embeddings: dict[int, list[float]] = {}
    for m in candidates:
        row = db.query(models.MomentEmbedding).filter_by(moment_id=m.id).first()
        if row:
            embeddings[m.id] = json.loads(row.embedding)

    for i, a in enumerate(new_moments):
        if a.id not in embeddings:
            continue
        # Compare against other new moments + existing
        others = [m for m in candidates if m.id != a.id]
        for b in others:
            if b.id not in embeddings:
                continue
            if a.video_id == b.video_id:
                continue
            # Only create relation once (smaller id first)
            left, right = sorted([a.id, b.id])
            exists = (
                db.query(models.MomentRelation)
                .filter_by(moment_a_id=left, moment_b_id=right)
                .first()
            )
            if exists:
                continue
            sim = cosine_similarity(embeddings[a.id], embeddings[b.id])
            if a.topic and a.topic == b.topic and a.topic != "MOMENT":
                sim = min(1.0, sim + 0.08)
            if sim >= threshold:
                db.add(
                    models.MomentRelation(
                        moment_a_id=left,
                        moment_b_id=right,
                        similarity=round(sim, 4),
                        relationship_type=relationship_label(sim),
                    )
                )


def scan_creator(db: Session, creator_id: int, *, max_videos: int | None = None) -> dict:
    creator = db.get(models.Creator, creator_id)
    if not creator:
        raise ValueError("Creator not found")

    limit = max_videos or settings.recent_videos_limit
    videos = (
        db.query(models.Video)
        .filter_by(creator_id=creator_id)
        .order_by(models.Video.published_at.desc())
        .limit(limit)
        .all()
    )

    results = []
    errors = []
    for video in videos:
        if video.is_demo:
            results.append({"video_id": video.id, "status": "SKIPPED_DEMO"})
            continue
        try:
            results.append(scan_video(db, video.id))
        except Exception as exc:  # noqa: BLE001
            logger.exception("Scan failed for video %s", video.id)
            errors.append({"video_id": video.id, "error": str(exc)})
            video.scan_status = "FAILED"
            db.commit()

    creator.last_scanned_at = datetime.utcnow()
    db.commit()
    return {
        "creator_id": creator_id,
        "scanned": len([r for r in results if r.get("status") == "SCANNED"]),
        "failed": len(errors),
        "results": results,
        "errors": errors,
        "message": f"Scanned {len(results)} videos ({len(errors)} failed).",
    }


def import_creator_videos(db: Session, creator: models.Creator) -> int:
    """Pull latest uploads for a creator. Returns count of newly inserted videos."""
    from backend.services.youtube import get_recent_videos, get_video_details

    if not creator.uploads_playlist_id:
        return 0

    recent = get_recent_videos(
        creator.uploads_playlist_id,
        max_results=settings.recent_videos_limit,
    )
    ids = [v["youtube_video_id"] for v in recent]
    details = {d["youtube_video_id"]: d for d in get_video_details(ids)}
    added = 0
    for item in recent:
        vid = item["youtube_video_id"]
        if db.query(models.Video).filter_by(youtube_video_id=vid).first():
            continue
        detail = details.get(vid, item)
        db.add(
            models.Video(
                creator_id=creator.id,
                youtube_video_id=vid,
                title=detail.get("title") or item.get("title") or "Untitled",
                description=detail.get("description") or "",
                thumbnail_url=detail.get("thumbnail_url") or item.get("thumbnail_url"),
                duration_seconds=detail.get("duration_seconds") or 0,
                published_at=parse_yt_datetime(detail.get("published_at") or item.get("published_at")),
                view_count=detail.get("view_count") or 0,
                comment_count=detail.get("comment_count") or 0,
                scan_status="NOT_SCANNED",
                media_mode="youtube",
                is_demo=0,
            )
        )
        added += 1
    return added
