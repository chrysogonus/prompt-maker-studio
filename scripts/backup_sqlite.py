#!/usr/bin/env python3
"""Create a consistent gzip-compressed SQLite backup."""

from __future__ import annotations

import argparse
from datetime import UTC, datetime, timedelta
import gzip
from pathlib import Path
import shutil
import sqlite3
import tempfile


def create_backup(db_path: Path, output_dir: Path, *, label: str = "prompts") -> Path:
    """Create a consistent SQLite backup and return the gzip file path."""
    if not db_path.exists():
        msg = f"Database does not exist: {db_path}"
        raise FileNotFoundError(msg)

    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    backup_path = output_dir / f"{label}-{timestamp}.sqlite3.gz"

    with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as temp_file:
        temp_path = Path(temp_file.name)

    try:
        source = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            destination = sqlite3.connect(temp_path)
            try:
                source.backup(destination)
            finally:
                destination.close()
        finally:
            source.close()

        with temp_path.open("rb") as raw, gzip.open(backup_path, "wb") as compressed:
            shutil.copyfileobj(raw, compressed)
    finally:
        temp_path.unlink(missing_ok=True)

    return backup_path


def prune_backups(output_dir: Path, *, label: str, keep_days: int) -> list[Path]:
    """Delete this label's backups older than `keep_days` and return the deleted paths.

    Age comes from the timestamp in the file name, not the mtime, so a copied or
    restored file keeps its real age. Files that don't match the name pattern are
    left alone.
    """
    cutoff = datetime.now(UTC) - timedelta(days=keep_days)
    deleted = []
    for path in output_dir.glob(f"{label}-*.sqlite3.gz"):
        stamp = path.name.removeprefix(f"{label}-").removesuffix(".sqlite3.gz")
        try:
            created = datetime.strptime(stamp, "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
        except ValueError:
            continue
        if created < cutoff:
            path.unlink()
            deleted.append(path)
    return deleted


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a SQLite database backup")
    parser.add_argument("--db", required=True, type=Path, help="Path to the SQLite database file")
    parser.add_argument("--out", required=True, type=Path, help="Directory for backup files")
    parser.add_argument("--label", default="prompts", help="Backup file prefix")
    parser.add_argument(
        "--keep-days", type=int, help="Delete this label's backups older than this many days"
    )
    args = parser.parse_args()

    backup_path = create_backup(args.db, args.out, label=args.label)
    print(backup_path)
    if args.keep_days is not None:
        for path in prune_backups(args.out, label=args.label, keep_days=args.keep_days):
            print(f"deleted {path}")


if __name__ == "__main__":
    main()
