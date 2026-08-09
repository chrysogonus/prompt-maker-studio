"""
Database model for Playground run records — one row per attempted
prompt execution against a model, used for both display (Playground output
history) and Dashboard usage analytics.
"""

from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.types import JSON

from app.database.connection import Base


class PlaygroundRun(Base):
    """A single Playground execution attempt, successful or not."""

    __tablename__ = "playground_runs"

    id = Column(Integer, primary_key=True, index=True)
    prompt_id = Column(
        Integer, ForeignKey("prompts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    model = Column(String(100), nullable=False)
    input_variables = Column(JSONB().with_variant(JSON, "sqlite"), nullable=True)
    output_text = Column(Text, nullable=False, default="")
    latency_ms = Column(Integer, nullable=False, default=0)
    prompt_tokens = Column(Integer, nullable=False, default=0)
    completion_tokens = Column(Integer, nullable=False, default=0)
    cost_usd = Column(Float, nullable=False, default=0.0)
    # "success" or "error" — see PlaygroundRunError handling in routes.py
    status = Column(String(20), nullable=False, default="success")
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(UTC), index=True)

    prompt = relationship("Prompt", back_populates="playground_runs")
    user = relationship("User", back_populates="playground_runs")
