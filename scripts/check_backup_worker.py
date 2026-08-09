#!/usr/bin/env python3
"""Exercise the scheduled backup image as the host operator, never as root."""

from __future__ import annotations

import gzip
import os
import sqlite3
import subprocess
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PYTHON_IMAGE = (
    "python:3.12-slim@sha256:"
    "d657ab0ade19f404a6ccc883ab399540de667aff751748ce23c07330c5a89e64"
)


def main() -> int:
    host_uid = os.getuid()
    host_gid = os.getgid()
    if host_uid == 0:
        print("error: ownership regression must run from a non-root host account")
        return 1

    with tempfile.TemporaryDirectory(prefix="prompt-maker-backup-worker-") as temp:
        work_dir = Path(temp)
        database_path = work_dir / "prompts.db"
        with sqlite3.connect(database_path) as connection:
            connection.execute("CREATE TABLE marker (value TEXT NOT NULL)")
            connection.execute("INSERT INTO marker VALUES ('backup-worker-check')")

        subprocess.run(
            [
                "docker",
                "run",
                "--rm",
                "--user",
                f"{host_uid}:{host_gid}",
                "--volume",
                f"{REPO_ROOT / 'scripts'}:/scripts:ro",
                "--volume",
                f"{work_dir}:/work",
                PYTHON_IMAGE,
                "python",
                "/scripts/backup_sqlite.py",
                "--db",
                "/work/prompts.db",
                "--out",
                "/work/backups",
                "--label",
                "worker-check",
            ],
            check=True,
        )

        backups = list((work_dir / "backups").glob("worker-check-*.sqlite3.gz"))
        if len(backups) != 1:
            print(f"error: expected one backup, found {len(backups)}")
            return 1

        backup = backups[0]
        owner = backup.stat()
        if (owner.st_uid, owner.st_gid) != (host_uid, host_gid):
            print(
                "error: backup owner does not match the host operator: "
                f"{owner.st_uid}:{owner.st_gid} != {host_uid}:{host_gid}"
            )
            return 1
        with gzip.open(backup, "rb") as backup_file:
            if not backup_file.read(16).startswith(b"SQLite format 3"):
                print("error: backup is not a valid compressed SQLite database")
                return 1

    print(f"✅ Backup worker writes valid files as non-root {host_uid}:{host_gid}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
