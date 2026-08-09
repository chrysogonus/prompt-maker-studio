"""
Database model for per-prompt evaluation test cases.
"""

from datetime import UTC, datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.types import JSON

from app.database.connection import Base


class EvalCase(Base):
    """
    A single test case for the Evaluate tab: a scoring method (rule/judge/
    manual), the criteria that method scores against, and the template
    variable values used to compile the prompt before running it.
    """

    __tablename__ = "eval_cases"

    id = Column(Integer, primary_key=True, index=True)
    prompt_id = Column(
        Integer, ForeignKey("prompts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 'rule' | 'judge' | 'manual'
    method = Column(String(20), nullable=False)
    name = Column(String(100), nullable=True)
    # Rule: comma-separated checks — plain substring, !forbidden, ~regex, or
    # {json}; commas inside brackets are literal. Judge: a grading instruction.
    # Manual: unused.
    criteria = Column(Text, nullable=True)
    variables = Column(JSONB().with_variant(JSON, "sqlite"), nullable=True)
    intentionally_empty = Column(Boolean, nullable=False, default=False, server_default="0")
    position = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=lambda: datetime.now(UTC))

    prompt = relationship("Prompt", back_populates="eval_cases")
