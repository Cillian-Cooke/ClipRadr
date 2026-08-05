from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from backend.services.youtube import YouTubeAPIError, api_configured, search_channels

router = APIRouter(prefix="/api/youtube", tags=["youtube"])


@router.get("/search-channels")
def youtube_search_channels(q: str = Query(..., min_length=1)):
    if not api_configured():
        raise HTTPException(
            400,
            "YOUTUBE_API_KEY is not set. Add it to .env and restart.",
        )
    try:
        channels = search_channels(q, max_results=8)
    except YouTubeAPIError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"query": q.strip(), "channels": channels}
