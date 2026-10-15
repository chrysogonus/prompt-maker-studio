"""Tests for SQLite backup and restore scripts."""

import gzip
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys

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


def test_prune_deletes_only_expired_backups_of_its_label(tmp_path):
    backup_module = _load_script("backup_sqlite")
    names = [
        "prompts-20000101T000000Z.sqlite3.gz",  # expired
        "prompts-29990101T000000Z.sqlite3.gz",  # within retention
        "other-20000101T000000Z.sqlite3.gz",  # different label
        "prompts-manual.sqlite3.gz",  # no parseable timestamp
    ]
    for name in names:
        (tmp_path / name).write_bytes(b"")

    deleted = backup_module.prune_backups(tmp_path, label="prompts", keep_days=14)

    assert [path.name for path in deleted] == ["prompts-20000101T000000Z.sqlite3.gz"]
    assert sorted(path.name for path in tmp_path.iterdir()) == sorted(names[1:])


def test_backup_is_private_even_with_permissive_umask(tmp_path):
    backup_module = _load_script("backup_sqlite")
    database = tmp_path / "prompts.db"
    _create_db(database, "private")
    old_umask = os.umask(0o022)
    try:
        backup = backup_module.create_backup(database, tmp_path / "backups")
    finally:
        os.umask(old_umask)
    assert backup.stat().st_mode & 0o777 == 0o600


def test_failed_compression_never_publishes_partial_backup(tmp_path, monkeypatch):
    backup_module = _load_script("backup_sqlite")
    database = tmp_path / "prompts.db"
    output = tmp_path / "backups"
    _create_db(database, "private")

    def fail_copy(source, destination):
        destination.write(b"partial")
        assert not list(output.glob("*.sqlite3.gz"))
        msg = "disk full"
        raise OSError(msg)

    monkeypatch.setattr(backup_module.shutil, "copyfileobj", fail_copy)
    with pytest.raises(OSError, match="disk full"):
        backup_module.create_backup(database, output)
    assert list(output.iterdir()) == []


def _leave_crashed_wal(database):
    subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import os, sqlite3, sys; "
                "connection = sqlite3.connect(sys.argv[1]); "
                "connection.execute('PRAGMA journal_mode=WAL'); "
                "connection.execute(\"INSERT INTO smoke VALUES ('crash-wal')\"); "
                "connection.commit(); os._exit(0)"
            ),
            str(database),
        ],
        check=True,
    )
    assert database.with_name(database.name + "-wal").exists()


def test_restore_recovers_old_wal_in_snapshot_without_replaying_into_restored_db(tmp_path):
    restore_module = _load_script("restore_sqlite")
    backup = tmp_path / "backup.sqlite3"
    database = tmp_path / "prompts.db"
    _create_db(backup, "restored")
    _create_db(database, "original")
    _leave_crashed_wal(database)

    snapshot = restore_module.restore_backup(backup, database)

    with sqlite3.connect(snapshot) as connection:
        assert connection.execute("SELECT value FROM smoke").fetchall() == [
            ("original",),
            ("crash-wal",),
        ]
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT value FROM smoke").fetchall() == [("restored",)]
    assert not database.with_name(database.name + "-wal").exists()
    assert not database.with_name(database.name + "-shm").exists()


def test_restore_refuses_an_open_database(tmp_path):
    restore_module = _load_script("restore_sqlite")
    backup = tmp_path / "backup.sqlite3"
    database = tmp_path / "prompts.db"
    _create_db(backup, "restored")
    _create_db(database, "safe")
    connection = sqlite3.connect(database)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("SELECT * FROM smoke").fetchall()
    try:
        with pytest.raises(RuntimeError, match="Stop all database users"):
            restore_module.restore_backup(backup, database)
        assert _read_value(database) == "safe"
    finally:
        connection.close()


def test_restore_preserves_destination_permissions(tmp_path):
    backup_module = _load_script("backup_sqlite")
    restore_module = _load_script("restore_sqlite")
    database = tmp_path / "prompts.db"
    _create_db(database, "safe")
    database.chmod(0o640)
    owner = database.stat()
    backup = backup_module.create_backup(database, tmp_path / "backups")

    restore_module.restore_backup(backup, database)

    assert database.stat().st_mode & 0o777 == 0o640
    assert (database.stat().st_uid, database.stat().st_gid) == (owner.st_uid, owner.st_gid)


def test_restore_failure_cleans_staged_database(tmp_path, monkeypatch):
    restore_module = _load_script("restore_sqlite")
    database = tmp_path / "prompts.db"
    backup = tmp_path / "backup.sqlite3"
    _create_db(database, "safe")
    _create_db(backup, "restored")
    original_replace = Path.replace

    def fail_replace(path, target):
        if target == database:
            msg = "replace failed"
            raise OSError(msg)
        return original_replace(path, target)

    monkeypatch.setattr(Path, "replace", fail_replace)
    with pytest.raises(OSError, match="replace failed"):
        restore_module.restore_backup(backup, database)
    assert _read_value(database) == "safe"
    assert not list(tmp_path.glob("tmp*.sqlite3"))


@pytest.mark.parametrize("restore_exit", [0, 1])
def test_make_restore_quiesces_all_users_and_restarts_only_after_success(tmp_path, restore_exit):
    """Exercise the command orchestration without a daemon or real volume."""
    docker = tmp_path / "docker"
    log = tmp_path / "commands.jsonl"
    docker.write_text(
        f"#!{sys.executable}\n"
        "import json, os, sys\n"
        "args = sys.argv[1:]\n"
        "with open(os.environ['RESTORE_COMMAND_LOG'], 'a') as log:\n"
        "    log.write(json.dumps(args) + '\\n')\n"
        "if 'ps' in args:\n"
        "    print('scheduled-worker-id')\n"
        "if args[0] == 'run':\n"
        "    sys.exit(int(os.environ['RESTORE_TEST_EXIT']))\n"
    )
    docker.chmod(0o755)
    backup = tmp_path / "selected.sqlite3.gz"
    backup.touch()
    makefile = Path(__file__).resolve().parents[2] / "Makefile"

    result = subprocess.run(
        ["make", "--no-print-directory", "-f", str(makefile), "restore-db", f"BACKUP={backup}"],
        cwd=tmp_path,
        env={
            **os.environ,
            "PATH": f"{tmp_path}:{os.environ['PATH']}",
            "RESTORE_COMMAND_LOG": str(log),
            "RESTORE_TEST_EXIT": str(restore_exit),
        },
        capture_output=True,
        text=True,
        check=False,
    )

    commands = [json.loads(line) for line in log.read_text().splitlines()]
    stop = next(command for command in commands if "stop" in command)
    assert stop[-2:] == ["db-backup", "backend"]
    run = next(command for command in commands if command[0] == "run")
    assert run[run.index("--user") + 1] == "1000:1000"
    starts = [command for command in commands if "start" in command]
    assert result.returncode == 0 if restore_exit == 0 else result.returncode != 0
    assert [command[-1] for command in starts] == (
        ["backend", "db-backup"] if restore_exit == 0 else []
    )
