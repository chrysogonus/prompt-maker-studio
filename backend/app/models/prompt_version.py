"""
Database model for prompt version snapshots.
"""

from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.types import JSON

from app.database.connection import Base


class PromptVersion(Base):
    """
    A historical snapshot of a prompt's fields/generated_prompt, captured
    just before an edit overwrites the live `prompts` row. The live row is
    always the "current" state; rows here are prior states.
    """

    __tablename__ = "prompt_versions"

    id = Column(Integer, primary_key=True, index=True)
    prompt_id = Column(
        Integer, ForeignKey("prompts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version_number = Column(Integer, nullable=False)
    note = Column(String(255), nullable=True)
    # Nulled rather than cascaded when the author is deleted: the version
    # belongs to the prompt, which has its own owner cascade.
    author_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    fields = Column(JSONB().with_variant(JSON, "sqlite"), nullable=False)
    generated_prompt = Column(Text, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(UTC))

    prompt = relationship("Prompt", back_populates="versions")
    author = relationship("User")
