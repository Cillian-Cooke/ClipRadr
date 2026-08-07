"""Deterministic demo dataset for ClipRadr hackathon presentation."""

from __future__ import annotations

import json
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from backend.config import ROOT_DIR, settings
from backend.database import models
from backend.services.embeddings import cosine_similarity, infer_topic, relationship_label, simple_embedding
from backend.services.moments import TimestampMention, cluster_timestamps, suggested_clip_bounds
from backend.services.scoring import score_cluster
from backend.services.timestamps import extract_timestamps


DEMO_CREATORS = [
    {
        "youtube_channel_id": "UC_DEMO_CHAOS",
        "name": "ChaosCraft",
        "handle": "@chaoscraft",
        "thumbnail_url": "/static/avatars/chaos.svg",
        "description": "Long-form gaming streams, clutch moments, and absolute chaos.",
        "uploads_playlist_id": "UU_DEMO_CHAOS",
    },
    {
        "youtube_channel_id": "UC_DEMO_REACT",
        "name": "Riley Reacts",
        "handle": "@rileyreacts",
        "thumbnail_url": "/static/avatars/riley.svg",
        "description": "Reaction VODs, podcasts, and unfiltered takes.",
        "uploads_playlist_id": "UU_DEMO_REACT",
    },
    {
        "youtube_channel_id": "UC_DEMO_POD",
        "name": "Late Night Loop",
        "handle": "@latenightloop",
        "thumbnail_url": "/static/avatars/loop.svg",
        "description": "Multi-hour podcasts and story dumps.",
        "uploads_playlist_id": "UU_DEMO_POD",
    },
]


# Video definitions with embedded comment scripts for deterministic moments
DEMO_VIDEOS = [
    # ChaosCraft — flagship long VOD with local demo media
    {
        "creator": "UC_DEMO_CHAOS",
        "youtube_video_id": "demo_chaos_4h",
        "title": "4 HOURS OF CHAOS — Ranked Marathon",
        "duration_seconds": 15120,  # ~4h12m — UI presents long-form; demo file is shorter
        "display_hint": "Simulated 4h VOD (demo media ~90s for local playback/export)",
        "published_days_ago": 1,
        "view_count": 84210,
        "media_mode": "demo",
        "source_path": "media/demo/demo-vod.mp4",
        "comments": [
            ("ClipHunter92", "THE TRICKSHOT AT 10:14 😭", 42, "10:14"),
            ("NovaBee", "Someone please clip this", 31, "10:15"),
            ("arc_runner", "10:15 was crazy", 18, "10:15"),
            ("pixelpete", "clip this at 10:00", 12, "10:00"),
            ("mira", "10:04 that was insane", 9, "10:04"),
            ("jayz0", "best part 10:06", 7, "10:06"),
            ("streamfan", "10:08 CLIP THIS NOW", 15, "10:08"),
            ("editormark", "10:05 needs to be a short", 11, "10:05"),
            ("vodcutter", "timestamp 10:07 absolute cinema", 10, "10:07"),
            ("saltlord", "the clutch at 01:32:10 was insane", 55, "01:32:10"),
            ("beekeeper", "1:32:12 HOW", 22, "1:32:12"),
            ("rin", "clip the trickshot around 1:32", 19, "1:32"),
            ("toast", "another insane trickshot at 02:14:44", 33, "02:14:44"),
            ("kel", "02:14:40 no way", 14, "02:14:40"),
            ("oxy", "he rage quit at 45:20 lmao", 28, "45:20"),
            ("oxy2", "45:22 dying 😂", 11, "45:22"),
            ("fan1", "funny fail at 12:00", 8, "12:00"),
            ("fan2", "12:03 whiffed so hard", 6, "12:03"),
            ("quiet", "great stream overall", 2, None),
            ("mod", "welcome everyone", 1, None),
            # Dense cluster near start for demo VOD seeking (short file)
            ("demo_seek_a", "10 seconds was insane", 40, "10 seconds"),
            ("demo_seek_b", "11 sec 😂", 25, "11 sec"),
            ("demo_seek_c", "at 00:10", 20, "00:10"),
            ("demo_seek_d", "0:11 clip this", 17, "0:11"),
            ("demo_seek_e", "10s best moment of the stream", 15, "10s"),
            ("demo_mid", "around 0:25 that clutch 1v3", 21, "0:25"),
            ("demo_mid2", "0:26 was crazy clutch", 16, "0:26"),
            ("demo_end", "the reaction at 0:45 💀", 12, "0:45"),
        ],
    },
    {
        "creator": "UC_DEMO_CHAOS",
        "youtube_video_id": "demo_chaos_best",
        "title": "BEST MOMENTS from last night's stream",
        "duration_seconds": 5400,
        "published_days_ago": 4,
        "view_count": 52100,
        "media_mode": "youtube",
        "comments": [
            ("ClipHunter92", "another insane trickshot at 02:14:44", 40, "02:14:44"),
            ("nova", "02:14:50 please clip", 18, "02:14:50"),
            ("rin", "that shot at 2:14 was nuts", 12, "2:14"),
            ("kel", "clutch at 33:10", 9, "33:10"),
            ("oxy", "33:12 ACE", 8, "33:12"),
        ],
    },
    {
        "creator": "UC_DEMO_CHAOS",
        "youtube_video_id": "demo_chaos_insane",
        "title": "INSANE STREAM — Uncut",
        "duration_seconds": 10800,
        "published_days_ago": 7,
        "view_count": 91000,
        "media_mode": "youtube",
        "comments": [
            ("beekeeper", "that trickshot was insane 01:32:10", 48, "01:32:10"),
            ("rin", "1:32:08 how did he hit that", 20, "1:32:08"),
            ("toast", "insane trick shot again", 11, "1:32:10"),
            ("fan", "rage at 2:01:00", 7, "2:01:00"),
        ],
    },
    {
        "creator": "UC_DEMO_CHAOS",
        "youtube_video_id": "demo_chaos_grind",
        "title": "GRIND SESSION — 3 Hours Straight",
        "duration_seconds": 11000,
        "published_days_ago": 10,
        "view_count": 33000,
        "media_mode": "youtube",
        "comments": [
            ("a", "funny moment 18:40", 10, "18:40"),
            ("b", "18:42 lol", 6, "18:42"),
            ("c", "fail at 55:01", 5, "55:01"),
        ],
    },
    {
        "creator": "UC_DEMO_CHAOS",
        "youtube_video_id": "demo_chaos_duo",
        "title": "DUO QUEUE GONE WRONG",
        "duration_seconds": 7200,
        "published_days_ago": 12,
        "view_count": 41000,
        "media_mode": "youtube",
        "comments": [
            ("x", "clip 22:10", 14, "22:10"),
            ("y", "22:12 screaming", 9, "22:12"),
        ],
    },
    # Riley Reacts
    {
        "creator": "UC_DEMO_REACT",
        "youtube_video_id": "demo_riley_react1",
        "title": "Reacting to Viral Clips for 2 Hours",
        "duration_seconds": 7800,
        "published_days_ago": 2,
        "view_count": 120400,
        "media_mode": "youtube",
        "comments": [
            ("viewer1", "her face at 01:12:44 😭", 60, "01:12:44"),
            ("viewer2", "1:12:40 clip the reaction", 35, "1:12:40"),
            ("viewer3", "that trickshot reaction was gold", 22, "01:12:44"),
            ("viewer4", "podcast story at 40:00", 8, "40:00"),
            ("viewer5", "40:05 hilarious", 6, "40:05"),
        ],
    },
    {
        "creator": "UC_DEMO_REACT",
        "youtube_video_id": "demo_riley_pod",
        "title": "Unfiltered Podcast VOD",
        "duration_seconds": 9600,
        "published_days_ago": 5,
        "view_count": 67000,
        "media_mode": "youtube",
        "comments": [
            ("p1", "story at 1:05:20", 15, "1:05:20"),
            ("p2", "1:05:22 that guest story", 10, "1:05:22"),
            ("p3", "funny bit 12:30", 7, "12:30"),
        ],
    },
    {
        "creator": "UC_DEMO_REACT",
        "youtube_video_id": "demo_riley_late",
        "title": "LATE NIGHT REACT MARATHON",
        "duration_seconds": 14400,
        "published_days_ago": 8,
        "view_count": 88000,
        "media_mode": "youtube",
        "comments": [
            ("r1", "best reaction 03:14:12", 30, "03:14:12"),
            ("r2", "3:14:10 dying laughing", 18, "3:14:10"),
            ("r3", "trickshot clip reaction again", 12, "03:14:12"),
        ],
    },
    {
        "creator": "UC_DEMO_REACT",
        "youtube_video_id": "demo_riley_shorts_src",
        "title": "Everything I Watched This Week",
        "duration_seconds": 5400,
        "published_days_ago": 11,
        "view_count": 45000,
        "media_mode": "youtube",
        "comments": [
            ("s1", "clip 8:20", 9, "8:20"),
            ("s2", "8:22 please", 5, "8:22"),
        ],
    },
    # Late Night Loop
    {
        "creator": "UC_DEMO_POD",
        "youtube_video_id": "demo_loop_ep12",
        "title": "EP 12 — We Talked Too Long",
        "duration_seconds": 12600,
        "published_days_ago": 3,
        "view_count": 29000,
        "media_mode": "youtube",
        "comments": [
            ("loop1", "guest story at 00:48:20", 20, "00:48:20"),
            ("loop2", "48:22 that story needs a clip", 14, "48:22"),
            ("loop3", "funny rant 2:10:00", 11, "2:10:00"),
            ("loop4", "2:10:05 lmao", 7, "2:10:05"),
        ],
    },
    {
        "creator": "UC_DEMO_POD",
        "youtube_video_id": "demo_loop_ep11",
        "title": "EP 11 — Hot Takes Only",
        "duration_seconds": 10800,
        "published_days_ago": 9,
        "view_count": 31000,
        "media_mode": "youtube",
        "comments": [
            ("l1", "clip this take 15:40", 13, "15:40"),
            ("l2", "15:42 wild", 8, "15:42"),
        ],
    },
    {
        "creator": "UC_DEMO_POD",
        "youtube_video_id": "demo_loop_live",
        "title": "LIVE LISTENER CALL-INS (VOD)",
        "duration_seconds": 9000,
        "published_days_ago": 14,
        "view_count": 22000,
        "media_mode": "youtube",
        "comments": [
            ("c1", "call-in at 1:20:00", 10, "1:20:00"),
            ("c2", "1:20:05 hilarious", 6, "1:20:05"),
        ],
    },
]


def ensure_workspace_user(db: Session) -> models.User:
    user = db.query(models.User).filter_by(email="editor@clipradr.demo").first()
    if user:
        return user
    user = models.User(email="editor@clipradr.demo", name="Editor")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def purge_demo_data(db: Session) -> int:
    """Remove seeded demo creators (and cascaded videos/moments)."""
    demo_creators = db.query(models.Creator).filter_by(is_demo=1).all()
    if not demo_creators:
        orphans = db.query(models.Video).filter_by(is_demo=1).all()
        for video in orphans:
            db.delete(video)
        if orphans:
            db.commit()
        return 0

    removed = 0
    for creator in demo_creators:
        db.query(models.UserCreator).filter_by(creator_id=creator.id).delete()
        video_ids = [v.id for v in db.query(models.Video).filter_by(creator_id=creator.id).all()]
        if video_ids:
            moment_ids = [
                m.id
                for m in db.query(models.Moment).filter(models.Moment.video_id.in_(video_ids)).all()
            ]
            if moment_ids:
                db.query(models.SavedClip).filter(models.SavedClip.moment_id.in_(moment_ids)).delete(
                    synchronize_session=False
                )
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
        if video_ids:
            db.query(models.ExportJob).filter(models.ExportJob.video_id.in_(video_ids)).delete(
                synchronize_session=False
            )
        db.delete(creator)
        removed += 1
    db.commit()
    return removed


def ensure_workspace(db: Session) -> None:
    """Boot workspace user; seed or purge demo data based on DEMO_MODE."""
    ensure_workspace_user(db)
    if settings.demo_mode:
        seed_demo_data(db)
    else:
        purge_demo_data(db)


def seed_demo_data(db: Session) -> None:
    if db.query(models.Creator).filter_by(is_demo=1).first():
        return

    user = ensure_workspace_user(db)
    db.flush()

    creators_by_channel: dict[str, models.Creator] = {}
    now = datetime.utcnow()

    for c in DEMO_CREATORS:
        creator = models.Creator(
            youtube_channel_id=c["youtube_channel_id"],
            name=c["name"],
            handle=c["handle"],
            thumbnail_url=c["thumbnail_url"],
            description=c["description"],
            uploads_playlist_id=c["uploads_playlist_id"],
            last_scanned_at=now - timedelta(hours=2),
            is_demo=1,
        )
        db.add(creator)
        db.flush()
        creators_by_channel[c["youtube_channel_id"]] = creator
        db.add(models.UserCreator(user_id=user.id, creator_id=creator.id))

    all_moments: list[models.Moment] = []
    moment_texts: dict[int, str] = {}

    for vdef in DEMO_VIDEOS:
        creator = creators_by_channel[vdef["creator"]]
        published = now - timedelta(days=vdef["published_days_ago"])
        video = models.Video(
            creator_id=creator.id,
            youtube_video_id=vdef["youtube_video_id"],
            title=vdef["title"],
            description=vdef.get("display_hint", ""),
            thumbnail_url=f"/static/thumbs/{vdef['youtube_video_id']}.svg",
            duration_seconds=vdef["duration_seconds"],
            published_at=published,
            view_count=vdef["view_count"],
            comment_count=len(vdef["comments"]),
            scanned_at=now - timedelta(hours=1),
            scan_status="SCANNED",
            media_mode=vdef.get("media_mode", "youtube"),
            is_demo=1,
        )
        db.add(video)
        db.flush()

        if vdef.get("source_path"):
            path = ROOT_DIR / vdef["source_path"]
            db.add(
                models.SourceMedia(
                    video_id=video.id,
                    storage_type="local",
                    path=str(path),
                    duration_seconds=vdef["duration_seconds"],
                )
            )

        mentions: list[TimestampMention] = []
        comment_rows: list[models.Comment] = []

        for idx, (author, text, likes, _hint) in enumerate(vdef["comments"]):
            comment = models.Comment(
                video_id=video.id,
                youtube_comment_id=f"{vdef['youtube_video_id']}_c{idx}",
                author_name=author,
                author_avatar=None,
                text=text,
                like_count=likes,
                published_at=published + timedelta(minutes=idx),
            )
            db.add(comment)
            db.flush()
            comment_rows.append(comment)

            parsed = extract_timestamps(text)
            for p in parsed:
                db.add(
                    models.CommentTimestamp(
                        comment_id=comment.id,
                        timestamp_seconds=p.timestamp_seconds,
                        original_timestamp=p.original_timestamp,
                        confidence=p.confidence,
                    )
                )
                mentions.append(
                    TimestampMention(
                        timestamp_seconds=p.timestamp_seconds,
                        comment_id=comment.id,
                        author=author,
                        text=text,
                        likes=likes,
                        original_timestamp=p.original_timestamp,
                        confidence=p.confidence,
                    )
                )

        clusters = cluster_timestamps(mentions)
        for cluster in clusters:
            # Clamp cluster ends to video duration for realism
            if cluster.start_seconds > video.duration_seconds:
                continue
            cluster.end_seconds = min(cluster.end_seconds, video.duration_seconds)
            cluster.start_seconds = min(cluster.start_seconds, video.duration_seconds)

            texts = [m.text for m in cluster.mentions]
            topic = infer_topic(texts + [video.title])
            score = score_cluster(cluster)
            start, end = suggested_clip_bounds(cluster, video_duration=video.duration_seconds)

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

            linked_comments = {m.comment_id for m in cluster.mentions if m.comment_id}
            for cid in linked_comments:
                db.add(models.MomentComment(moment_id=moment.id, comment_id=cid))

            emb_text = f"{video.title}. Moment at {cluster.representative_timestamp}. " + " ".join(texts[:5])
            emb = simple_embedding(emb_text)
            db.add(models.MomentEmbedding(moment_id=moment.id, embedding=json.dumps(emb)))
            moment_texts[moment.id] = emb_text
            all_moments.append(moment)

    db.flush()

    # Cross-video similarity
    embeddings = {
        m.id: json.loads(db.query(models.MomentEmbedding).filter_by(moment_id=m.id).one().embedding)
        for m in all_moments
    }
    for i, a in enumerate(all_moments):
        for b in all_moments[i + 1 :]:
            if a.video_id == b.video_id:
                continue
            sim = cosine_similarity(embeddings[a.id], embeddings[b.id])
            # Same explicit topic gets a small boost for demo reliability
            if a.topic and a.topic == b.topic and a.topic != "MOMENT":
                sim = min(1.0, sim + 0.08)
            if sim >= 0.78:
                db.add(
                    models.MomentRelation(
                        moment_a_id=a.id,
                        moment_b_id=b.id,
                        similarity=round(sim, 4),
                        relationship_type=relationship_label(sim),
                    )
                )

    # One pre-saved clip for the demo editor
    flagship = (
        db.query(models.Moment)
        .join(models.Video)
        .filter(models.Video.youtube_video_id == "demo_chaos_4h")
        .order_by(models.Moment.score.desc())
        .first()
    )
    if flagship:
        db.add(
            models.SavedClip(
                user_id=user.id,
                moment_id=flagship.id,
                start_seconds=flagship.start_seconds,
                end_seconds=flagship.end_seconds,
                aspect_ratio="9:16",
                width=1080,
                height=1920,
                crop_position="CENTER",
                status="TO_EDIT",
                notes="Demo saved clip — trickshot / early moment",
            )
        )

    db.commit()
