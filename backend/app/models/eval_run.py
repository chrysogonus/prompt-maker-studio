"""
Database model for evaluation run records.
"""

from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.database.connection import Base


class EvalRun(Base):
    """
    One "Run evaluation" attempt against a prompt's eval cases. Holds an
    aggregate score (mean of its results) which is None while any result
    is still pending a manual rating.
    """

    __tablename__ = "eval_runs"

    id = Column(Integer, primary_key=True, index=True)
    prompt_id = Column(
        Integer, ForeignKey("prompts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Snapshot of the prompt's PromptVersion.version_number at run time.
    prompt_version_number = Column(Integer, nullable=False, default=0)
    score = Column(Float, nullable=True)
    # Resolved execution model plus aggregated cost/latency/tokens across every
    # case run (and judge grading call) in this run — lets a user tell whether
    # a score changed because of the prompt or because execution conditions did.
    model = Column(String(100), nullable=False, default="")
    total_latency_ms = Column(Integer, nullable=False, default=0)
    total_prompt_tokens = Column(Integer, nullable=False, default=0)
    total_completion_tokens = Column(Integer, nullable=False, default=0)
    total_cost_usd = Column(Float, nullable=False, default=0.0)
    created_at = Column(DateTime, default=lambda: datetime.now(UTC), index=True)

    prompt = relationship("Prompt", back_populates="eval_runs")
    results = relationship("EvalRunResult", back_populates="run", cascade="all, delete-orphan")
