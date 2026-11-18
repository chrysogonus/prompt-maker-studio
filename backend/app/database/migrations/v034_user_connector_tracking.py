"""Add the connector last-use date and the sign-up referral answer to accounts."""

from app.database.migrations.helpers import _add_column_if_missing, _table_exists


def _migration_034_user_connector_tracking(connection) -> None:
    if _table_exists(connection, "users"):
        _add_column_if_missing(connection, "users", "last_mcp_use_date", "DATE")
        _add_column_if_missing(connection, "users", "referral_source", "VARCHAR(30)")
