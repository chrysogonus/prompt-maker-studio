"""Tests for the built-in SQLite migration runner."""

import json
import pathlib
import sqlite3

import pytest
from sqlalchemy import create_engine, text

from app.database.connection import Base
from app.database.migrations import run_migrations

# Registers every table on Base.metadata so create_all() below builds the full
# schema; app.main is the equivalent entry point in production.
from app.models import prompt_id_sequence, user  # noqa: F401


def _columns(connection, table_name: str) -> set[str]:
    rows = connection.execute(text(f'PRAGMA table_info("{table_name}")')).fetchall()
    return {row[1] for row in rows}


def _migration_versions(connection) -> set[str]:
    rows = connection.execute(text("SELECT version FROM schema_migrations")).fetchall()
    return {row[0] for row in rows}


def _table_exists(connection, table_name: str) -> bool:
    row = connection.execute(
        text("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = :table_name"),
        {"table_name": table_name},
    ).first()
    return row is not None


def test_run_migrations_adds_current_columns_to_legacy_database(tmp_path):
    """Legacy SQLite databases get current columns, indexes, and migration records."""
    db_path = tmp_path / "legacy.db"
    engine = create_engine(f"sqlite:///{db_path}")

    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE users ("
                "id INTEGER PRIMARY KEY, "
                "username VARCHAR NOT NULL UNIQUE, "
                "hashed_password VARCHAR NOT NULL, "
                "created_at DATETIME NOT NULL"
                ")"
            )
        )
        connection.execute(
            text(
                "CREATE TABLE prompts ("
                "id INTEGER PRIMARY KEY, "
                "goal TEXT, "
                "style TEXT, "
                "generated_prompt TEXT NOT NULL, "
                "created_at DATETIME"
                ")"
            )
        )
        connection.execute(
            text(
                "INSERT INTO users (id, username, hashed_password, created_at) "
                "VALUES (1, 'owner', 'hash', '2026-01-01T00:00:00')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO prompts (id, goal, style, generated_prompt, created_at) "
                "VALUES (10, 'write a test', 'direct', '<GOAL>write a test</GOAL>', "
                "'2026-01-01T00:00:00')"
            )
        )

    run_migrations(engine)

    with engine.connect() as connection:
        assert {
            "fields",
            "user_id",
            "name",
            "folder",
            "is_favorite",
            "tags",
            "variable_metadata",
        }.issubset(_columns(connection, "prompts"))
        assert {"email", "reset_token", "reset_token_expiry", "token_version"}.issubset(
            _columns(connection, "users")
        )

        row = (
            connection.execute(text('SELECT fields, user_id, name FROM "prompts" WHERE id = 10'))
            .mappings()
            .one()
        )
        assert json.loads(row["fields"]) == [
            {"name": "goal", "content": "write a test"},
            {"name": "style", "content": "direct"},
        ]
        assert row["user_id"] == 1
        assert row["name"] is None
        assert _migration_versions(connection) == {
            "001_dynamic_prompt_fields",
            "002_prompt_user_id",
            "003_prompt_name",
            "004_user_email_reset",
            "005_prompt_updated_at",
            "006_prompt_folder",
            "007_prompt_favorite",
            "008_prompt_tags",
            "009_prompt_versions",
            "010_playground_runs",
            "011_user_preferences",
            "012_prompt_variable_metadata",
            "013_user_eval_and_library_preferences",
            "014_eval_tables",
            "015_eval_run_metadata",
            "016_billed_calls",
            "017_eval_case_metadata",
            "018_prompt_id_sequence",
            "019_user_llm_connection",
            "020_delete_cascades",
            "021_user_token_version",
        }
        assert "updated_at" in _columns(connection, "prompts")
        assert _table_exists(connection, "prompt_versions")
        assert _table_exists(connection, "playground_runs")
        assert {"default_model", "notify_run_failure", "notify_weekly_summary"}.issubset(
            _columns(connection, "users")
        )
        assert {
            "default_library_view",
            "default_eval_method",
            "auto_run_eval_on_update",
            "notify_eval_complete",
            "notify_eval_regression",
        }.issubset(_columns(connection, "users"))
        assert _table_exists(connection, "eval_cases")
        assert _table_exists(connection, "eval_runs")
        assert _table_exists(connection, "eval_run_results")
        assert {"model", "total_latency_ms", "total_prompt_tokens", "total_cost_usd"}.issubset(
            _columns(connection, "eval_runs")
        )
        assert {"criteria", "variables", "judge_model"}.issubset(
            _columns(connection, "eval_run_results")
        )
        assert _table_exists(connection, "billed_calls")
        assert {"name", "intentionally_empty"}.issubset(_columns(connection, "eval_cases"))
        assert _table_exists(connection, "prompt_id_sequence")
        assert {
            "user_id",
            "source",
            "provider",
            "model",
            "prompt_tokens",
            "completion_tokens",
            "cost_usd",
            "created_at",
        }.issubset(_columns(connection, "billed_calls"))
        assert {
            "llm_provider",
            "llm_base_url",
            "llm_api_key_encrypted",
            "llm_model",
        }.issubset(_columns(connection, "users"))

        # Existing users are pre-pointed at OpenAI so the Settings connection
        # form opens populated, but deliberately keyless — the operator's
        # shared key is never fanned out into user rows. See
        # product/DECISIONS.md.
        user_row = (
            connection.execute(
                text('SELECT llm_provider, llm_model, llm_api_key_encrypted FROM "users"')
            )
            .mappings()
            .first()
        )
        assert user_row["llm_provider"] == "openai"
        assert user_row["llm_model"]
        assert user_row["llm_api_key_encrypted"] is None

        # Existing rows backfill is_favorite to false via the column DEFAULT.
        favorite_row = connection.execute(
            text('SELECT is_favorite FROM "prompts" WHERE id = 10')
        ).one()
        assert favorite_row[0] == 0


def test_run_migrations_is_idempotent_on_current_database(tmp_path):
    """Running migrations repeatedly does not duplicate records or fail."""
    db_path = tmp_path / "current.db"
    engine = create_engine(f"sqlite:///{db_path}")

    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE users ("
                "id INTEGER PRIMARY KEY, "
                "username VARCHAR NOT NULL UNIQUE, "
                "hashed_password VARCHAR NOT NULL, "
                "created_at DATETIME NOT NULL, "
                "email VARCHAR, "
                "reset_token VARCHAR, "
                "reset_token_expiry DATETIME, "
                "default_model VARCHAR(100), "
                "notify_run_failure BOOLEAN NOT NULL DEFAULT 0, "
                "notify_weekly_summary BOOLEAN NOT NULL DEFAULT 0, "
                "default_library_view VARCHAR(10), "
                "default_eval_method VARCHAR(20), "
                "auto_run_eval_on_update BOOLEAN NOT NULL DEFAULT 0, "
                "notify_eval_complete BOOLEAN NOT NULL DEFAULT 0, "
                "notify_eval_regression BOOLEAN NOT NULL DEFAULT 0"
                ")"
            )
        )
        connection.execute(
            text(
                "CREATE TABLE prompts ("
                "id INTEGER PRIMARY KEY, "
                "user_id INTEGER NOT NULL, "
                "fields JSON NOT NULL, "
                "generated_prompt TEXT NOT NULL, "
                "name VARCHAR(255), "
                "created_at DATETIME, "
                "updated_at DATETIME, "
                "folder VARCHAR(255), "
                "is_favorite BOOLEAN NOT NULL DEFAULT 0, "
                "tags JSON"
                ")"
            )
        )
        connection.execute(
            text(
                "CREATE TABLE eval_cases ("
                "id INTEGER PRIMARY KEY, "
                "prompt_id INTEGER NOT NULL, "
                "method VARCHAR(20) NOT NULL, "
                "criteria TEXT, "
                "variables JSON, "
                "position INTEGER NOT NULL DEFAULT 0, "
                "created_at DATETIME"
                ")"
            )
        )
        connection.execute(
            text(
                "CREATE TABLE eval_runs ("
                "id INTEGER PRIMARY KEY, "
                "prompt_id INTEGER NOT NULL, "
                "prompt_version_number INTEGER NOT NULL DEFAULT 0, "
                "score REAL, "
                "created_at DATETIME"
                ")"
            )
        )
        connection.execute(
            text(
                "CREATE TABLE eval_run_results ("
                "id INTEGER PRIMARY KEY, "
                "eval_run_id INTEGER NOT NULL, "
                "eval_case_id INTEGER, "
                "method VARCHAR(20) NOT NULL, "
                "label TEXT NOT NULL, "
                "rationale TEXT, "
                "score REAL, "
                "is_pending BOOLEAN NOT NULL DEFAULT 0, "
                "output_text TEXT"
                ")"
            )
        )

    run_migrations(engine)
    run_migrations(engine)

    with engine.connect() as connection:
        versions = connection.execute(text("SELECT version FROM schema_migrations")).fetchall()
        assert len(versions) == 21
        assert {
            "fields",
            "user_id",
            "name",
            "updated_at",
            "folder",
            "is_favorite",
            "tags",
            "variable_metadata",
        }.issubset(_columns(connection, "prompts"))
        assert {"email", "reset_token", "reset_token_expiry", "token_version"}.issubset(
            _columns(connection, "users")
        )
        assert _table_exists(connection, "prompt_versions")
        assert _table_exists(connection, "playground_runs")
        assert _table_exists(connection, "eval_cases")
        assert _table_exists(connection, "eval_runs")
        assert _table_exists(connection, "eval_run_results")
        assert _table_exists(connection, "billed_calls")
        assert {"name", "intentionally_empty"}.issubset(_columns(connection, "eval_cases"))
        assert _table_exists(connection, "prompt_id_sequence")


def test_migration_020_survives_modern_alter_table_rename_semantics():
    """SQLite >= 3.25 rewrites *other* tables' foreign keys when a table is
    renamed, which silently repoints them at the rebuild's temporary table.
    Migration 020 sets legacy_alter_table to opt out.

    Asserted rather than left to whatever SQLite the host happens to ship:
    3.37 tolerated the default and 3.46 did not, so this failed only inside the
    container, on boot, after passing locally.
    """
    source = pathlib.Path("app/database/migrations.py").read_text()
    assert "PRAGMA legacy_alter_table=ON" in source
    assert "PRAGMA legacy_alter_table=OFF" in source
    if sqlite3.sqlite_version_info < (3, 25):  # pragma: no cover - ancient hosts only
        pytest.skip("This SQLite predates the reference-rewriting rename")


def test_migration_020_adds_cascades_and_clears_orphans(tmp_path):
    """Migration 020 has to fix both halves of the deletion finding: the schema
    had no ON DELETE actions, and databases that ran without foreign-key
    enforcement already contain rows pointing at deleted parents."""
    engine = create_engine(f"sqlite:///{tmp_path / 'orphans.db'}")

    with engine.begin() as connection:
        connection.execute(text("PRAGMA foreign_keys=OFF"))
        Base.metadata.create_all(bind=connection)
        # A user and their prompt, then rows whose parents never existed —
        # exactly what the pre-enforcement schema allowed to accumulate.
        connection.execute(
            text(
                "INSERT INTO users (id, username, email, hashed_password, created_at) "
                "VALUES (1, 'keeper', 'keeper@example.com', 'x', '2026-01-01 00:00:00')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO prompts (id, user_id, fields, generated_prompt) "
                "VALUES (1, 1, '[]', 'p')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO playground_runs "
                "(id, prompt_id, user_id, model, output_text, latency_ms, "
                "prompt_tokens, completion_tokens, cost_usd, status) "
                "VALUES (1, 1, 1, 'm', 'kept', 0, 0, 0, 0.0, 'success'), "
                "(2, 999, 999, 'm', 'orphan', 0, 0, 0, 0.0, 'success')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO billed_calls (id, user_id, source, provider, model, cost_usd, "
                "prompt_tokens, completion_tokens) "
                "VALUES (1, 1, 'playground', 'openai', 'm', 1.0, 0, 0), "
                "(2, 999, 'playground', 'openai', 'm', 2.0, 0, 0)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO prompt_versions "
                "(id, prompt_id, author_user_id, version_number, fields, generated_prompt) "
                "VALUES (1, 1, 999, 1, '[]', 'v')"
            )
        )

    run_migrations(engine)

    with engine.connect() as connection:
        # Orphans removed, valid rows untouched.
        assert connection.execute(text("SELECT COUNT(*) FROM playground_runs")).scalar() == 1
        assert connection.execute(text("SELECT COUNT(*) FROM billed_calls")).scalar() == 1
        # A dangling nullable reference is cleared, not deleted with its row.
        assert connection.execute(text("SELECT COUNT(*) FROM prompt_versions")).scalar() == 1
        assert (
            connection.execute(text("SELECT author_user_id FROM prompt_versions")).scalar() is None
        )

        # And the rebuilt schema now carries the ON DELETE actions.
        for table in ("playground_runs", "billed_calls", "prompts"):
            keys = connection.execute(text(f"PRAGMA foreign_key_list({table})")).mappings().all()
            assert keys, table
            assert all(key["on_delete"] == "CASCADE" for key in keys), (table, keys)

    # With enforcement on, deleting the user must now take everything with it.
    with engine.begin() as connection:
        connection.execute(text("PRAGMA foreign_keys=ON"))
        connection.execute(text("DELETE FROM users WHERE id = 1"))

    with engine.connect() as connection:
        for table in ("prompts", "playground_runs", "billed_calls", "prompt_versions"):
            assert connection.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar() == 0, table
