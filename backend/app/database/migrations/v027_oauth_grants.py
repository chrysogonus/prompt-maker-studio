"""Bind OAuth credentials to revocable account/client grants."""

from sqlalchemy import text
from sqlalchemy.schema import CreateTable

from app.database.migrations.helpers import _add_column_if_missing
from app.models.oauth import OAuthGrant


def _migration_027_oauth_grants(connection) -> None:
    connection.execute(CreateTable(OAuthGrant.__table__, if_not_exists=True))
    for table in ("oauth_authorization_codes", "oauth_refresh_tokens"):
        _add_column_if_missing(connection, table, "grant_version", "INTEGER NOT NULL DEFAULT -1")
    _add_column_if_missing(
        connection, "oauth_authorization_codes", "token_version", "INTEGER NOT NULL DEFAULT -1"
    )
    # Old approvals cannot safely inherit today's revocation state. Only
    # credentials without a version are cleared, making interrupted reruns safe.
    connection.execute(text("DELETE FROM oauth_authorization_codes WHERE grant_version = -1"))
    connection.execute(text("DELETE FROM oauth_refresh_tokens WHERE grant_version = -1"))
