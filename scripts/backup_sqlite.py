#!/usr/bin/env python3
"""Create a consistent gzip-compressed SQLite backup."""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
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


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a SQLite database backup")
    parser.add_argument("--db", required=True, type=Path, help="Path to the SQLite database file")
    parser.add_argument("--out", required=True, type=Path, help="Directory for backup files")
    parser.add_argument("--label", default="prompts", help="Backup file prefix")
    args = parser.parse_args()

    backup_path = create_backup(args.db, args.out, label=args.label)
    print(backup_path)


if __name__ == "__main__":
    main()
