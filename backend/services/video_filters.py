"""Helpers for excluding YouTube Shorts from long-form VOD workflows."""

from __future__ import annotations

# YouTube Shorts can be up to 3 minutes — treat under 3:00 as Shorts.
SHORTS_MAX_DURATION_SECONDS = 180


def is_youtube_short(duration_seconds: int | None, title: str | None = None) -> bool:
    """True when this upload looks like a Short, not a long-form VOD."""
    duration = int(duration_seconds or 0)
    if duration > 0 and duration < SHORTS_MAX_DURATION_SECONDS:
        return True
    title_l = (title or "").lower()
    if "#shorts" in title_l or " #short" in f" {title_l}":
        return True
    return False
