"""
Spend ledger for AI calls made by signed-out visitors (the free refiner).

Kept apart from `billed_calls`, which belongs to an account: these rows have no
user, and deliberately record nothing about the visitor — no IP address, no
prompt text — only what is needed for budget ceilings and daily caps.
"""

from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, Float, Integer, String

from app.database.connection import Base


class PublicBilledCall(Base):
    """One billed call on the server default, made without an account."""

    __tablename__ = "public_billed_calls"

    id = Column(Integer, primary_key=True, index=True)
    # public_refine_questions | public_refine_draft
    source = Column(String(30), nullable=False, index=True)
    provider = Column(String(30), nullable=False)
    model = Column(String(100), nullable=False)
    prompt_tokens = Column(Integer, nullable=False, default=0)
    completion_tokens = Column(Integer, nullable=False, default=0)
    cost_usd = Column(Float, nullable=False, default=0.0)
    created_at = Column(DateTime, default=lambda: datetime.now(UTC), index=True)
