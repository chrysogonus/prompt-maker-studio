"""
Tests for SQLite engine configuration in app/database/connection.py.
"""

import importlib


def test_sqlite_engine_configures_wal_busy_timeout_and_foreign_keys(tmp_path, monkeypatch):
    """Regression test for Medium (Performance): the engine previously set
    only check_same_thread=False, with no journal_mode=WAL (readers/writer
    would block each other) and no busy_timeout (a lock contention would
    raise "database is locked" immediately instead of waiting)."""
    db_path = tmp_path / "wal_test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")

    from app.database import connection

    importlib.reload(connection)
    try:
        with connection.engine.connect() as conn:
            journal_mode = conn.exec_driver_sql("PRAGMA journal_mode").scalar()
            busy_timeout = conn.exec_driver_sql("PRAGMA busy_timeout").scalar()
            foreign_keys = conn.exec_driver_sql("PRAGMA foreign_keys").scalar()

        assert journal_mode.lower() == "wal"
        assert busy_timeout == 5000
        # SQLite defaults foreign keys OFF, per connection. Without this every
        # ON DELETE in the schema is inert and account deletion silently leaves
        # orphaned Playground runs and billed calls behind.
        assert foreign_keys == 1
    finally:
        monkeypatch.delenv("DATABASE_URL", raising=False)
        importlib.reload(connection)
