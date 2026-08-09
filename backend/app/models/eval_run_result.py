"""
Database model for a single eval case's result within an eval run.
"""

from sqlalchemy import Boolean, Column, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.types import JSON

from app.database.connection import Base


class EvalRunResult(Base):
    """
    A single case's outcome within an EvalRun. Denormalized (method, label)
    so history stays meaningful even if the originating EvalCase is later
    edited or deleted — eval_case_id is nullable and purely a soft reference.
    """

    __tablename__ = "eval_run_results"

    id = Column(Integer, primary_key=True, index=True)
    eval_run_id = Column(
        Integer, ForeignKey("eval_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Nulled, not cascaded: a result stays part of its run's history even
    # after the case it scored is deleted.
    eval_case_id = Column(Integer, ForeignKey("eval_cases.id", ondelete="SET NULL"), nullable=True)
    method = Column(String(20), nullable=False)
    label = Column(Text, nullable=False)
    rationale = Column(Text, nullable=True)
    score = Column(Float, nullable=True)
    is_pending = Column(Boolean, nullable=False, default=False, server_default="0")
    # The model's actual output for this case — lets a human rate Manual
    # cases against something real, and makes Rule/Judge rationales auditable.
    output_text = Column(Text, nullable=True)
    # Snapshot of the EvalCase's criteria/variables at run time, and the judge
    # model actually used (judge method only) — so later edits to the source
    # EvalCase don't retroactively change what a historical run appears to
    # have tested.
    criteria = Column(Text, nullable=True)
    variables = Column(JSONB().with_variant(JSON, "sqlite"), nullable=True)
    judge_model = Column(String(100), nullable=True)

    run = relationship("EvalRun", back_populates="results")
