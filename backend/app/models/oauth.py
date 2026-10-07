"""
Database models for the OAuth authorization server that lets MCP clients such
as ChatGPT act on a user's prompt library. See docs/mcp.md.

Authorization codes and refresh tokens are stored as SHA-256 digests, like
password-reset tokens: a copy of this table is not a set of usable credentials.
Access tokens are short-lived JWTs and are not stored at all.
"""

from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.database.connection import Base


class OAuthClient(Base):
    """A client registered through dynamic client registration (RFC 7591)."""

    __tablename__ = "oauth_clients"

    client_id = Column(String(64), primary_key=True)
    # The full registration record as the MCP SDK models it
    # (OAuthClientInformationFull), so new metadata fields need no migration.
    client_info = Column(Text, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(UTC), nullable=False)


class OAuthAuthorizationCode(Base):
    """A one-time code issued after the user approves a client; deleted on exchange."""

    __tablename__ = "oauth_authorization_codes"

    code_hash = Column(String(64), primary_key=True)
    client_id = Column(
        String(64), ForeignKey("oauth_clients.client_id", ondelete="CASCADE"), nullable=False
    )
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    redirect_uri = Column(Text, nullable=False)
    redirect_uri_provided_explicitly = Column(Boolean, nullable=False)
    code_challenge = Column(String(128), nullable=False)
    scopes = Column(JSON, nullable=False, default=list)
    resource = Column(Text, nullable=True)
    expires_at = Column(DateTime, nullable=False)

    user = relationship("User", back_populates="oauth_authorization_codes")


class OAuthRefreshToken(Base):
    """A refresh token; rotated on every use, so each row is redeemable once."""

    __tablename__ = "oauth_refresh_tokens"

    token_hash = Column(String(64), primary_key=True)
    client_id = Column(
        String(64), ForeignKey("oauth_clients.client_id", ondelete="CASCADE"), nullable=False
    )
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    scopes = Column(JSON, nullable=False, default=list)
    resource = Column(Text, nullable=True)
    # users.token_version when issued: a password change, reset, or "sign out
    # everywhere" bumps it and so revokes the connection along with sessions.
    token_version = Column(Integer, nullable=False)
    expires_at = Column(DateTime, nullable=False)

    user = relationship("User", back_populates="oauth_refresh_tokens")
