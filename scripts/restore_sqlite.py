#!/usr/bin/env python3
"""Restore a gzip-compressed SQLite backup with integrity checks."""

from __future__ import annotations

import argparse
import gzip
import os
import shutil
import sqlite3
import tempfile
from datetime import UTC, datetime
from pathlib import Path


def _decompress_if_needed(backup_path: Path) -> Path:
    if backup_path.suffix != ".gz":
        return backup_path

    with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as temp_file:
        temp_path = Path(temp_file.name)

    try:
        with gzip.open(backup_path, "rb") as compressed, temp_path.open("wb") as raw:
            shutil.copyfileobj(compressed, raw)
    except BaseException:
        temp_path.unlink(missing_ok=True)
        raise
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
    """Restore an offline database, returning its consistent pre-restore snapshot.

    Stop all database users before calling, including scheduled backup readers.
    SQLite's exclusive lock rejects active users and remains held until replace.
    """
    if not backup_path.exists():
        msg = f"Backup does not exist: {backup_path}"
        raise FileNotFoundError(msg)

    restored_source = _decompress_if_needed(backup_path)
    temporary_source = restored_source != backup_path
    temp_db_path = None
    existing = None

    try:
        _assert_integrity(restored_source)
        db_path.parent.mkdir(parents=True, exist_ok=True)

        pre_restore_path = None
        if db_path.exists():
            metadata = db_path.stat()
            existing = sqlite3.connect(db_path, timeout=0)
            try:
                existing.execute("PRAGMA locking_mode=EXCLUSIVE")
                # Switching out of WAL checkpoints committed crash-left data
                # and removes sidecars before the original inode is replaced.
                existing.execute("PRAGMA journal_mode=DELETE")
                existing.execute("BEGIN EXCLUSIVE")
                existing.commit()
            except sqlite3.OperationalError as exc:
                msg = "Stop all database users before restoring (backend and backups)"
                raise RuntimeError(msg) from exc
            timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
            pre_restore_path = db_path.with_name(
                f"{db_path.name}.pre-restore-{timestamp}"
            )
            os.close(
                os.open(pre_restore_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            )
            snapshot = sqlite3.connect(pre_restore_path)
            try:
                existing.backup(snapshot)
            finally:
                snapshot.close()

        with tempfile.NamedTemporaryFile(
            dir=db_path.parent, suffix=".sqlite3", delete=False
        ) as temp_file:
            temp_db_path = Path(temp_file.name)
        source = sqlite3.connect(restored_source)
        destination = sqlite3.connect(temp_db_path)
        try:
            source.backup(destination)
        finally:
            destination.close()
            source.close()
        if existing is not None:
            os.chown(temp_db_path, metadata.st_uid, metadata.st_gid)
            temp_db_path.chmod(metadata.st_mode & 0o777)
            # Exclusive access is held and WAL has been checkpointed. A crashed
            # connection can still leave its shared-memory file behind.
            for suffix in ("-wal", "-shm"):
                db_path.with_name(db_path.name + suffix).unlink(missing_ok=True)
        temp_db_path.replace(db_path)
        return pre_restore_path
    finally:
        if existing is not None:
            existing.close()
        if temp_db_path is not None:
            temp_db_path.unlink(missing_ok=True)
        if temporary_source:
            restored_source.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Restore a SQLite database backup")
    parser.add_argument(
        "--backup", required=True, type=Path, help="Backup .sqlite3 or .sqlite3.gz file"
    )
    parser.add_argument(
        "--db", required=True, type=Path, help="Destination SQLite database path"
    )
    args = parser.parse_args()

    pre_restore_path = restore_backup(args.backup, args.db)
    if pre_restore_path is not None:
        print(f"Existing database copied to {pre_restore_path}")
    print(f"Restored {args.backup} to {args.db}")


if __name__ == "__main__":
    main()
