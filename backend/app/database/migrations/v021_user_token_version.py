"""Historical SQLite migration v021_user_token_version."""

from __future__ import annotations

from app.database.migrations.helpers import _add_column_if_missing, _table_exists


def _migration_021_user_token_version(connection) -> None:
    """Add the session-revocation counter to users.

    Existing rows start at 0, which matches the claim absent from tokens minted
    before this column existed, so live sessions survive the upgrade rather than
    every user being signed out on deploy.
    """
    if _table_exists(connection, "users"):
        _add_column_if_missing(connection, "users", "token_version", "INTEGER NOT NULL DEFAULT 0")
