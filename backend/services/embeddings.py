"""Lightweight keyword/topic helpers for MVP (embeddings optional later)."""

from __future__ import annotations

import math
import re
from collections import Counter


TOPIC_ALIASES: dict[str, list[str]] = {
    "TRICKSHOT": ["trickshot", "trick shot", "crazy shot", "that shot", "insane shot", "no scope"],
    "RAGE": ["rage", "tilted", "mad", "angry", "lost it", "screaming"],
    "FUNNY": ["funny", "hilarious", "lol", "lmao", "dying", "💀", "😂", "😭"],
    "CLUTCH": ["clutch", "1v", "ace", "won the round", "last second"],
    "FAIL": ["fail", "died", "whiff", "missed", "crashed"],
    "REACTION": ["reaction", "reacted", "face", "expression"],
    "PODCAST": ["story", "podcast", "talking about", "guest"],
}


def normalize_topic_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower()).strip()


def infer_topic(texts: list[str]) -> str:
    blob = normalize_topic_text(" ".join(texts))
    scores: Counter[str] = Counter()
    for topic, aliases in TOPIC_ALIASES.items():
        for alias in aliases:
            if alias in blob:
                scores[topic] += 1
    if not scores:
        return "MOMENT"
    return scores.most_common(1)[0][0]


def simple_embedding(text: str, dim: int = 64) -> list[float]:
    """Deterministic bag-of-char-ngrams embedding for offline demo similarity."""
    text = normalize_topic_text(text)
    vec = [0.0] * dim
    if not text:
        return vec
    for i in range(len(text) - 2):
        gram = text[i : i + 3]
        h = hash(gram) % dim
        vec[h] += 1.0
    # Strong topic boosts so same-topic moments cluster across videos
    for topic, aliases in TOPIC_ALIASES.items():
        hits = sum(1 for alias in aliases if alias in text)
        if hits:
            idx = hash(topic) % dim
            vec[idx] += 8.0 + hits * 2.0
            # Spread topic across a few dims for stability
            vec[(idx + 7) % dim] += 5.0
            vec[(idx + 13) % dim] += 5.0
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    return float(sum(x * y for x, y in zip(a, b)))


def relationship_label(similarity: float) -> str:
    if similarity >= 0.9:
        return "VERY_SIMILAR"
    if similarity >= 0.84:
        return "SIMILAR"
    return "RELATED"
