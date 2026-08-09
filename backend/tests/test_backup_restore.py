"""Tests for SQLite backup and restore scripts."""

import gzip
import importlib.util
from pathlib import Path
import sqlite3

import pytest


def _load_script(name: str):
    script_path = Path(__file__).resolve().parents[2] / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, script_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _create_db(path: Path, value: str) -> None:
    connection = sqlite3.connect(path)
    try:
        connection.execute("CREATE TABLE smoke (value TEXT NOT NULL)")
        connection.execute("INSERT INTO smoke (value) VALUES (?)", (value,))
        connection.commit()
    finally:
        connection.close()


def _read_value(path: Path) -> str:
    connection = sqlite3.connect(path)
    try:
        return connection.execute("SELECT value FROM smoke").fetchone()[0]
    finally:
        connection.close()


def test_backup_and_restore_round_trip(tmp_path):
    backup_module = _load_script("backup_sqlite")
    restore_module = _load_script("restore_sqlite")

    db_path = tmp_path / "prompts.db"
    backup_dir = tmp_path / "backups"
    _create_db(db_path, "before")

    backup_path = backup_module.create_backup(db_path, backup_dir, label="test")
    assert backup_path.exists()
    assert backup_path.suffix == ".gz"

    with gzip.open(backup_path, "rb") as backup_file:
        assert backup_file.read(16).startswith(b"SQLite format 3")

    db_path.unlink()
    _create_db(db_path, "after")

    pre_restore_path = restore_module.restore_backup(backup_path, db_path)

    assert pre_restore_path is not None
    assert pre_restore_path.exists()
    assert _read_value(pre_restore_path) == "after"
    assert _read_value(db_path) == "before"


def test_restore_rejects_invalid_backup(tmp_path):
    restore_module = _load_script("restore_sqlite")
    invalid_backup = tmp_path / "invalid.sqlite3"
    invalid_backup.write_text("not sqlite")

    db_path = tmp_path / "prompts.db"
    _create_db(db_path, "safe")

    with pytest.raises(RuntimeError, match="integrity_check"):
        restore_module.restore_backup(invalid_backup, db_path)

    assert _read_value(db_path) == "safe"
