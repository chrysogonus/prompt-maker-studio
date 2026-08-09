"""
User model for authentication.
"""

from datetime import UTC, datetime

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text
from sqlalchemy.orm import relationship

from app.database.connection import Base


class User(Base):
    """User model for storing authentication credentials."""

    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(UTC), nullable=False)

    # Optional — needed for password reset; users who registered before this column
    # was added will have NULL here until they provide an email address.
    email = Column(String, unique=True, index=True, nullable=True)

    # Password reset fields — reset_token stores a SHA-256 digest, never the raw token.
    reset_token = Column(String, index=True, nullable=True)
    reset_token_expiry = Column(DateTime, nullable=True)

    # Bumped whenever every existing session must stop working: a password
    # change, a password reset, or an explicit "sign out everywhere". Tokens
    # carry the value they were minted with and are rejected once it no longer
    # matches, which is what makes account recovery actually recover the
    # account — a stolen token used to stay valid until it expired on its own.
    token_version = Column(Integer, nullable=False, default=0, server_default="0")

    # Settings preferences.
    # Superseded by `llm_model` below — the model is now part of the user's
    # provider connection and is no longer exposed on the profile API. Kept
    # only because migration 019 backfills `llm_model` from it and SQLite
    # cannot drop a column without rebuilding the table.
    default_model = Column(String(100), nullable=True)
    notify_run_failure = Column(Boolean, nullable=False, default=False, server_default="0")
    # Emails are sent by a weekly cron-invoked script, not a background
    # scheduler in-process. See `make send-weekly-summary` and product/DECISIONS.md.
    notify_weekly_summary = Column(Boolean, nullable=False, default=False, server_default="0")

    # 'grid' | 'list' — initial Library view mode; validated at the API layer.
    default_library_view = Column(String(10), nullable=True)
    # 'rule' | 'judge' | 'manual' — default method for newly-added eval cases.
    default_eval_method = Column(String(20), nullable=True)
    # When true, updating a prompt in the Configuration tab automatically
    # triggers a real eval run afterward (see EvalService/eval_routes.py).
    auto_run_eval_on_update = Column(Boolean, nullable=False, default=False, server_default="0")
    notify_eval_complete = Column(Boolean, nullable=False, default=False, server_default="0")
    notify_eval_regression = Column(Boolean, nullable=False, default=False, server_default="0")

    # Bring-your-own LLM provider connection. Every AI feature resolves its
    # client from these columns via services/llm_client.py — there is no
    # operator-wide fallback key. llm_api_key_encrypted holds Fernet
    # ciphertext (services/secret_store.py), never a usable credential, and is
    # excluded from every response schema.
    llm_provider = Column(String(30), nullable=True)
    llm_base_url = Column(String(500), nullable=True)
    llm_api_key_encrypted = Column(Text, nullable=True)
    llm_model = Column(String(200), nullable=True)

    # Every user-owned table cascades from here. Account deletion promises to
    # remove all of a user's data, so anything referencing users.id must be
    # listed — an unlisted table becomes an orphan the API claims it deleted.
    prompts = relationship("Prompt", back_populates="owner", cascade="all, delete-orphan")
    playground_runs = relationship(
        "PlaygroundRun", back_populates="user", cascade="all, delete-orphan"
    )
    billed_calls = relationship("BilledCall", back_populates="user", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<User id={self.id} username={self.username!r}>"
