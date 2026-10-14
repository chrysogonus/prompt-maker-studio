#!/usr/bin/env python3
"""Exercise backup and restore in an isolated bind mount, never production data."""

from __future__ import annotations

import gzip
import os
import sqlite3
import stat
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
        connection.close()

        docker_python = [
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
        ]
        subprocess.run(
            [
                *docker_python,
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
        if stat.S_IMODE(owner.st_mode) != 0o600:
            print("error: backup is readable by other host users")
            return 1
        with gzip.open(backup, "rb") as backup_file:
            if not backup_file.read(16).startswith(b"SQLite format 3"):
                print("error: backup is not a valid compressed SQLite database")
                return 1

        # Use the same non-root account as the backend data owner. This catches
        # the former root-owned 0600 gzip restore without touching named volumes.
        database_path.chmod(0o640)
        subprocess.run(
            [
                *docker_python,
                "/scripts/restore_sqlite.py",
                "--backup",
                f"/work/backups/{backup.name}",
                "--db",
                "/work/prompts.db",
            ],
            check=True,
        )
        restored = database_path.stat()
        if (restored.st_uid, restored.st_gid) != (host_uid, host_gid):
            print("error: restored database owner changed")
            return 1
        if stat.S_IMODE(restored.st_mode) != 0o640:
            print("error: restored database permissions changed")
            return 1
        subprocess.run(
            [
                *docker_python,
                "-c",
                (
                    "import sqlite3; "
                    "connection = sqlite3.connect('/work/prompts.db'); "
                    "connection.execute(\"INSERT INTO marker VALUES ('restored-write')\"); "
                    "connection.commit()"
                ),
            ],
            check=True,
        )

    print(
        f"✅ Backup and restore preserve non-root ownership and access ({host_uid}:{host_gid})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
