"""Explainable moment scoring."""

from __future__ import annotations

from backend.services.moments import MomentCluster


def raw_moment_score(
    *,
    unique_commenters: int,
    timestamp_mentions: int,
    total_likes: int,
    topic_relevance: float = 1.0,
) -> float:
    """
    moment_score =
      (unique commenters × 5)
    + (timestamp references × 3)
    + (comment likes × 0.5)
    + (topic relevance × 2)
    """
    return (
        unique_commenters * 5
        + timestamp_mentions * 3
        + total_likes * 0.5
        + topic_relevance * 2
    )


def normalize_score(raw: float, *, ceiling: float = 100.0) -> float:
    """Normalize to 0–100 with a soft ceiling."""
    if raw <= 0:
        return 0.0
    # Soft saturation so strong signals still differentiate near the top
    normalized = 100.0 * (1.0 - (ceiling / (ceiling + raw)))
    return round(min(100.0, max(0.0, normalized * 1.35)), 1)


def score_cluster(cluster: MomentCluster, *, topic_relevance: float = 1.0) -> float:
    raw = raw_moment_score(
        unique_commenters=cluster.unique_commenters,
        timestamp_mentions=len(cluster.mentions),
        total_likes=cluster.total_likes,
        topic_relevance=topic_relevance,
    )
    return normalize_score(raw)


def score_label(score: float) -> str:
    if score >= 80:
        return "High audience signal"
    if score >= 55:
        return "Strong audience signal"
    if score >= 30:
        return "Moderate audience signal"
    return "Emerging audience signal"
