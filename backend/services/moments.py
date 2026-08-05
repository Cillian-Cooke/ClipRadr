"""Cluster nearby timestamp mentions into clip moments."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class TimestampMention:
    timestamp_seconds: int
    comment_id: int | None = None
    author: str | None = None
    text: str = ""
    likes: int = 0
    original_timestamp: str = ""
    confidence: float = 1.0


@dataclass
class MomentCluster:
    start_seconds: int
    end_seconds: int
    representative_timestamp: int
    mentions: list[TimestampMention] = field(default_factory=list)

    @property
    def comment_count(self) -> int:
        return len({m.comment_id for m in self.mentions if m.comment_id is not None}) or len(self.mentions)

    @property
    def unique_commenters(self) -> int:
        authors = {m.author for m in self.mentions if m.author}
        return len(authors) if authors else self.comment_count

    @property
    def total_likes(self) -> int:
        return sum(m.likes for m in self.mentions)


def cluster_timestamps(
    mentions: list[TimestampMention],
    *,
    radius_seconds: int = 5,
    max_span_seconds: int = 15,
    cluster_window_seconds: int | None = None,
) -> list[MomentCluster]:
    """
    Cluster timestamps that refer to the same nearby event.

    Algorithm:
    1. Sort by timestamp.
    2. Grow clusters greedily: a mention joins the current cluster if it is
       within `radius_seconds` of the cluster's current end AND the resulting
       span does not exceed `max_span_seconds`.
    3. `cluster_window_seconds` (default 10) is used as an alternate join
       threshold against the cluster representative when radius alone is tight.

    This avoids infinite chaining of unrelated moments while still merging
    10s / 11s / 12s style comments.
    """
    if not mentions:
        return []

    window = cluster_window_seconds if cluster_window_seconds is not None else max(radius_seconds * 2, 10)
    ordered = sorted(mentions, key=lambda m: m.timestamp_seconds)
    clusters: list[MomentCluster] = []

    current_mentions = [ordered[0]]
    cluster_start = ordered[0].timestamp_seconds
    cluster_end = ordered[0].timestamp_seconds

    for mention in ordered[1:]:
        ts = mention.timestamp_seconds
        near_end = ts - cluster_end <= radius_seconds
        near_rep = abs(ts - _representative(current_mentions)) <= window
        span_ok = ts - cluster_start <= max_span_seconds

        if (near_end or near_rep) and span_ok:
            current_mentions.append(mention)
            cluster_end = max(cluster_end, ts)
            cluster_start = min(cluster_start, ts)
        else:
            clusters.append(_finalize(current_mentions))
            current_mentions = [mention]
            cluster_start = ts
            cluster_end = ts

    clusters.append(_finalize(current_mentions))
    return clusters


def _representative(mentions: list[TimestampMention]) -> int:
    values = sorted(m.timestamp_seconds for m in mentions)
    mid = len(values) // 2
    if len(values) % 2 == 1:
        return values[mid]
    return round((values[mid - 1] + values[mid]) / 2)


def _finalize(mentions: list[TimestampMention]) -> MomentCluster:
    start = min(m.timestamp_seconds for m in mentions)
    end = max(m.timestamp_seconds for m in mentions)
    return MomentCluster(
        start_seconds=start,
        end_seconds=end,
        representative_timestamp=_representative(mentions),
        mentions=list(mentions),
    )


def suggested_clip_bounds(
    cluster: MomentCluster,
    *,
    video_duration: int,
    pre_roll: int = 10,
    post_roll: int = 10,
) -> tuple[int, int]:
    start = max(0, cluster.start_seconds - pre_roll)
    end = min(video_duration, cluster.end_seconds + post_roll)
    if end <= start:
        end = min(video_duration, start + 1)
    return start, end


def clip_from_preset(
    representative: int,
    duration: int,
    video_duration: int,
) -> tuple[int, int]:
    half = duration // 2
    start = max(0, representative - half)
    end = start + duration
    if end > video_duration:
        end = video_duration
        start = max(0, end - duration)
    return start, end
