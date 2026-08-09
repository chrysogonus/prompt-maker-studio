"""
Idempotent database migrations for SQLite deployments.

The application still uses SQLAlchemy models for fresh schema creation. These
migrations handle existing SQLite databases where `create_all()` cannot add or
backfill columns. Each migration is safe to run repeatedly and records its
version in `schema_migrations` once complete.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
import json
import logging

from sqlalchemy import Engine, column, delete, select, table, text, update
from sqlalchemy.schema import CreateIndex, CreateTable

from app.models.billed_call import BilledCall
from app.models.eval_case import EvalCase
from app.models.eval_run import EvalRun
from app.models.eval_run_result import EvalRunResult
from app.models.playground_run import PlaygroundRun
from app.models.prompt import Prompt
from app.models.prompt_version import PromptVersion
from app.models.user import User

logger = logging.getLogger(__name__)

Migration = tuple[str, Callable]


STATIC_FIELD_COLUMNS = ("goal", "characters", "style", "setting", "details", "extra_details")

# Migrations that rebuild tables, and so need foreign-key enforcement off for
# the duration. See _apply_with_foreign_keys_disabled.
_NEEDS_FOREIGN_KEYS_DISABLED = frozenset({"020_delete_cascades"})


def run_migrations(engine: Engine) -> None:
    """Apply all pending idempotent migrations for supported database engines."""
    if engine.dialect.name != "sqlite":
        logger.info(
            "Skipping built-in migrations for non-SQLite database dialect %s", engine.dialect.name
        )
        return

    with engine.begin() as connection:
        _ensure_schema_migrations_table(connection)
        applied_versions = _applied_versions(connection)

    for version, migration in _MIGRATIONS:
        if version in applied_versions:
            continue

        logger.info("Applying database migration %s", version)
        if version in _NEEDS_FOREIGN_KEYS_DISABLED:
            _apply_with_foreign_keys_disabled(engine, migration)
        else:
            with engine.begin() as connection:
                migration(connection)

        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO schema_migrations (version, applied_at) "
                    "VALUES (:version, :applied_at)"
                ),
                {"version": version, "applied_at": datetime.now(UTC).isoformat()},
            )
        logger.info("Applied database migration %s", version)


def _apply_with_foreign_keys_disabled(engine: Engine, migration: Callable) -> None:
    """Run one migration on a connection with foreign-key enforcement off.

    A table rebuild cannot run alongside enforcement. SQLite ignores
    `legacy_alter_table` while foreign keys are on, so `ALTER TABLE ... RENAME`
    rewrites the references *other* tables hold — repointing them at the
    rebuild's temporary table, which is then dropped. And `PRAGMA foreign_keys`
    is a documented no-op inside a transaction, so it cannot simply be toggled
    where the other migrations run.

    Each migration therefore gets its own transaction rather than one shared
    across all of them. That was never the atomic unit it looked like anyway:
    pysqlite does not open a transaction for DDL, so a failure mid-run already
    left earlier statements committed.
    """
    with engine.connect() as connection:
        # Straight to the DBAPI handle: `PRAGMA foreign_keys` is ignored while a
        # transaction is open, and going through the SQLAlchemy connection would
        # autobegin one first. Read it back rather than trusting it — silently
        # leaving enforcement on is exactly the failure this guards against.
        raw_connection = connection.connection.dbapi_connection
        raw_connection.execute("PRAGMA foreign_keys=OFF")
        if raw_connection.execute("PRAGMA foreign_keys").fetchone()[0] != 0:
            msg = "Could not disable foreign keys for a table-rebuild migration"
            raise RuntimeError(msg)

        try:
            transaction = connection.begin()
            try:
                migration(connection)
                transaction.commit()
            except Exception:
                transaction.rollback()
                raise
        finally:
            raw_connection.execute("PRAGMA foreign_keys=ON")


def _ensure_schema_migrations_table(connection) -> None:
    connection.execute(
        text(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            "version TEXT PRIMARY KEY, "
            "applied_at TEXT NOT NULL"
            ")"
        )
    )


def _applied_versions(connection) -> set[str]:
    rows = connection.execute(text("SELECT version FROM schema_migrations")).fetchall()
    return {str(row[0]) for row in rows}


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


def _migration_001_dynamic_prompt_fields(connection) -> None:
    """Backfill `prompts.fields` from legacy static field columns when needed."""
    if not _table_exists(connection, "prompts"):
        return

    columns = _columns(connection, "prompts")
    if "fields" in columns:
        return

    legacy_columns = [column for column in STATIC_FIELD_COLUMNS if column in columns]
    if not legacy_columns:
        msg = "Cannot migrate prompts table: missing both `fields` and legacy static field columns"
        raise RuntimeError(msg)

    connection.execute(text('ALTER TABLE "prompts" ADD COLUMN fields JSON'))

    rows = connection.execute(text('SELECT * FROM "prompts"')).mappings().all()

    for row in rows:
        fields = [
            {"name": column, "content": row[column]}
            for column in legacy_columns
            if row[column] not in (None, "")
        ]
        if not fields:
            fields = [{"name": "goal", "content": ""}]

        connection.execute(
            text('UPDATE "prompts" SET fields = :fields WHERE id = :prompt_id'),
            {"fields": json.dumps(fields), "prompt_id": row["id"]},
        )


def _migration_002_prompt_user_id(connection) -> None:
    """Add prompt ownership column and backfill ownerless rows when possible."""
    if not _table_exists(connection, "prompts"):
        return

    _add_column_if_missing(
        connection, "prompts", "user_id", "INTEGER REFERENCES users(id) ON DELETE CASCADE"
    )

    if _table_exists(connection, "users"):
        oldest_user = connection.execute(
            text('SELECT id FROM "users" ORDER BY created_at ASC LIMIT 1')
        ).first()
        if oldest_user is not None:
            connection.execute(
                text('UPDATE "prompts" SET user_id = :user_id WHERE user_id IS NULL'),
                {"user_id": oldest_user[0]},
            )

    connection.execute(text('CREATE INDEX IF NOT EXISTS ix_prompts_user_id ON "prompts" (user_id)'))


def _migration_003_prompt_name(connection) -> None:
    """Add prompt name column used for server-side saved prompts."""
    if not _table_exists(connection, "prompts"):
        return

    _add_column_if_missing(connection, "prompts", "name", "VARCHAR(255)")
    connection.execute(text('CREATE INDEX IF NOT EXISTS ix_prompts_name ON "prompts" (name)'))


def _migration_004_user_email_reset(connection) -> None:
    """Add profile email and password-reset columns to users."""
    if not _table_exists(connection, "users"):
        return

    _add_column_if_missing(connection, "users", "email", "VARCHAR(255)")
    _add_column_if_missing(connection, "users", "reset_token", "VARCHAR(255)")
    _add_column_if_missing(connection, "users", "reset_token_expiry", "DATETIME")

    indexes = _indexes(connection, "users")
    if "ix_users_email" not in indexes:
        connection.execute(
            text('CREATE UNIQUE INDEX ix_users_email ON "users" (email) WHERE email IS NOT NULL')
        )
    if "ix_users_reset_token" not in indexes:
        connection.execute(
            text(
                'CREATE INDEX ix_users_reset_token ON "users" (reset_token) '
                "WHERE reset_token IS NOT NULL"
            )
        )


def _migration_005_prompt_updated_at(connection) -> None:
    """Add updated_at column to prompts; backfill with created_at for existing rows."""
    if not _table_exists(connection, "prompts"):
        return

    _add_column_if_missing(connection, "prompts", "updated_at", "DATETIME")
    connection.execute(
        text('UPDATE "prompts" SET updated_at = created_at WHERE updated_at IS NULL')
    )


def _migration_006_prompt_folder(connection) -> None:
    """Add the free-text folder label column to prompts, and index it."""
    if not _table_exists(connection, "prompts"):
        return

    _add_column_if_missing(connection, "prompts", "folder", "VARCHAR(255)")
    connection.execute(text('CREATE INDEX IF NOT EXISTS ix_prompts_folder ON "prompts" (folder)'))


def _migration_007_prompt_favorite(connection) -> None:
    """Add the favorite flag column to prompts, defaulting existing rows to false."""
    if not _table_exists(connection, "prompts"):
        return

    _add_column_if_missing(connection, "prompts", "is_favorite", "BOOLEAN NOT NULL DEFAULT 0")


def _migration_008_prompt_tags(connection) -> None:
    """Add the tags list column to prompts."""
    if not _table_exists(connection, "prompts"):
        return

    _add_column_if_missing(connection, "prompts", "tags", "JSON")


def _migration_009_prompt_versions(connection) -> None:
    """Create the prompt_versions table for prompt version history."""
    connection.execute(
        text(
            "CREATE TABLE IF NOT EXISTS prompt_versions ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "prompt_id INTEGER NOT NULL REFERENCES prompts(id), "
            "version_number INTEGER NOT NULL, "
            "note VARCHAR(255), "
            "author_user_id INTEGER REFERENCES users(id), "
            "fields JSON NOT NULL, "
            "generated_prompt TEXT NOT NULL, "
            "created_at DATETIME"
            ")"
        )
    )
    connection.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_prompt_versions_prompt_id ON prompt_versions (prompt_id)"
        )
    )


def _migration_010_playground_runs(connection) -> None:
    """Create the playground_runs table for Playground execution history."""
    connection.execute(
        text(
            "CREATE TABLE IF NOT EXISTS playground_runs ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "prompt_id INTEGER NOT NULL REFERENCES prompts(id), "
            "user_id INTEGER NOT NULL REFERENCES users(id), "
            "model VARCHAR(100) NOT NULL, "
            "input_variables JSON, "
            "output_text TEXT NOT NULL DEFAULT '', "
            "latency_ms INTEGER NOT NULL DEFAULT 0, "
            "prompt_tokens INTEGER NOT NULL DEFAULT 0, "
            "completion_tokens INTEGER NOT NULL DEFAULT 0, "
            "cost_usd REAL NOT NULL DEFAULT 0, "
            "status VARCHAR(20) NOT NULL DEFAULT 'success', "
            "error_message TEXT, "
            "created_at DATETIME"
            ")"
        )
    )
    connection.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_playground_runs_prompt_id ON playground_runs (prompt_id)"
        )
    )
    connection.execute(
        text("CREATE INDEX IF NOT EXISTS ix_playground_runs_user_id ON playground_runs (user_id)")
    )
    connection.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_playground_runs_created_at "
            "ON playground_runs (created_at)"
        )
    )


def _migration_011_user_preferences(connection) -> None:
    """Add Settings preference columns to users."""
    if not _table_exists(connection, "users"):
        return

    _add_column_if_missing(connection, "users", "default_model", "VARCHAR(100)")
    _add_column_if_missing(connection, "users", "notify_run_failure", "BOOLEAN NOT NULL DEFAULT 0")
    _add_column_if_missing(
        connection, "users", "notify_weekly_summary", "BOOLEAN NOT NULL DEFAULT 0"
    )


def _migration_012_prompt_variable_metadata(connection) -> None:
    """Add the variable_metadata JSON column to prompts (type + description per variable)."""
    if not _table_exists(connection, "prompts"):
        return

    _add_column_if_missing(connection, "prompts", "variable_metadata", "JSON")


def _migration_013_user_eval_and_library_preferences(connection) -> None:
    """Add Settings preference columns for the Library default view and Evaluate feature."""
    if not _table_exists(connection, "users"):
        return

    _add_column_if_missing(connection, "users", "default_library_view", "VARCHAR(10)")
    _add_column_if_missing(connection, "users", "default_eval_method", "VARCHAR(20)")
    _add_column_if_missing(
        connection, "users", "auto_run_eval_on_update", "BOOLEAN NOT NULL DEFAULT 0"
    )
    _add_column_if_missing(
        connection, "users", "notify_eval_complete", "BOOLEAN NOT NULL DEFAULT 0"
    )
    _add_column_if_missing(
        connection, "users", "notify_eval_regression", "BOOLEAN NOT NULL DEFAULT 0"
    )


def _migration_014_eval_tables(connection) -> None:
    """Create the eval_cases, eval_runs, and eval_run_results tables for the Evaluate tab."""
    connection.execute(
        text(
            "CREATE TABLE IF NOT EXISTS eval_cases ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "prompt_id INTEGER NOT NULL REFERENCES prompts(id), "
            "method VARCHAR(20) NOT NULL, "
            "criteria TEXT, "
            "variables JSON, "
            "position INTEGER NOT NULL DEFAULT 0, "
            "created_at DATETIME"
            ")"
        )
    )
    connection.execute(
        text("CREATE INDEX IF NOT EXISTS ix_eval_cases_prompt_id ON eval_cases (prompt_id)")
    )

    connection.execute(
        text(
            "CREATE TABLE IF NOT EXISTS eval_runs ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "prompt_id INTEGER NOT NULL REFERENCES prompts(id), "
            "prompt_version_number INTEGER NOT NULL DEFAULT 0, "
            "score REAL, "
            "created_at DATETIME"
            ")"
        )
    )
    connection.execute(
        text("CREATE INDEX IF NOT EXISTS ix_eval_runs_prompt_id ON eval_runs (prompt_id)")
    )
    connection.execute(
        text("CREATE INDEX IF NOT EXISTS ix_eval_runs_created_at ON eval_runs (created_at)")
    )

    connection.execute(
        text(
            "CREATE TABLE IF NOT EXISTS eval_run_results ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "eval_run_id INTEGER NOT NULL REFERENCES eval_runs(id), "
            "eval_case_id INTEGER REFERENCES eval_cases(id), "
            "method VARCHAR(20) NOT NULL, "
            "label TEXT NOT NULL, "
            "rationale TEXT, "
            "score REAL, "
            "is_pending BOOLEAN NOT NULL DEFAULT 0, "
            "output_text TEXT"
            ")"
        )
    )
    connection.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_eval_run_results_eval_run_id "
            "ON eval_run_results (eval_run_id)"
        )
    )


def _migration_015_eval_run_metadata(connection) -> None:
    """Add reproducibility metadata to eval_runs (resolved model + aggregated
    cost/latency/tokens) and a per-result snapshot to eval_run_results
    (criteria/variables at run time, plus the judge model actually used) so
    later edits to an EvalCase don't retroactively change what a historical
    run appears to have tested."""
    if _table_exists(connection, "eval_runs"):
        _add_column_if_missing(connection, "eval_runs", "model", "VARCHAR(100) NOT NULL DEFAULT ''")
        _add_column_if_missing(
            connection, "eval_runs", "total_latency_ms", "INTEGER NOT NULL DEFAULT 0"
        )
        _add_column_if_missing(
            connection, "eval_runs", "total_prompt_tokens", "INTEGER NOT NULL DEFAULT 0"
        )
        _add_column_if_missing(
            connection, "eval_runs", "total_completion_tokens", "INTEGER NOT NULL DEFAULT 0"
        )
        _add_column_if_missing(connection, "eval_runs", "total_cost_usd", "REAL NOT NULL DEFAULT 0")

    if _table_exists(connection, "eval_run_results"):
        _add_column_if_missing(connection, "eval_run_results", "criteria", "TEXT")
        _add_column_if_missing(connection, "eval_run_results", "variables", "JSON")
        _add_column_if_missing(connection, "eval_run_results", "judge_model", "VARCHAR(100)")


def _migration_016_billed_calls(connection) -> None:
    """Create the billed_calls table — the unified AI spend ledger written by
    every OpenAI call path so budget ceilings count eval/judge/refine/parse
    spend, not just Playground runs. Existing playground_runs rows are NOT
    backfilled: ledger history starts at deploy time, so month-to-date budget
    visibility resets once (in the user's favor) rather than risking
    double-counting with a permanent UNION over two tables."""
    connection.execute(
        text(
            "CREATE TABLE IF NOT EXISTS billed_calls ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "user_id INTEGER NOT NULL REFERENCES users(id), "
            "source VARCHAR(30) NOT NULL, "
            "model VARCHAR(100) NOT NULL, "
            "prompt_tokens INTEGER NOT NULL DEFAULT 0, "
            "completion_tokens INTEGER NOT NULL DEFAULT 0, "
            "cost_usd REAL NOT NULL DEFAULT 0, "
            "created_at DATETIME"
            ")"
        )
    )
    connection.execute(
        text("CREATE INDEX IF NOT EXISTS ix_billed_calls_user_id ON billed_calls (user_id)")
    )
    connection.execute(
        text("CREATE INDEX IF NOT EXISTS ix_billed_calls_source ON billed_calls (source)")
    )
    connection.execute(
        text("CREATE INDEX IF NOT EXISTS ix_billed_calls_created_at ON billed_calls (created_at)")
    )


def _migration_017_eval_case_metadata(connection) -> None:
    """Add user-facing case names and an explicit intentionally-empty flag."""
    if not _table_exists(connection, "eval_cases"):
        return

    _add_column_if_missing(connection, "eval_cases", "name", "VARCHAR(100)")
    _add_column_if_missing(
        connection,
        "eval_cases",
        "intentionally_empty",
        "BOOLEAN NOT NULL DEFAULT 0",
    )


def _migration_018_prompt_id_sequence(connection) -> None:
    """Persist a prompt-ID high-water mark so SQLite never recycles IDs."""
    connection.execute(
        text(
            "CREATE TABLE IF NOT EXISTS prompt_id_sequence ("
            "singleton INTEGER PRIMARY KEY CHECK (singleton = 1), "
            "last_id INTEGER NOT NULL DEFAULT 0"
            ")"
        )
    )
    connection.execute(
        text(
            "INSERT OR IGNORE INTO prompt_id_sequence (singleton, last_id) "
            "SELECT 1, COALESCE(MAX(id), 0) FROM prompts"
        )
    )
    connection.execute(
        text(
            "UPDATE prompt_id_sequence "
            "SET last_id = MAX(last_id, COALESCE((SELECT MAX(id) FROM prompts), 0)) "
            "WHERE singleton = 1"
        )
    )


def _migration_019_user_llm_connection(connection) -> None:
    """Add per-user bring-your-own LLM provider connection columns, and record
    the provider on every billed call.

    Existing rows are pre-filled with the `openai` provider and the user's
    existing default_model so the Settings form opens already pointing at what
    they were implicitly using — but deliberately *without* an API key. The
    operator's shared OPENAI_API_KEY is never copied into user rows: fanning
    one credential out across N database rows is a worse outcome than a
    signposted "add your API key" empty state. See product/DECISIONS.md.

    billed_calls rows predating this all went through the operator's OpenAI
    key, so backfilling them to 'openai' is accurate rather than a guess.
    """
    if _table_exists(connection, "users"):
        _add_column_if_missing(connection, "users", "llm_provider", "VARCHAR(30)")
        _add_column_if_missing(connection, "users", "llm_base_url", "VARCHAR(500)")
        _add_column_if_missing(connection, "users", "llm_api_key_encrypted", "TEXT")
        _add_column_if_missing(connection, "users", "llm_model", "VARCHAR(200)")
        connection.execute(
            text(
                "UPDATE \"users\" SET llm_provider = 'openai', "
                "llm_model = COALESCE(default_model, 'gpt-4o-mini') "
                "WHERE llm_provider IS NULL"
            )
        )

    if _table_exists(connection, "billed_calls"):
        _add_column_if_missing(
            connection, "billed_calls", "provider", "VARCHAR(30) NOT NULL DEFAULT 'openai'"
        )


# Models whose foreign keys gained ON DELETE behaviour, parents first so a
# rebuilt definition is in place before its dependents are copied across.
#
# These are the mapped classes rather than table names looked up on
# `Base.metadata`: `declarative_base()` is a module-level object that an
# `importlib.reload` of app.database.connection replaces with an empty one,
# whereas `Model.__table__` stays bound to the metadata its class was defined
# against.
_CASCADE_REBUILD_MODELS = (
    Prompt,
    PromptVersion,
    EvalCase,
    EvalRun,
    EvalRunResult,
    PlaygroundRun,
    BilledCall,
)

# (child model, foreign-key column, parent model). Rows pointing at a parent
# that no longer exists predate foreign-key enforcement and would stop the
# rebuilt tables from satisfying their own constraints.
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

# Same, for the nullable references that are cleared rather than removed.
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


def _migration_021_user_token_version(connection) -> None:
    """Add the session-revocation counter to users.

    Existing rows start at 0, which matches the claim absent from tokens minted
    before this column existed, so live sessions survive the upgrade rather than
    every user being signed out on deploy.
    """
    if _table_exists(connection, "users"):
        _add_column_if_missing(connection, "users", "token_version", "INTEGER NOT NULL DEFAULT 0")


_MIGRATIONS: tuple[Migration, ...] = (
    ("001_dynamic_prompt_fields", _migration_001_dynamic_prompt_fields),
    ("002_prompt_user_id", _migration_002_prompt_user_id),
    ("003_prompt_name", _migration_003_prompt_name),
    ("004_user_email_reset", _migration_004_user_email_reset),
    ("005_prompt_updated_at", _migration_005_prompt_updated_at),
    ("006_prompt_folder", _migration_006_prompt_folder),
    ("007_prompt_favorite", _migration_007_prompt_favorite),
    ("008_prompt_tags", _migration_008_prompt_tags),
    ("009_prompt_versions", _migration_009_prompt_versions),
    ("010_playground_runs", _migration_010_playground_runs),
    ("011_user_preferences", _migration_011_user_preferences),
    ("012_prompt_variable_metadata", _migration_012_prompt_variable_metadata),
    ("013_user_eval_and_library_preferences", _migration_013_user_eval_and_library_preferences),
    ("014_eval_tables", _migration_014_eval_tables),
    ("015_eval_run_metadata", _migration_015_eval_run_metadata),
    ("016_billed_calls", _migration_016_billed_calls),
    ("017_eval_case_metadata", _migration_017_eval_case_metadata),
    ("018_prompt_id_sequence", _migration_018_prompt_id_sequence),
    ("019_user_llm_connection", _migration_019_user_llm_connection),
    ("020_delete_cascades", _migration_020_delete_cascades),
    ("021_user_token_version", _migration_021_user_token_version),
)
