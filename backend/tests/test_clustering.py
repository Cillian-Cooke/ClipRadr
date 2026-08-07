from backend.services.moments import TimestampMention, cluster_timestamps, suggested_clip_bounds


def _m(ts: int, author: str = "a", likes: int = 1, cid: int | None = None) -> TimestampMention:
    return TimestampMention(
        timestamp_seconds=ts,
        author=author,
        likes=likes,
        comment_id=cid if cid is not None else ts,
        text=f"at {ts}",
    )


def test_cluster_nearby_timestamps():
    mentions = [_m(10, "a"), _m(11, "b"), _m(12, "c"), _m(19, "d")]
    clusters = cluster_timestamps(mentions, radius_seconds=5, max_span_seconds=15)
    # 10,11,12 should cluster; 19 may join if within span from 10 (9 sec) and near end
    assert len(clusters) >= 1
    first = clusters[0]
    assert first.start_seconds == 10
    assert 12 <= first.end_seconds <= 19


def test_cluster_does_not_chain_forever():
    mentions = [_m(i) for i in range(0, 60, 4)]  # 0,4,8,... forever-ish
    clusters = cluster_timestamps(mentions, radius_seconds=5, max_span_seconds=15)
    assert len(clusters) > 1
    for c in clusters:
        assert c.end_seconds - c.start_seconds <= 15


def test_dense_10_second_cluster():
    mentions = [
        _m(10, "a"),
        _m(11, "b"),
        _m(10, "c"),
        _m(11, "d"),
    ]
    clusters = cluster_timestamps(mentions)
    assert len(clusters) == 1
    assert clusters[0].unique_commenters == 4
    assert clusters[0].start_seconds == 10
    assert clusters[0].end_seconds == 11


def test_suggested_bounds_pre_post_roll():
    mentions = [_m(600), _m(604), _m(606)]
    cluster = cluster_timestamps(mentions)[0]
    start, end = suggested_clip_bounds(cluster, video_duration=3600, pre_roll=5, post_roll=10)
    assert start == 595
    assert end == 616


def test_suggested_bounds_clamp_start():
    mentions = [_m(3), _m(4)]
    cluster = cluster_timestamps(mentions)[0]
    start, end = suggested_clip_bounds(cluster, video_duration=100, pre_roll=5, post_roll=10)
    assert start == 0
    assert end == 14
