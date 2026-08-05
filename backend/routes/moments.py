from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from backend.database.database import get_db
from backend.database import models
from backend.services.serializers import comment_to_dict, moment_to_dict

router = APIRouter(prefix="/api/moments", tags=["moments"])


def _related_for(db: Session, moment_id: int) -> list[dict]:
    relations = (
        db.query(models.MomentRelation)
        .filter(
            (models.MomentRelation.moment_a_id == moment_id)
            | (models.MomentRelation.moment_b_id == moment_id)
        )
        .all()
    )
    related = []
    for rel in relations:
        other_id = rel.moment_b_id if rel.moment_a_id == moment_id else rel.moment_a_id
        other = (
            db.query(models.Moment)
            .options(joinedload(models.Moment.video).joinedload(models.Video.creator))
            .filter_by(id=other_id)
            .first()
        )
        if not other:
            continue
        item = moment_to_dict(other, include_video=True)
        item["similarity"] = round(rel.similarity * 100)
        item["relationship_type"] = rel.relationship_type
        related.append(item)
    related.sort(key=lambda r: r["similarity"], reverse=True)
    return related


def _comments_for(db: Session, moment_id: int) -> list[dict]:
    links = (
        db.query(models.MomentComment)
        .options(
            joinedload(models.MomentComment.comment).joinedload(models.Comment.timestamps)
        )
        .filter_by(moment_id=moment_id)
        .all()
    )
    comments = []
    for link in links:
        c = link.comment
        comments.append(comment_to_dict(c))
    comments.sort(key=lambda c: c["like_count"], reverse=True)
    return comments


@router.get("/{moment_id}")
def get_moment(moment_id: int, db: Session = Depends(get_db)):
    moment = (
        db.query(models.Moment)
        .options(joinedload(models.Moment.video).joinedload(models.Video.creator))
        .filter_by(id=moment_id)
        .first()
    )
    if not moment:
        raise HTTPException(404, "Moment not found")
    return moment_to_dict(
        moment,
        comments=_comments_for(db, moment.id),
        related=_related_for(db, moment.id),
        include_video=True,
    )


@router.get("/{moment_id}/comments")
def moment_comments(moment_id: int, db: Session = Depends(get_db)):
    moment = db.get(models.Moment, moment_id)
    if not moment:
        raise HTTPException(404, "Moment not found")
    return {"comments": _comments_for(db, moment_id)}


@router.get("/{moment_id}/related")
def moment_related(moment_id: int, db: Session = Depends(get_db)):
    moment = db.get(models.Moment, moment_id)
    if not moment:
        raise HTTPException(404, "Moment not found")
    return {"related": _related_for(db, moment_id)}
