"""Historical SQLite migration helpers."""

from __future__ import annotations

from sqlalchemy import text


def _table_exists(connection, table_name: str) -> bool:
    row = connection.execute(
        text("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = :table_name"),
        {"table_name": table_name},
    ).first()
    return row is not None


def _columns(connection, table_name: str) -> set[str]:
    if not _table_exists(connection, table_name):
        return set()
    rows = connection.execute(text(f'PRAGMA table_info("{table_name}")')).fetchall()
    return {str(row[1]) for row in rows}


def _indexes(connection, table_name: str) -> set[str]:
    if not _table_exists(connection, table_name):
        return set()
    rows = connection.execute(text(f'PRAGMA index_list("{table_name}")')).fetchall()
    return {str(row[1]) for row in rows}


def _add_column_if_missing(connection, table_name: str, column_name: str, definition: str) -> None:
    if column_name in _columns(connection, table_name):
        return
    connection.execute(text(f'ALTER TABLE "{table_name}" ADD COLUMN {column_name} {definition}'))
