"""
Database model for the unified AI spend ledger — one row per billed OpenAI
call from any feature (Playground, eval runs, judge grading, eval-case
generation, refinement, AI import), so budget ceilings and spend analytics
see every dollar rather than only Playground runs.
"""

from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.database.connection import Base


class BilledCall(Base):
    """A single billed OpenAI API call, whatever feature triggered it."""

    __tablename__ = "billed_calls"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Which feature billed the call: playground | eval_case | eval_judge |
    # eval_generate | refine_questions | refine_draft | parse
    source = Column(String(30), nullable=False, index=True)
    # Which provider handle billed it — pricing is per (provider, model), and
    # the same model name can be served by more than one provider.
    provider = Column(String(30), nullable=False, default="openai", server_default="openai")
    model = Column(String(100), nullable=False)
    prompt_tokens = Column(Integer, nullable=False, default=0)
    completion_tokens = Column(Integer, nullable=False, default=0)
    cost_usd = Column(Float, nullable=False, default=0.0)
    created_at = Column(DateTime, default=lambda: datetime.now(UTC), index=True)

    user = relationship("User", back_populates="billed_calls")
