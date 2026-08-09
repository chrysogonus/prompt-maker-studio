#!/usr/bin/env python3
"""Restore a gzip-compressed SQLite backup with integrity checks."""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
import gzip
from pathlib import Path
import shutil
import sqlite3
import tempfile


def _decompress_if_needed(backup_path: Path) -> Path:
    if backup_path.suffix != ".gz":
        return backup_path

    with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as temp_file:
        temp_path = Path(temp_file.name)

    with gzip.open(backup_path, "rb") as compressed, temp_path.open("wb") as raw:
        shutil.copyfileobj(compressed, raw)
    return temp_path


def _assert_integrity(db_path: Path) -> None:
    connection = sqlite3.connect(db_path)
    try:
        try:
            result = connection.execute("PRAGMA integrity_check").fetchone()
        except sqlite3.DatabaseError as exc:
            msg = f"Backup failed SQLite integrity_check: {exc}"
            raise RuntimeError(msg) from exc
    finally:
        connection.close()

    if result is None or result[0] != "ok":
        msg = f"Backup failed SQLite integrity_check: {result[0] if result else 'no result'}"
        raise RuntimeError(msg)


def restore_backup(backup_path: Path, db_path: Path) -> Path | None:
    """Restore a backup to db_path and return the pre-restore copy path, if any."""
    if not backup_path.exists():
        msg = f"Backup does not exist: {backup_path}"
        raise FileNotFoundError(msg)

    restored_source = _decompress_if_needed(backup_path)
    temporary_source = restored_source != backup_path

    try:
        _assert_integrity(restored_source)
        db_path.parent.mkdir(parents=True, exist_ok=True)

        pre_restore_path = None
        if db_path.exists():
            timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
            pre_restore_path = db_path.with_name(f"{db_path.name}.pre-restore-{timestamp}")
            shutil.copy2(db_path, pre_restore_path)

        with tempfile.NamedTemporaryFile(dir=db_path.parent, suffix=".sqlite3", delete=False) as temp_file:
            temp_db_path = Path(temp_file.name)
        shutil.copy2(restored_source, temp_db_path)
        temp_db_path.replace(db_path)
        return pre_restore_path
    finally:
        if temporary_source:
            restored_source.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Restore a SQLite database backup")
    parser.add_argument("--backup", required=True, type=Path, help="Backup .sqlite3 or .sqlite3.gz file")
    parser.add_argument("--db", required=True, type=Path, help="Destination SQLite database path")
    args = parser.parse_args()

    pre_restore_path = restore_backup(args.backup, args.db)
    if pre_restore_path is not None:
        print(f"Existing database copied to {pre_restore_path}")
    print(f"Restored {args.backup} to {args.db}")


if __name__ == "__main__":
    main()
