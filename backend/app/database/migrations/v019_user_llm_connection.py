"""Historical SQLite migration v019_user_llm_connection."""

from __future__ import annotations

from sqlalchemy import text

from app.database.migrations.helpers import _add_column_if_missing, _table_exists


def _migration_019_user_llm_connection(connection) -> None:
    """Add per-user bring-your-own LLM provider connection columns, and record
    the provider on every billed call.

    Existing rows are pre-filled with the `openai` provider and the user's
    existing default_model so the Settings form opens already pointing at what
    they were implicitly using — but deliberately *without* an API key. The
    operator's shared OPENAI_API_KEY is never copied into user rows: fanning
    one credential out across N database rows is a worse outcome than a
    signposted "add your API key" empty state. See product/DECISIONS.md.

    billed_calls rows predating this all went through the operator's OpenAI
    key, so backfilling them to 'openai' is accurate rather than a guess.
    """
    if _table_exists(connection, "users"):
        _add_column_if_missing(connection, "users", "llm_provider", "VARCHAR(30)")
        _add_column_if_missing(connection, "users", "llm_base_url", "VARCHAR(500)")
        _add_column_if_missing(connection, "users", "llm_api_key_encrypted", "TEXT")
        _add_column_if_missing(connection, "users", "llm_model", "VARCHAR(200)")
        connection.execute(
            text(
                "UPDATE \"users\" SET llm_provider = 'openai', "
                "llm_model = COALESCE(default_model, 'gpt-4o-mini') "
                "WHERE llm_provider IS NULL"
            )
        )

    if _table_exists(connection, "billed_calls"):
        _add_column_if_missing(
            connection, "billed_calls", "provider", "VARCHAR(30) NOT NULL DEFAULT 'openai'"
        )
