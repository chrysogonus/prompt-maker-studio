"""Monotonic prompt identifier allocator for SQLite deployments."""

from sqlalchemy import CheckConstraint, Column, Integer

from app.database.connection import Base


class PromptIdSequence(Base):
    """Single-row high-water mark that prevents deleted prompt IDs being reused."""

    __tablename__ = "prompt_id_sequence"
    __table_args__ = (CheckConstraint("singleton = 1", name="ck_prompt_id_sequence_singleton"),)

    singleton = Column(Integer, primary_key=True)
    last_id = Column(Integer, nullable=False, default=0)
