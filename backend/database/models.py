from datetime import datetime

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from backend.database.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, nullable=False)
    name = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    creators = relationship("UserCreator", back_populates="user")
    saved_clips = relationship("SavedClip", back_populates="user")
    export_jobs = relationship("ExportJob", back_populates="user")


class Creator(Base):
    __tablename__ = "creators"

    id = Column(Integer, primary_key=True)
    youtube_channel_id = Column(String(64), unique=True, nullable=False)
    name = Column(String(255), nullable=False)
    handle = Column(String(255), nullable=False)
    thumbnail_url = Column(String(512), nullable=True)
    description = Column(Text, default="")
    uploads_playlist_id = Column(String(64), nullable=True)
    last_scanned_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    is_demo = Column(Integer, default=0)

    videos = relationship("Video", back_populates="creator", cascade="all, delete-orphan")
    users = relationship("UserCreator", back_populates="creator")


class UserCreator(Base):
    __tablename__ = "user_creators"
    __table_args__ = (UniqueConstraint("user_id", "creator_id"),)

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    creator_id = Column(Integer, ForeignKey("creators.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="creators")
    creator = relationship("Creator", back_populates="users")


class Video(Base):
    __tablename__ = "videos"

    id = Column(Integer, primary_key=True)
    creator_id = Column(Integer, ForeignKey("creators.id"), nullable=False)
    youtube_video_id = Column(String(32), unique=True, nullable=False)
    title = Column(String(512), nullable=False)
    description = Column(Text, default="")
    thumbnail_url = Column(String(512), nullable=True)
    duration_seconds = Column(Integer, nullable=False, default=0)
    published_at = Column(DateTime, nullable=True)
    view_count = Column(Integer, default=0)
    comment_count = Column(Integer, default=0)
    scanned_at = Column(DateTime, nullable=True)
    scan_status = Column(String(32), default="NOT_SCANNED")  # NOT_SCANNED | SCANNING | SCANNED
    media_mode = Column(String(32), default="youtube")  # youtube | demo | local
    is_demo = Column(Integer, default=0)

    creator = relationship("Creator", back_populates="videos")
    comments = relationship("Comment", back_populates="video", cascade="all, delete-orphan")
    moments = relationship("Moment", back_populates="video", cascade="all, delete-orphan")
    source_media = relationship("SourceMedia", back_populates="video", cascade="all, delete-orphan")


class Comment(Base):
    __tablename__ = "comments"

    id = Column(Integer, primary_key=True)
    video_id = Column(Integer, ForeignKey("videos.id"), nullable=False)
    youtube_comment_id = Column(String(64), nullable=True)
    author_name = Column(String(255), nullable=False)
    author_avatar = Column(String(512), nullable=True)
    text = Column(Text, nullable=False)
    like_count = Column(Integer, default=0)
    published_at = Column(DateTime, nullable=True)

    video = relationship("Video", back_populates="comments")
    timestamps = relationship("CommentTimestamp", back_populates="comment", cascade="all, delete-orphan")
    moment_links = relationship("MomentComment", back_populates="comment", cascade="all, delete-orphan")


class CommentTimestamp(Base):
    __tablename__ = "comment_timestamps"

    id = Column(Integer, primary_key=True)
    comment_id = Column(Integer, ForeignKey("comments.id"), nullable=False)
    timestamp_seconds = Column(Integer, nullable=False)
    original_timestamp = Column(String(64), nullable=False)
    confidence = Column(Float, default=1.0)

    comment = relationship("Comment", back_populates="timestamps")


class Moment(Base):
    __tablename__ = "moments"

    id = Column(Integer, primary_key=True)
    video_id = Column(Integer, ForeignKey("videos.id"), nullable=False)
    representative_timestamp = Column(Integer, nullable=False)
    start_seconds = Column(Integer, nullable=False)
    end_seconds = Column(Integer, nullable=False)
    score = Column(Float, default=0.0)
    unique_commenters = Column(Integer, default=0)
    timestamp_mentions = Column(Integer, default=0)
    topic = Column(String(128), nullable=True)
    status = Column(String(32), default="NEW")  # NEW | REVIEWED | SAVED | EXPORTED
    created_at = Column(DateTime, default=datetime.utcnow)

    video = relationship("Video", back_populates="moments")
    comments = relationship("MomentComment", back_populates="moment", cascade="all, delete-orphan")
    embedding = relationship("MomentEmbedding", back_populates="moment", uselist=False, cascade="all, delete-orphan")
    saved_clips = relationship("SavedClip", back_populates="moment")


class MomentComment(Base):
    __tablename__ = "moment_comments"
    __table_args__ = (UniqueConstraint("moment_id", "comment_id"),)

    id = Column(Integer, primary_key=True)
    moment_id = Column(Integer, ForeignKey("moments.id"), nullable=False)
    comment_id = Column(Integer, ForeignKey("comments.id"), nullable=False)

    moment = relationship("Moment", back_populates="comments")
    comment = relationship("Comment", back_populates="moment_links")


class MomentEmbedding(Base):
    __tablename__ = "moment_embeddings"

    id = Column(Integer, primary_key=True)
    moment_id = Column(Integer, ForeignKey("moments.id"), unique=True, nullable=False)
    embedding = Column(Text, nullable=False)  # JSON array for MVP

    moment = relationship("Moment", back_populates="embedding")


class MomentRelation(Base):
    __tablename__ = "moment_relations"
    __table_args__ = (UniqueConstraint("moment_a_id", "moment_b_id"),)

    id = Column(Integer, primary_key=True)
    moment_a_id = Column(Integer, ForeignKey("moments.id"), nullable=False)
    moment_b_id = Column(Integer, ForeignKey("moments.id"), nullable=False)
    similarity = Column(Float, nullable=False)
    relationship_type = Column(String(32), default="RELATED")  # VERY_SIMILAR | SIMILAR | RELATED


class SourceMedia(Base):
    __tablename__ = "source_media"

    id = Column(Integer, primary_key=True)
    video_id = Column(Integer, ForeignKey("videos.id"), nullable=False)
    storage_type = Column(String(32), default="local")  # local | upload | cloud
    path = Column(String(1024), nullable=False)
    duration_seconds = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    video = relationship("Video", back_populates="source_media")


class SavedClip(Base):
    __tablename__ = "saved_clips"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    moment_id = Column(Integer, ForeignKey("moments.id"), nullable=False)
    start_seconds = Column(Float, nullable=False)
    end_seconds = Column(Float, nullable=False)
    aspect_ratio = Column(String(16), default="16:9")
    width = Column(Integer, default=1920)
    height = Column(Integer, default=1080)
    crop_position = Column(String(32), default="CENTER")
    status = Column(String(32), default="TO_EDIT")  # TO_EDIT | IN_EDITING | EXPORTED | DONE
    notes = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="saved_clips")
    moment = relationship("Moment", back_populates="saved_clips")
    export_jobs = relationship("ExportJob", back_populates="saved_clip")


class ExportJob(Base):
    __tablename__ = "export_jobs"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    video_id = Column(Integer, ForeignKey("videos.id"), nullable=True)
    saved_clip_id = Column(Integer, ForeignKey("saved_clips.id"), nullable=True)
    source_media_id = Column(Integer, ForeignKey("source_media.id"), nullable=True)
    start_seconds = Column(Float, nullable=False)
    end_seconds = Column(Float, nullable=False)
    aspect_ratio = Column(String(16), default="16:9")
    width = Column(Integer, default=1920)
    height = Column(Integer, default=1080)
    crop_position = Column(String(32), default="CENTER")
    status = Column(String(32), default="QUEUED")  # QUEUED | PROCESSING | COMPLETED | FAILED
    progress = Column(Integer, default=0)
    output_path = Column(String(1024), nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="export_jobs")
    saved_clip = relationship("SavedClip", back_populates="export_jobs")
