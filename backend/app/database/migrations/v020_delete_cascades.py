"""Historical SQLite migration v020_delete_cascades."""

from __future__ import annotations

from sqlalchemy import column, delete, select, table, text, update
from sqlalchemy.schema import CreateIndex, CreateTable

from app.database.migrations.helpers import _columns, _table_exists
from app.models.billed_call import BilledCall
from app.models.eval_case import EvalCase
from app.models.eval_run import EvalRun
from app.models.eval_run_result import EvalRunResult
from app.models.playground_run import PlaygroundRun
from app.models.prompt import Prompt
from app.models.prompt_version import PromptVersion
from app.models.user import User

_CASCADE_REBUILD_MODELS = (
    Prompt,
    PromptVersion,
    EvalCase,
    EvalRun,
    EvalRunResult,
    PlaygroundRun,
    BilledCall,
)

_ORPHAN_DELETIONS = (
    (Prompt, "user_id", User),
    (PromptVersion, "prompt_id", Prompt),
    (EvalCase, "prompt_id", Prompt),
    (EvalRun, "prompt_id", Prompt),
    (EvalRunResult, "eval_run_id", EvalRun),
    (PlaygroundRun, "prompt_id", Prompt),
    (PlaygroundRun, "user_id", User),
    (BilledCall, "user_id", User),
)

_ORPHAN_NULLIFICATIONS = (
    (PromptVersion, "author_user_id", User),
    (EvalRunResult, "eval_case_id", EvalCase),
)


def _dangling(connection, child, column_name: str, parent):
    """Criterion matching rows whose foreign key points at a missing parent.

    Returns None when the migration has nothing to do — either table may be
    absent on an old database, and the column may predate its own migration.
    """
    if not (
        _table_exists(connection, child.__tablename__)
        and _table_exists(connection, parent.__tablename__)
    ):
        return None
    if column_name not in _columns(connection, child.__tablename__):
        return None

    foreign_key = child.__table__.c[column_name]
    parent_key = parent.__table__.c.id
    return foreign_key.is_not(None) & foreign_key.not_in(select(parent_key))


def _rebuild_table_with_current_schema(connection, model) -> None:
    """Recreate a table from its SQLAlchemy definition, preserving its rows.

    SQLite cannot alter a foreign key in place, so adding ON DELETE means
    building the table again. The DDL is rendered from the mapped class rather
    than a literal string so this cannot drift from models/ the way a
    hand-copied CREATE TABLE would.

    Requires legacy_alter_table=ON — see _migration_020_delete_cascades.
    """
    target = model.__table__
    table_name = target.name
    old_columns = _columns(connection, table_name)
    # Only columns present on both sides survive; a rebuild is not the place to
    # add or drop one, and every earlier migration has already run.
    shared = [c.name for c in target.columns if c.name in old_columns]

    connection.execute(text(f'ALTER TABLE "{table_name}" RENAME TO "{table_name}__old"'))
    connection.execute(CreateTable(target))
    # Migration 025 uses legacy_note's presence as its transactional backfill
    # guard. A rebuild from today's ORM must not pre-create that later schema.
    later_columns = {
        "prompts": ("current_note",),
        "prompt_versions": ("legacy_note", "variable_metadata"),
    }
    for name in later_columns.get(table_name, ()):
        if name not in old_columns:
            connection.exec_driver_sql(f'ALTER TABLE "{table_name}" DROP COLUMN "{name}"')

    # Core constructs rather than an interpolated INSERT ... SELECT. The
    # identifiers are dynamic — SQL cannot bind those as parameters — and
    # building the statement this way gets them quoted correctly without
    # hand-written SQL that then needs a security suppression.
    old_table = table(f"{table_name}__old", *(column(name) for name in shared))
    new_table = table(table_name, *(column(name) for name in shared))
    connection.execute(
        new_table.insert().from_select(
            shared, select(*(column(name) for name in shared)).select_from(old_table)
        )
    )

    connection.execute(text(f'DROP TABLE "{table_name}__old"'))
    for index in target.indexes:
        connection.execute(CreateIndex(index))


def _migration_020_delete_cascades(connection) -> None:
    """Give every user-owned foreign key an ON DELETE action, and clear the
    orphans left behind while it had none.

    `DELETE /api/auth/me` promised to remove "all their data" but deleted only
    the users row: Playground runs (prompt inputs, model output, error text)
    and billed calls (usage and spend) referenced the user with no cascade, and
    SQLite foreign keys were never enabled, so they survived as orphans the API
    reported as deleted. Prompt deletion had the same hole for Playground runs.

    Deleting the rows rather than anonymising them is deliberate: the endpoint
    documents permanent deletion. One consequence worth knowing is that a
    deleted account's billed_calls leave the monthly spend window with them, so
    GLOBAL_MONTHLY_BUDGET_USD accounting for that month drops accordingly.
    """
    # defer_foreign_keys, not foreign_keys: this runs inside a transaction,
    # where toggling foreign_keys is a documented no-op. Deferring moves
    # enforcement to COMMIT, by which point every table is rebuilt.
    connection.execute(text("PRAGMA defer_foreign_keys=ON"))

    for child, column_name, parent in _ORPHAN_DELETIONS:
        criterion = _dangling(connection, child, column_name, parent)
        if criterion is not None:
            connection.execute(delete(child.__table__).where(criterion))

    for child, column_name, parent in _ORPHAN_NULLIFICATIONS:
        criterion = _dangling(connection, child, column_name, parent)
        if criterion is not None:
            connection.execute(
                update(child.__table__).where(criterion).values(**{column_name: None})
            )

    # From SQLite 3.25, `ALTER TABLE ... RENAME TO` also rewrites the foreign
    # keys *other* tables hold, repointing them at the new name. During a
    # rebuild that is actively wrong: renaming eval_cases to eval_cases__old
    # silently repoints eval_run_results at the temporary table, which is then
    # dropped, and the next rebuild dies with "no such table:
    # main.eval_cases__old". legacy_alter_table restores the plain rename the
    # 12-step rebuild wants — and only works because the caller has foreign
    # keys off (see _apply_with_foreign_keys_disabled), since SQLite ignores
    # this pragma while enforcement is on.
    #
    # Not cosmetic: SQLite 3.37 tolerated the default while 3.46 (the
    # python:3.12-slim runtime) does not, so getting this wrong passes locally
    # and takes the container down on boot.
    connection.execute(text("PRAGMA legacy_alter_table=ON"))
    try:
        for model in _CASCADE_REBUILD_MODELS:
            if _table_exists(connection, model.__tablename__):
                _rebuild_table_with_current_schema(connection, model)
    finally:
        connection.execute(text("PRAGMA legacy_alter_table=OFF"))
