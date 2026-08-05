"""Robust timestamp extraction from comment text."""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass
class ParsedTimestamp:
    timestamp_seconds: int
    original_timestamp: str
    confidence: float = 1.0


# Ordered from more specific to less specific
_HMS = re.compile(
    r"(?<!\d)(?:(?P<h>\d{1,2}):)?(?P<m>\d{1,2}):(?P<s>\d{2})(?!\d)"
)
_SECONDS_WORD = re.compile(
    r"(?<!\d)(?P<n>\d{1,5})\s*(?:seconds?|secs?|s)\b",
    re.IGNORECASE,
)


def hms_to_seconds(hours: int | None, minutes: int, seconds: int) -> int | None:
    if seconds >= 60:
        return None
    if hours is None:
        # Ambiguous m:ss — treat first group as minutes if <= 59, else invalid
        if minutes >= 60:
            return None
        return minutes * 60 + seconds
    if hours > 99 or minutes >= 60:
        return None
    return hours * 3600 + minutes * 60 + seconds


def parse_timestamp_token(token: str) -> int | None:
    """Parse a single timestamp token into seconds."""
    token = token.strip()
    if not token:
        return None

    word = _SECONDS_WORD.fullmatch(token)
    if word:
        return int(word.group("n"))

    m = _HMS.fullmatch(token)
    if m:
        h = m.group("h")
        return hms_to_seconds(int(h) if h is not None else None, int(m.group("m")), int(m.group("s")))

    return None


def extract_timestamps(text: str) -> list[ParsedTimestamp]:
    """Extract all timestamp references from comment text."""
    if not text:
        return []

    found: list[ParsedTimestamp] = []
    seen_spans: list[tuple[int, int]] = []

    def overlaps(start: int, end: int) -> bool:
        return any(not (end <= s or start >= e) for s, e in seen_spans)

    # Clock-style first (1:32, 01:02:14, 0:10)
    for m in _HMS.finditer(text):
        start, end = m.span()
        if overlaps(start, end):
            continue
        h = m.group("h")
        seconds = hms_to_seconds(
            int(h) if h is not None else None,
            int(m.group("m")),
            int(m.group("s")),
        )
        if seconds is None:
            continue
        seen_spans.append((start, end))
        found.append(
            ParsedTimestamp(
                timestamp_seconds=seconds,
                original_timestamp=m.group(0),
                confidence=0.95 if h is not None else 0.9,
            )
        )

    # Word-style (10s, 10 sec, 10 seconds)
    for m in _SECONDS_WORD.finditer(text):
        start, end = m.span()
        if overlaps(start, end):
            continue
        seconds = int(m.group("n"))
        # Guard against huge nonsense numbers
        if seconds > 12 * 3600:
            continue
        seen_spans.append((start, end))
        found.append(
            ParsedTimestamp(
                timestamp_seconds=seconds,
                original_timestamp=m.group(0),
                confidence=0.85,
            )
        )

    found.sort(key=lambda p: p.timestamp_seconds)
    return found


def normalize_to_seconds(text: str) -> int | None:
    """Parse the first timestamp in text, or None."""
    parsed = extract_timestamps(text)
    return parsed[0].timestamp_seconds if parsed else None
