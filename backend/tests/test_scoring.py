from backend.services.scoring import normalize_score, raw_moment_score, score_label


def test_raw_score_formula():
    # 8 unique, 11 mentions, 23 likes, topic 1
    raw = raw_moment_score(
        unique_commenters=8,
        timestamp_mentions=11,
        total_likes=23,
        topic_relevance=1.0,
    )
    assert raw == 8 * 5 + 11 * 3 + 23 * 0.5 + 2


def test_normalize_high_signal():
    raw = raw_moment_score(
        unique_commenters=8,
        timestamp_mentions=11,
        total_likes=23,
        topic_relevance=1.0,
    )
    score = normalize_score(raw)
    assert 50 <= score <= 100
    assert "signal" in score_label(score).lower()
