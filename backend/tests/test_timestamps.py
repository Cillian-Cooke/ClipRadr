from backend.services.timestamps import extract_timestamps, normalize_to_seconds, parse_timestamp_token


def test_parse_seconds_words():
    assert parse_timestamp_token("10s") == 10
    assert parse_timestamp_token("10 sec") == 10
    assert parse_timestamp_token("10 seconds") == 10


def test_parse_clock_forms():
    assert parse_timestamp_token("00:10") == 10
    assert parse_timestamp_token("0:10") == 10
    assert parse_timestamp_token("1:32") == 92
    assert parse_timestamp_token("01:10") == 70
    assert parse_timestamp_token("1:02:14") == 3734
    assert parse_timestamp_token("01:02:14") == 3734


def test_extract_from_natural_language():
    assert normalize_to_seconds("at 10 seconds") == 10
    assert normalize_to_seconds("around 1:32") == 92
    assert normalize_to_seconds("1:32 was crazy") == 92
    assert normalize_to_seconds("the part at 02:14:21") == 8061


def test_extract_multiple():
    parsed = extract_timestamps("from 0:10 to 0:11 was wild")
    assert [p.timestamp_seconds for p in parsed] == [10, 11]
