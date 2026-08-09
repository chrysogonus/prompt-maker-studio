"""
Database model for storing generated prompts.
"""

from datetime import UTC, datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.types import JSON

from app.database.connection import Base


class Prompt(Base):
    """
    Represents a generated prompt with its configuration.
    Each prompt is owned by a single user; queries must always be scoped
    by user_id to enforce data isolation.

    A prompt with a non-null ``name`` is considered a "saved" prompt and
    appears in the saved-prompts sidebar. Unnamed prompts are only visible
    in the history view.
    """

    __tablename__ = "prompts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Use JSONB for PostgreSQL, JSON for others (like SQLite in tests)
    fields = Column(
        JSONB().with_variant(JSON, "sqlite"), nullable=False
    )  # Stores array of {name, content} objects
    generated_prompt = Column(Text, nullable=False)
    # Optional user-assigned name; NULL means the prompt is unnamed (history-only)
    name = Column(String(255), nullable=True, index=True)
    created_at = Column(DateTime, default=lambda: datetime.now(UTC))
    updated_at = Column(DateTime, nullable=True)
    # Free-text organizational label, shown as a folder badge in the Library.
    folder = Column(String(255), nullable=True, index=True)
    is_favorite = Column(Boolean, nullable=False, default=False, server_default="0")
    # List of free-text tag strings; mirrors the `fields` JSON column pattern.
    tags = Column(JSONB().with_variant(JSON, "sqlite"), nullable=True)
    # Per-variable type/description, keyed by the variable's name as derived by
    # frontend/src/lib/placeholders.ts. Shape: {name: {type, description}}.
    variable_metadata = Column(JSONB().with_variant(JSON, "sqlite"), nullable=True)

    owner = relationship("User", back_populates="prompts")
    versions = relationship("PromptVersion", back_populates="prompt", cascade="all, delete-orphan")
    playground_runs = relationship(
        "PlaygroundRun", back_populates="prompt", cascade="all, delete-orphan"
    )
    eval_cases = relationship("EvalCase", back_populates="prompt", cascade="all, delete-orphan")
    eval_runs = relationship("EvalRun", back_populates="prompt", cascade="all, delete-orphan")
