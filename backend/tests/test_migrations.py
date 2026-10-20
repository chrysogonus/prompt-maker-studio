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


def test_content_recency_migration_backfills_once_and_preserves_concurrency(tmp_path):
    from app.database.migrations.v028_prompt_content_updated_at import (
        _migration_028_prompt_content_updated_at,
    )

    engine = create_engine(f"sqlite:///{tmp_path / 'content-recency.db'}")
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE prompts (id INTEGER PRIMARY KEY, created_at DATETIME, updated_at DATETIME)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO prompts VALUES (1, '2026-10-01', '2026-10-02'), (2, '2026-10-03', NULL)"
            )
        )
        _migration_028_prompt_content_updated_at(connection)
        assert connection.execute(
            text("SELECT content_updated_at FROM prompts ORDER BY id")
        ).scalars().all() == ["2026-10-02", "2026-10-03"]
        connection.execute(text("UPDATE prompts SET updated_at = '2026-10-04' WHERE id = 1"))
        _migration_028_prompt_content_updated_at(connection)
        assert connection.execute(
            text("SELECT content_updated_at, updated_at FROM prompts WHERE id = 1")
        ).one() == ("2026-10-02", "2026-10-04")


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
            connection.execute(
                text(
                    'SELECT fields, generated_prompt, user_id, name, folder FROM "prompts" '
                    "WHERE id = 10"
                )
            )
            .mappings()
            .one()
        )
        # 001's backfill no longer renders to the stored text, so 023 keeps it as
        # a version snapshot and makes the text itself the single section.
        snapshot = (
            connection.execute(
                text("SELECT fields, generated_prompt FROM prompt_versions WHERE prompt_id = 10")
            )
            .mappings()
            .one()
        )
        assert json.loads(snapshot["fields"]) == [
            {"name": "goal", "content": "write a test"},
            {"name": "style", "content": "direct"},
        ]
        assert snapshot["generated_prompt"] == "<GOAL>write a test</GOAL>"
        assert json.loads(row["fields"]) == [
            {"name": "prompt", "content": "<GOAL>write a test</GOAL>"}
        ]
        assert row["generated_prompt"] == "<PROMPT>\n<GOAL>write a test</GOAL>\n</PROMPT>"
        assert row["user_id"] == 1
        assert row["name"] == "Untitled (1 Jan 2026, 00:00 UTC)"
        assert row["folder"] == "Recovered history"
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
            "022_oauth_tables",
            "023_recover_drifted_prompt_sections",
            "024_recover_unnamed_prompts",
            "025_version_notes",
            "026_user_auth_subject",
            "027_oauth_grants",
            "028_prompt_content_updated_at",
            "029_user_llm_workspace",
            "030_eval_human_score",
            "031_eval_tested_prompt",
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
        for oauth_table in ("oauth_clients", "oauth_authorization_codes", "oauth_refresh_tokens"):
            assert _table_exists(connection, oauth_table)
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
        assert len(versions) == 31
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
    source = (
        pathlib.Path(__file__).resolve().parents[1]
        / "app/database/migrations/v020_delete_cascades.py"
    ).read_text()
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
                "INSERT INTO users (id, auth_subject, username, email, hashed_password, created_at) "
                "VALUES (1, '00000000-0000-4000-8000-000000000001', "
                "'keeper', 'keeper@example.com', 'x', '2026-01-01 00:00:00')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO prompts (id, user_id, fields, generated_prompt) "
                "VALUES (1, 1, '[]', '')"
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


def _current_database(tmp_path):
    """A fully migrated-shape database with one user, as a live deployment has."""
    engine = create_engine(f"sqlite:///{tmp_path / 'current.db'}")
    with engine.begin() as connection:
        Base.metadata.create_all(bind=connection)
        connection.execute(
            text(
                "INSERT INTO users (id, auth_subject, username, email, hashed_password, created_at) "
                "VALUES (1, '00000000-0000-4000-8000-000000000001', "
                "'owner', 'owner@example.com', 'x', '2026-01-01 00:00:00')"
            )
        )
    return engine


def _insert_prompt(connection, prompt_id, fields, generated_prompt, **columns):
    values = {
        "id": prompt_id,
        "user_id": 1,
        "fields": json.dumps(fields),
        "generated_prompt": generated_prompt,
        "name": "Saved",
        "created_at": "2026-03-14 09:12:33.000000",
        "updated_at": "2026-03-15 10:00:00.000000",
        **columns,
    }
    names = ", ".join(values)
    placeholders = ", ".join(f":{name}" for name in values)
    connection.execute(text(f"INSERT INTO prompts ({names}) VALUES ({placeholders})"), values)


def _prompt(connection, prompt_id):
    row = (
        connection.execute(text("SELECT * FROM prompts WHERE id = :id"), {"id": prompt_id})
        .mappings()
        .one()
    )
    return {**row, "fields": json.loads(row["fields"])}


def _snapshots(connection, prompt_id):
    rows = connection.execute(
        text(
            "SELECT version_number, note, author_user_id, fields, generated_prompt "
            "FROM prompt_versions WHERE prompt_id = :id ORDER BY version_number"
        ),
        {"id": prompt_id},
    ).mappings()
    return [{**row, "fields": json.loads(row["fields"])} for row in rows]


def test_migration_023_splits_edited_text_into_sections_when_it_round_trips(tmp_path):
    """Text edited in the raw editor but still in the rendered shape becomes the
    sections, and the stale fields survive in a snapshot."""
    engine = _current_database(tmp_path)
    edited = "<ROLE>\nYou are a patient tutor.\n</ROLE>\n\n<TASK>\nExplain {{topic}}.\n</TASK>"
    stale = [{"name": "role", "content": "You are a tutor."}]
    with engine.begin() as connection:
        _insert_prompt(connection, 1, stale, edited)
        connection.execute(
            text(
                "INSERT INTO prompt_versions "
                "(prompt_id, version_number, author_user_id, fields, generated_prompt) "
                "VALUES (1, 1, 1, '[]', 'older')"
            )
        )

    run_migrations(engine)

    with engine.connect() as connection:
        prompt = _prompt(connection, 1)
        assert prompt["fields"] == [
            {"name": "role", "content": "You are a patient tutor."},
            {"name": "task", "content": "Explain {{topic}}."},
        ]
        assert prompt["generated_prompt"] == edited
        assert prompt["updated_at"] == "2026-03-15 10:00:00.000000"
        snapshot = _snapshots(connection, 1)[-1]
        assert snapshot == {
            "version_number": 2,
            "note": "Before section recovery",
            "author_user_id": 1,
            "fields": stale,
            "generated_prompt": edited,
        }


@pytest.mark.parametrize(
    "edited",
    [
        # Free text around the tags.
        "Fix typos only:\n<TEXT>\n{{text}}\n</TEXT>",
        # A closing tag inside the content: splitting at the first one would
        # leave text behind, so the parse must not be trusted.
        "<ROLE>\na\n</ROLE>\nb\n</ROLE>",
        # Lowercase tags never come out of the renderer.
        "<role>\na\n</role>",
        # Only whitespace differs from what the fields render.
        "<ROLE>\na\n</ROLE>\n",
    ],
)
def test_migration_023_keeps_text_whole_when_sections_would_not_round_trip(tmp_path, edited):
    engine = _current_database(tmp_path)
    stale = [{"name": "role", "content": "a"}]
    with engine.begin() as connection:
        _insert_prompt(connection, 1, stale, edited)

    run_migrations(engine)

    with engine.connect() as connection:
        prompt = _prompt(connection, 1)
        assert prompt["fields"] == [{"name": "prompt", "content": edited}]
        assert prompt["generated_prompt"] == f"<PROMPT>\n{edited}\n</PROMPT>"
        [snapshot] = _snapshots(connection, 1)
        assert (snapshot["fields"], snapshot["generated_prompt"]) == (stale, edited)


def test_migration_023_leaves_consistent_prompts_alone(tmp_path):
    engine = _current_database(tmp_path)
    fields = [{"name": "role", "content": "a"}, {"name": "task", "content": ""}]
    rendered = "<ROLE>\na\n</ROLE>\n\n<TASK>\n\n</TASK>"
    with engine.begin() as connection:
        _insert_prompt(connection, 1, fields, rendered)

    run_migrations(engine)

    with engine.connect() as connection:
        prompt = _prompt(connection, 1)
        assert (prompt["fields"], prompt["generated_prompt"]) == (fields, rendered)
        assert _snapshots(connection, 1) == []


def test_migration_024_files_unnamed_prompts_under_recovered_history(tmp_path):
    engine = _current_database(tmp_path)
    fields = [{"name": "task", "content": "Write a birthday message"}]
    rendered = "<TASK>\nWrite a birthday message\n</TASK>"
    with engine.begin() as connection:
        # Two identical history entries: both are kept.
        _insert_prompt(connection, 1, fields, rendered, name=None)
        _insert_prompt(connection, 2, fields, rendered, name=None)
        _insert_prompt(connection, 3, fields, rendered, name=None, folder="Personal")
        _insert_prompt(connection, 4, fields, rendered, name=None, created_at=None)
        _insert_prompt(connection, 5, fields, rendered, name="Kept", folder=None)

    run_migrations(engine)

    with engine.connect() as connection:
        rows = {
            row["id"]: (row["name"], row["folder"], row["updated_at"])
            for row in connection.execute(text("SELECT * FROM prompts")).mappings()
        }
    recovered = "Untitled (14 Mar 2026, 09:12 UTC)"
    unchanged = "2026-03-15 10:00:00.000000"
    assert rows == {
        1: (recovered, "Recovered history", unchanged),
        2: (recovered, "Recovered history", unchanged),
        3: (recovered, "Personal", unchanged),
        4: ("Untitled", "Recovered history", unchanged),
        5: ("Kept", None, unchanged),
    }


def test_version_note_migration_preserves_originals_and_is_idempotent(tmp_path):
    from app.database.migrations.v025_version_notes import _migration_025_version_notes

    engine = create_engine(f"sqlite:///{tmp_path / 'notes.db'}")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE prompts (id INTEGER PRIMARY KEY)"))
        connection.execute(
            text(
                "CREATE TABLE prompt_versions (id INTEGER PRIMARY KEY, prompt_id INTEGER, version_number INTEGER, note TEXT)"
            )
        )
        connection.execute(text("INSERT INTO prompts VALUES (1), (2)"))
        connection.execute(
            text(
                "INSERT INTO prompt_versions VALUES (11, 1, 1, 'Create v2'), (12, 1, 2, 'Create v3'), (21, 2, 1, 'Before section recovery')"
            )
        )
        _migration_025_version_notes(connection)
        _migration_025_version_notes(connection)
        rows = connection.execute(
            text("SELECT note, legacy_note FROM prompt_versions ORDER BY id")
        ).all()
        assert rows == [
            (None, "Create v2"),
            ("Create v2", "Create v3"),
            ("Before section recovery", "Before section recovery"),
        ]
        assert connection.execute(text("SELECT current_note FROM prompts ORDER BY id")).all() == [
            ("Create v3",),
            (None,),
        ]
        assert "variable_metadata" in _columns(connection, "prompt_versions")


def test_version_note_migration_tolerates_missing_tables(tmp_path):
    from app.database.migrations.v025_version_notes import _migration_025_version_notes

    engine = create_engine(f"sqlite:///{tmp_path / 'empty.db'}")
    with engine.begin() as connection:
        _migration_025_version_notes(connection)
        connection.execute(text("CREATE TABLE prompts (id INTEGER PRIMARY KEY)"))
        _migration_025_version_notes(connection)
        assert "current_note" in _columns(connection, "prompts")


def test_version_notes_backfill_after_cascade_schema_rebuild(tmp_path):
    from app.database.migrations.runner import _apply_with_foreign_keys_disabled
    from app.database.migrations.v020_delete_cascades import _migration_020_delete_cascades
    from app.database.migrations.v025_version_notes import _migration_025_version_notes
    from app.models.user import User

    engine = create_engine(f"sqlite:///{tmp_path / 'upgrade.db'}")
    User.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users "
                "(id, username, hashed_password, created_at, auth_subject) "
                "VALUES (1, 'upgrade', 'unused', CURRENT_TIMESTAMP, 'upgrade-subject')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO prompts (id, user_id, fields, generated_prompt) "
                "VALUES (1, 1, '[]', 'before')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO prompt_versions "
                "(id, prompt_id, version_number, note, fields, generated_prompt) "
                "VALUES (1, 1, 1, 'Edit to v2', '[]', 'before')"
            )
        )
        connection.exec_driver_sql("ALTER TABLE prompts DROP COLUMN current_note")
        connection.exec_driver_sql("ALTER TABLE prompt_versions DROP COLUMN legacy_note")
        connection.exec_driver_sql("ALTER TABLE prompt_versions DROP COLUMN variable_metadata")
    _apply_with_foreign_keys_disabled(engine, _migration_020_delete_cascades)
    with engine.begin() as connection:
        _migration_025_version_notes(connection)
        _migration_025_version_notes(connection)
        assert connection.execute(text("SELECT note, legacy_note FROM prompt_versions")).all() == [
            (None, "Edit to v2")
        ]
        assert connection.execute(text("SELECT current_note FROM prompts")).scalar() == "Edit to v2"


def test_user_auth_subject_migration_backfills_unique_stable_subjects(tmp_path):
    from uuid import UUID

    from sqlalchemy.exc import IntegrityError

    engine = create_engine(f"sqlite:///{tmp_path / 'subjects.db'}")
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, "
                "hashed_password TEXT, created_at DATETIME)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO users VALUES (1, 'one', 'hash', '2026-01-01'), "
                "(2, 'two', 'hash', '2026-01-01')"
            )
        )
        Base.metadata.create_all(connection)
    run_migrations(engine)
    with engine.connect() as connection:
        assert "auth_subject" in _columns(connection, "users")
        subjects = (
            connection.execute(text("SELECT auth_subject FROM users ORDER BY id")).scalars().all()
        )
        assert all(UUID(subject).version == 4 for subject in subjects)
        assert len(set(subjects)) == 2
    run_migrations(engine)
    with engine.begin() as connection:
        assert (
            connection.execute(text("SELECT auth_subject FROM users ORDER BY id")).scalars().all()
            == subjects
        )
        with pytest.raises(IntegrityError):
            connection.execute(
                text("UPDATE users SET auth_subject = :subject WHERE id = 2"),
                {"subject": subjects[0]},
            )


def test_oauth_revocation_migration_invalidates_legacy_credentials_and_is_idempotent(tmp_path):
    from app.database.migrations.v027_oauth_grants import _migration_027_oauth_grants

    engine = create_engine(f"sqlite:///{tmp_path / 'oauth-upgrade.db'}")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
        connection.execute(text("CREATE TABLE oauth_clients (client_id VARCHAR(64) PRIMARY KEY)"))
        connection.execute(
            text("CREATE TABLE oauth_authorization_codes (code_hash TEXT PRIMARY KEY)")
        )
        connection.execute(text("CREATE TABLE oauth_refresh_tokens (token_hash TEXT PRIMARY KEY)"))
        connection.execute(text("INSERT INTO oauth_authorization_codes VALUES ('old-code')"))
        connection.execute(text("INSERT INTO oauth_refresh_tokens VALUES ('old-refresh')"))
        _migration_027_oauth_grants(connection)
        assert _table_exists(connection, "oauth_grants")
        assert {"token_version", "grant_version"} <= _columns(
            connection, "oauth_authorization_codes"
        )
        assert "grant_version" in _columns(connection, "oauth_refresh_tokens")
        assert (
            connection.execute(text("SELECT COUNT(*) FROM oauth_authorization_codes")).scalar() == 0
        )
        assert connection.execute(text("SELECT COUNT(*) FROM oauth_refresh_tokens")).scalar() == 0
        connection.execute(
            text(
                "INSERT INTO oauth_authorization_codes (code_hash, token_version, grant_version) "
                "VALUES ('new-code', 0, 0)"
            )
        )
        connection.execute(text("INSERT INTO oauth_refresh_tokens VALUES ('new-refresh', 0)"))
        _migration_027_oauth_grants(connection)
        assert (
            connection.execute(text("SELECT code_hash FROM oauth_authorization_codes")).scalar()
            == "new-code"
        )
        assert (
            connection.execute(text("SELECT token_hash FROM oauth_refresh_tokens")).scalar()
            == "new-refresh"
        )
    engine.dispose()


def test_eval_human_score_migration_is_idempotent_and_preserves_results():
    from app.database.migrations.v030_eval_human_score import _migration_030_eval_human_score

    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        _migration_030_eval_human_score(connection)
        connection.execute(
            text("CREATE TABLE eval_run_results (id INTEGER PRIMARY KEY, score FLOAT)")
        )
        connection.execute(text("INSERT INTO eval_run_results VALUES (1, 75)"))
        _migration_030_eval_human_score(connection)
        _migration_030_eval_human_score(connection)
        row = connection.execute(text("SELECT score, human_score FROM eval_run_results")).one()
        assert tuple(row) == (75, None)
    engine.dispose()


def test_eval_tested_prompt_migration_is_idempotent_and_preserves_runs():
    from app.database.migrations.v031_eval_tested_prompt import _migration_031_eval_tested_prompt

    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        _migration_031_eval_tested_prompt(connection)
        connection.execute(
            text("CREATE TABLE eval_runs (id INTEGER PRIMARY KEY, prompt_version_number INTEGER)")
        )
        connection.execute(text("INSERT INTO eval_runs VALUES (1, 3)"))
        _migration_031_eval_tested_prompt(connection)
        _migration_031_eval_tested_prompt(connection)
        row = connection.execute(
            text("SELECT prompt_version_number, tested_prompt FROM eval_runs")
        ).one()
        assert tuple(row) == (3, None)
    engine.dispose()


def test_workspace_migration_is_idempotent_and_preserves_users():
    from app.database.migrations.v029_user_llm_workspace import _migration_029_user_llm_workspace

    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        _migration_029_user_llm_workspace(connection)
        connection.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)"))
        connection.execute(text("INSERT INTO users VALUES (1, 'existing')"))
        _migration_029_user_llm_workspace(connection)
        assert connection.execute(text("SELECT llm_workspace_id FROM users")).scalar() is None
        connection.execute(text("UPDATE users SET llm_workspace_id = 'wrkspc_ABC123'"))
        _migration_029_user_llm_workspace(connection)
        assert (
            connection.execute(text("SELECT llm_workspace_id FROM users")).scalar()
            == "wrkspc_ABC123"
        )
