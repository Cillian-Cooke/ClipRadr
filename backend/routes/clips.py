from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from backend.database.database import get_db
from backend.database import models
from backend.services.serializers import fmt_ts, moment_to_dict

router = APIRouter(prefix="/api/clips", tags=["clips"])


class SaveClipBody(BaseModel):
    moment_id: int
    start_seconds: float
    end_seconds: float
    aspect_ratio: str = "16:9"
    width: int = 1920
    height: int = 1080
    crop_position: str = "CENTER"
    notes: str = ""
    status: str = "TO_EDIT"


class PatchClipBody(BaseModel):
    start_seconds: float | None = None
    end_seconds: float | None = None
    aspect_ratio: str | None = None
    width: int | None = None
    height: int | None = None
    crop_position: str | None = None
    notes: str | None = None
    status: str | None = None


def _demo_user(db: Session) -> models.User:
    user = db.query(models.User).filter_by(email="editor@clipradar.demo").first()
    if not user:
        raise HTTPException(500, "Demo user missing")
    return user


def _clip_dict(clip: models.SavedClip) -> dict:
    moment = clip.moment
    return {
        "id": clip.id,
        "moment_id": clip.moment_id,
        "start_seconds": clip.start_seconds,
        "end_seconds": clip.end_seconds,
        "start_label": fmt_ts(clip.start_seconds),
        "end_label": fmt_ts(clip.end_seconds),
        "duration_seconds": round(clip.end_seconds - clip.start_seconds, 1),
        "aspect_ratio": clip.aspect_ratio,
        "width": clip.width,
        "height": clip.height,
        "crop_position": clip.crop_position,
        "status": clip.status,
        "notes": clip.notes,
        "created_at": clip.created_at.isoformat() if clip.created_at else None,
        "moment": moment_to_dict(moment, include_video=True) if moment else None,
    }


@router.get("")
def list_clips(db: Session = Depends(get_db)):
    user = _demo_user(db)
    clips = (
        db.query(models.SavedClip)
        .options(
            joinedload(models.SavedClip.moment)
            .joinedload(models.Moment.video)
            .joinedload(models.Video.creator)
        )
        .filter_by(user_id=user.id)
        .order_by(models.SavedClip.created_at.desc())
        .all()
    )
    return {"clips": [_clip_dict(c) for c in clips]}


@router.post("")
def save_clip(body: SaveClipBody, db: Session = Depends(get_db)):
    user = _demo_user(db)
    moment = db.get(models.Moment, body.moment_id)
    if not moment:
        raise HTTPException(404, "Moment not found")
    clip = models.SavedClip(
        user_id=user.id,
        moment_id=body.moment_id,
        start_seconds=body.start_seconds,
        end_seconds=body.end_seconds,
        aspect_ratio=body.aspect_ratio,
        width=body.width,
        height=body.height,
        crop_position=body.crop_position,
        notes=body.notes,
        status=body.status,
    )
    moment.status = "SAVED"
    db.add(clip)
    db.commit()
    db.refresh(clip)
    clip = (
        db.query(models.SavedClip)
        .options(
            joinedload(models.SavedClip.moment)
            .joinedload(models.Moment.video)
            .joinedload(models.Video.creator)
        )
        .filter_by(id=clip.id)
        .one()
    )
    return _clip_dict(clip)


@router.patch("/{clip_id}")
def patch_clip(clip_id: int, body: PatchClipBody, db: Session = Depends(get_db)):
    user = _demo_user(db)
    clip = db.query(models.SavedClip).filter_by(id=clip_id, user_id=user.id).first()
    if not clip:
        raise HTTPException(404, "Clip not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(clip, field, value)
    db.commit()
    db.refresh(clip)
    return _clip_dict(clip)


@router.delete("/{clip_id}")
def delete_clip(clip_id: int, db: Session = Depends(get_db)):
    user = _demo_user(db)
    clip = db.query(models.SavedClip).filter_by(id=clip_id, user_id=user.id).first()
    if not clip:
        raise HTTPException(404, "Clip not found")
    db.delete(clip)
    db.commit()
    return {"ok": True}
