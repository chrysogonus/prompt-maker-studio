"""Migration execution and version recording."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
import logging

from sqlalchemy import Engine, text

from app.database.migrations.registry import _MIGRATIONS

logger = logging.getLogger(__name__)

_NEEDS_FOREIGN_KEYS_DISABLED = frozenset({"020_delete_cascades"})


def run_migrations(engine: Engine) -> None:
    """Apply all pending idempotent migrations for supported database engines."""
    if engine.dialect.name != "sqlite":
        logger.info(
            "Skipping built-in migrations for non-SQLite database dialect %s", engine.dialect.name
        )
        return

    with engine.begin() as connection:
        _ensure_schema_migrations_table(connection)
        applied_versions = _applied_versions(connection)

    for version, migration in _MIGRATIONS:
        if version in applied_versions:
            continue

        logger.info("Applying database migration %s", version)
        if version in _NEEDS_FOREIGN_KEYS_DISABLED:
            _apply_with_foreign_keys_disabled(engine, migration)
        else:
            with engine.begin() as connection:
                migration(connection)

        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO schema_migrations (version, applied_at) "
                    "VALUES (:version, :applied_at)"
                ),
                {"version": version, "applied_at": datetime.now(UTC).isoformat()},
            )
        logger.info("Applied database migration %s", version)


def _apply_with_foreign_keys_disabled(engine: Engine, migration: Callable) -> None:
    """Run one migration on a connection with foreign-key enforcement off.

    A table rebuild cannot run alongside enforcement. SQLite ignores
    `legacy_alter_table` while foreign keys are on, so `ALTER TABLE ... RENAME`
    rewrites the references *other* tables hold — repointing them at the
    rebuild's temporary table, which is then dropped. And `PRAGMA foreign_keys`
    is a documented no-op inside a transaction, so it cannot simply be toggled
    where the other migrations run.

    Each migration therefore gets its own transaction rather than one shared
    across all of them. That was never the atomic unit it looked like anyway:
    pysqlite does not open a transaction for DDL, so a failure mid-run already
    left earlier statements committed.
    """
    with engine.connect() as connection:
        # Straight to the DBAPI handle: `PRAGMA foreign_keys` is ignored while a
        # transaction is open, and going through the SQLAlchemy connection would
        # autobegin one first. Read it back rather than trusting it — silently
        # leaving enforcement on is exactly the failure this guards against.
        raw_connection = connection.connection.dbapi_connection
        raw_connection.execute("PRAGMA foreign_keys=OFF")
        if raw_connection.execute("PRAGMA foreign_keys").fetchone()[0] != 0:
            msg = "Could not disable foreign keys for a table-rebuild migration"
            raise RuntimeError(msg)

        try:
            transaction = connection.begin()
            try:
                migration(connection)
                transaction.commit()
            except Exception:
                transaction.rollback()
                raise
        finally:
            raw_connection.execute("PRAGMA foreign_keys=ON")


def _ensure_schema_migrations_table(connection) -> None:
    connection.execute(
        text(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            "version TEXT PRIMARY KEY, "
            "applied_at TEXT NOT NULL"
            ")"
        )
    )


def _applied_versions(connection) -> set[str]:
    rows = connection.execute(text("SELECT version FROM schema_migrations")).fetchall()
    return {str(row[0]) for row in rows}
