"""YouTube Data API service — discovery/metadata/comments only."""

from __future__ import annotations

import json
import re
from typing import Any

import httpx

from backend.config import settings


CHANNEL_URL_PATTERNS = [
    re.compile(r"youtube\.com/@(?P<handle>[\w.-]+)", re.I),
    re.compile(r"youtube\.com/channel/(?P<id>UC[\w-]+)", re.I),
    re.compile(r"youtube\.com/c/(?P<custom>[\w.-]+)", re.I),
    re.compile(r"^(?P<bare_handle>@[\w.-]+)$", re.I),
]


class YouTubeAPIError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None, reason: str | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.reason = reason


def api_configured() -> bool:
    return bool(settings.youtube_api_key and settings.youtube_api_key.strip())


_api_probe_cache: dict[str, Any] = {"at": 0.0, "ok": False, "error": None}


def probe_api_key(*, force: bool = False) -> dict[str, Any]:
    """Check whether the configured key is accepted by YouTube (cached ~60s)."""
    import time

    now = time.time()
    if not force and _api_probe_cache["at"] and now - float(_api_probe_cache["at"]) < 60:
        return {
            "configured": api_configured(),
            "valid": bool(_api_probe_cache["ok"]),
            "error": _api_probe_cache["error"],
        }

    if not api_configured():
        _api_probe_cache.update({"at": now, "ok": False, "error": "YOUTUBE_API_KEY is not set."})
        return {"configured": False, "valid": False, "error": _api_probe_cache["error"]}

    try:
        # Cheap auth check — search costs ~100 units; channels.list with id is lighter.
        _get("channels", {"part": "id", "id": "UC_x5XG1OV2P6uZZ5FSM9Ttw", "maxResults": "1"})
        _api_probe_cache.update({"at": now, "ok": True, "error": None})
        return {"configured": True, "valid": True, "error": None}
    except YouTubeAPIError as exc:
        _api_probe_cache.update({"at": now, "ok": False, "error": str(exc)})
        return {"configured": True, "valid": False, "error": str(exc)}


def _require_key() -> str:
    if not api_configured():
        raise YouTubeAPIError(
            "YOUTUBE_API_KEY is not configured. Add it to your .env file, then restart the server.",
            reason="missing_key",
        )
    return settings.youtube_api_key.strip()


def _friendly_error(resp: httpx.Response) -> YouTubeAPIError:
    try:
        payload = resp.json()
        err = payload.get("error") or {}
        message = err.get("message") or resp.text
        reasons = [e.get("reason") for e in err.get("errors") or [] if e.get("reason")]
        reason = reasons[0] if reasons else None
        if reason == "quotaExceeded":
            message = "YouTube API quota exceeded for today. Try again tomorrow or use a different key."
        elif reason == "keyInvalid":
            where = (
                "Vercel → Project → Settings → Environment Variables"
                if __import__("os").getenv("VERCEL") == "1"
                else ".env"
            )
            message = (
                f"YouTube API key is invalid. Update YOUTUBE_API_KEY in {where}, "
                "enable YouTube Data API v3, remove HTTP-referrer restrictions, then redeploy."
            )
        elif reason == "commentsDisabled":
            message = "Comments are disabled on this video."
        elif resp.status_code == 403:
            message = f"YouTube API forbidden: {message}"
        elif resp.status_code == 404:
            message = "YouTube resource not found."
        return YouTubeAPIError(message, status_code=resp.status_code, reason=reason)
    except Exception:
        return YouTubeAPIError(resp.text or f"YouTube API error ({resp.status_code})", status_code=resp.status_code)


def _get(path: str, params: dict[str, Any]) -> dict:
    key = _require_key()
    params = {**params, "key": key}
    with httpx.Client(timeout=45.0) as client:
        resp = client.get(f"https://www.googleapis.com/youtube/v3/{path}", params=params)
        if resp.status_code != 200:
            raise _friendly_error(resp)
        return resp.json()


def resolve_channel(url: str) -> dict:
    """Resolve a channel URL or @handle to channel metadata."""
    raw = (url or "").strip()
    handle = channel_id = custom = None
    for pattern in CHANNEL_URL_PATTERNS:
        m = pattern.search(raw)
        if not m:
            continue
        gd = m.groupdict()
        handle = gd.get("handle") or (gd.get("bare_handle") or "").lstrip("@") or None
        channel_id = gd.get("id")
        custom = gd.get("custom")
        break

    if channel_id:
        return get_channel(channel_id)
    if handle:
        data = _get("channels", {"part": "snippet,contentDetails", "forHandle": handle})
        items = data.get("items") or []
        if not items:
            # Fallback: search
            search = _get(
                "search",
                {"part": "snippet", "q": handle, "type": "channel", "maxResults": 1},
            )
            s_items = search.get("items") or []
            if not s_items:
                raise YouTubeAPIError(f"No channel found for @{handle}")
            return get_channel(s_items[0]["snippet"]["channelId"])
        return _channel_from_item(items[0])
    if custom:
        data = _get("channels", {"part": "snippet,contentDetails", "forUsername": custom})
        items = data.get("items") or []
        if not items:
            raise YouTubeAPIError(f"No channel found for {custom}")
        return _channel_from_item(items[0])

    raise YouTubeAPIError(
        "Unrecognized YouTube channel URL. Use youtube.com/@handle, @handle, or /channel/UC…"
    )


def _channel_from_item(item: dict) -> dict:
    snippet = item.get("snippet", {})
    details = item.get("contentDetails", {})
    thumbs = snippet.get("thumbnails", {})
    thumb = (thumbs.get("high") or thumbs.get("medium") or thumbs.get("default") or {}).get("url")
    custom = snippet.get("customUrl") or ""
    handle = custom if custom.startswith("@") else (f"@{custom}" if custom else f"@{item['id']}")
    return {
        "youtube_channel_id": item["id"],
        "name": snippet.get("title", ""),
        "handle": handle,
        "thumbnail_url": thumb,
        "description": snippet.get("description", ""),
        "uploads_playlist_id": details.get("relatedPlaylists", {}).get("uploads"),
    }


def search_channels(query: str, max_results: int = 8) -> list[dict]:
    """Search YouTube for channels by name/handle."""
    q = (query or "").strip()
    if not q:
        return []

    # Direct resolve for URLs / @handles / channel IDs
    if (
        "youtube.com/" in q.lower()
        or q.startswith("@")
        or q.startswith("UC")
    ):
        try:
            channel = resolve_channel(q if q.startswith("UC") else q)
            return [channel]
        except YouTubeAPIError:
            if q.startswith("@"):
                q = q[1:]
            elif q.startswith("UC"):
                pass
            else:
                # fall through to search with cleaned query
                pass

    data = _get(
        "search",
        {
            "part": "snippet",
            "q": q.lstrip("@"),
            "type": "channel",
            "maxResults": min(max_results, 15),
        },
    )
    results = []
    seen = set()
    for item in data.get("items") or []:
        channel_id = item.get("snippet", {}).get("channelId") or item.get("id", {}).get("channelId")
        if not channel_id or channel_id in seen:
            continue
        seen.add(channel_id)
        try:
            results.append(get_channel(channel_id))
        except YouTubeAPIError:
            snippet = item.get("snippet", {})
            thumbs = snippet.get("thumbnails", {})
            results.append(
                {
                    "youtube_channel_id": channel_id,
                    "name": snippet.get("title", ""),
                    "handle": f"@{channel_id}",
                    "thumbnail_url": (thumbs.get("high") or thumbs.get("default") or {}).get("url"),
                    "description": snippet.get("description", ""),
                    "uploads_playlist_id": None,
                }
            )
        if len(results) >= max_results:
            break
    return results


def get_channel(channel_id: str) -> dict:
    data = _get("channels", {"part": "snippet,contentDetails", "id": channel_id})
    items = data.get("items") or []
    if not items:
        raise YouTubeAPIError("Channel not found")
    return _channel_from_item(items[0])


def get_uploads_playlist(channel_id: str) -> str:
    channel = get_channel(channel_id)
    playlist = channel.get("uploads_playlist_id")
    if not playlist:
        raise YouTubeAPIError("Uploads playlist not available")
    return playlist


def get_recent_videos(playlist_id: str, max_results: int = 20) -> list[dict]:
    data = _get(
        "playlistItems",
        {
            "part": "snippet,contentDetails",
            "playlistId": playlist_id,
            "maxResults": min(max_results, 50),
        },
    )
    videos = []
    for item in data.get("items") or []:
        snippet = item.get("snippet", {})
        thumbs = snippet.get("thumbnails", {})
        videos.append(
            {
                "youtube_video_id": item.get("contentDetails", {}).get("videoId")
                or snippet.get("resourceId", {}).get("videoId"),
                "title": snippet.get("title", ""),
                "description": snippet.get("description", ""),
                "thumbnail_url": (thumbs.get("high") or thumbs.get("medium") or thumbs.get("default") or {}).get("url"),
                "published_at": item.get("contentDetails", {}).get("videoPublishedAt")
                or snippet.get("publishedAt"),
            }
        )
    return [v for v in videos if v.get("youtube_video_id")]


def get_video_details(video_ids: list[str]) -> list[dict]:
    if not video_ids:
        return []
    data = _get(
        "videos",
        {
            "part": "snippet,contentDetails,statistics",
            "id": ",".join(video_ids[:50]),
        },
    )
    results = []
    for item in data.get("items") or []:
        snippet = item.get("snippet", {})
        stats = item.get("statistics", {})
        thumbs = snippet.get("thumbnails", {})
        duration_iso = item.get("contentDetails", {}).get("duration", "PT0S")
        results.append(
            {
                "youtube_video_id": item["id"],
                "title": snippet.get("title", ""),
                "description": snippet.get("description", ""),
                "thumbnail_url": (thumbs.get("high") or thumbs.get("medium") or thumbs.get("default") or {}).get("url"),
                "published_at": snippet.get("publishedAt"),
                "duration_seconds": _parse_iso_duration(duration_iso),
                "view_count": int(stats.get("viewCount") or 0),
                "comment_count": int(stats.get("commentCount") or 0),
            }
        )
    return results


def get_video_comments(video_id: str, max_comments: int = 1000) -> list[dict]:
    comments: list[dict] = []
    page_token = None
    while len(comments) < max_comments:
        params: dict[str, Any] = {
            "part": "snippet",
            "videoId": video_id,
            "maxResults": min(100, max_comments - len(comments)),
            "order": "relevance",
            "textFormat": "plainText",
        }
        if page_token:
            params["pageToken"] = page_token
        try:
            data = _get("commentThreads", params)
        except YouTubeAPIError as exc:
            if exc.reason == "commentsDisabled":
                return comments
            # Some videos return 403 with different wording
            if "disabled" in str(exc).lower():
                return comments
            raise
        for item in data.get("items") or []:
            top = item.get("snippet", {}).get("topLevelComment", {}).get("snippet", {})
            comments.append(
                {
                    "youtube_comment_id": item.get("snippet", {}).get("topLevelComment", {}).get("id"),
                    "author_name": top.get("authorDisplayName", "Unknown"),
                    "author_avatar": top.get("authorProfileImageUrl"),
                    "text": top.get("textDisplay") or top.get("textOriginal") or "",
                    "like_count": int(top.get("likeCount") or 0),
                    "published_at": top.get("publishedAt"),
                }
            )
            if len(comments) >= max_comments:
                break
        page_token = data.get("nextPageToken")
        if not page_token:
            break
    return comments


def _parse_iso_duration(value: str) -> int:
    match = re.fullmatch(
        r"PT(?:(?P<h>\d+)H)?(?:(?P<m>\d+)M)?(?:(?P<s>\d+)S)?",
        value or "PT0S",
    )
    if not match:
        return 0
    h = int(match.group("h") or 0)
    m = int(match.group("m") or 0)
    s = int(match.group("s") or 0)
    return h * 3600 + m * 60 + s
