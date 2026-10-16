---
name: db-migration
description: Add or modify a database column/table in Prompt Maker Studio's SQLite schema, using the repo's custom idempotent migration runner (no Alembic). Use when asked to change the database schema, add a column, add a table, or migrate the database.
---

# Database schema change

This repo does **not** use Alembic or any migration-tool CLI. Do not run a `.sql` file directly against a database, and do not hand-edit rows in `schema_migrations`.

The real mechanism:

1. **Update the SQLAlchemy model** in `backend/app/models/` (the matching entity module) to reflect the new column/table — this is what `Base.metadata.create_all(...)` uses for fresh databases. Re-export new models from `backend/app/models/__init__.py`; declare appropriate ORM and database delete behavior for owned data.
2. **Add a migration step** as a new `vNNN_*.py` module in `backend/app/database/migrations/`, then register its stable ID and function in `registry.py`. Follow the pattern of existing numbered migrations (read `backend/app/database/migrations/registry.py` for the next ID and `backend/migrations/README.md` for historical behavior) — each backfills/adds what `create_all()` can't change on an existing SQLite table, and the runner records the completed ID in `schema_migrations`. Keep applied IDs and ordering stable; make the step idempotent and preserve historical upgrade behavior.
3. **Document the upgrade** — add the migration to `backend/migrations/README.md`. **Add a reference `.sql` file** in `backend/migrations/` with the same number as the registered step, documenting the equivalent raw SQL — this is a historical reference only, never executed directly by the app or by you.
4. **Update Pydantic schemas** in `backend/app/schemas/` if the new column is exposed via the API.
5. **Write/extend tests** — `backend/tests/test_migrations.py` covers legacy-schema upgrade and idempotency; add a case there for the new migration step. Also check `backend/tests/test_models.py` / `test_schemas.py` if the model or schema shape changed.
6. **Verify**: `.venv/bin/pytest backend/tests/test_migrations.py backend/tests/test_backup_restore.py -q`, then `make lint-backend && make test`.

Full detail and the production deployment checklist (backup before deploy, verify migration log lines, restore procedure if validation fails): `backend/migrations/README.md`. Do not run `make restore-db` yourself — that's a human-confirmed, production-affecting action.
