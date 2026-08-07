"""Helpers for filtering Shorts vs long-form / 1h+ VODs."""

from __future__ import annotations

# Under 3 minutes (or #shorts) counts as a Short.
SHORTS_MAX_DURATION_SECONDS = 180
OVER_1H_SECONDS = 3600

LENGTH_FILTERS = ("all", "no_shorts", "over_1h")


def is_youtube_short(duration_seconds: int | None, title: str | None = None) -> bool:
    """True when this upload looks like a Short, not a long-form VOD."""
    duration = int(duration_seconds or 0)
    if duration > 0 and duration < SHORTS_MAX_DURATION_SECONDS:
        return True
    title_l = (title or "").lower()
    if "#shorts" in title_l or " #short" in f" {title_l}":
        return True
    return False


def passes_length_filter(
    duration_seconds: int | None,
    title: str | None,
    length: str = "no_shorts",
) -> bool:
    """Apply list filter: all | no_shorts | over_1h."""
    mode = (length or "no_shorts").strip().lower()
    if mode not in LENGTH_FILTERS:
        mode = "no_shorts"
    if mode == "all":
        return True
    duration = int(duration_seconds or 0)
    if mode == "over_1h":
        return duration >= OVER_1H_SECONDS
    return not is_youtube_short(duration, title)
