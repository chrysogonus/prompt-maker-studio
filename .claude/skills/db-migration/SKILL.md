---
name: db-migration
description: Add or modify a database column/table in Prompt Maker Studio's SQLite schema, using the repo's custom idempotent migration runner (no Alembic). Use when asked to change the database schema, add a column, add a table, or migrate the database.
---

# Database schema change

This repo does **not** use Alembic or any migration-tool CLI. Do not run a `.sql` file directly against a database, and do not hand-edit rows in `schema_migrations`.

The real mechanism:

1. **Update the SQLAlchemy model** in `backend/app/models/` (`prompt.py` or `user.py`) to reflect the new column/table — this is what `Base.metadata.create_all(...)` uses for fresh databases.
2. **Add a migration step** in `backend/app/database/migrations.py`. Follow the pattern of existing numbered migrations (see `backend/migrations/README.md` for the current list, e.g. `001_dynamic_prompt_fields` through `018_prompt_id_sequence`) — each backfills/adds what `create_all()` can't change on an existing SQLite table, and records itself in `schema_migrations` so the runner is safe to re-run.
3. **Add a reference `.sql` file** in `backend/migrations/` with the next sequential number (check `backend/migrations/README.md` or `backend/app/database/migrations.py` for the latest number), documenting the equivalent raw SQL — this is a historical reference only, never executed directly by the app or by you.
4. **Update Pydantic schemas** in `backend/app/models/schemas.py` if the new column is exposed via the API.
5. **Write/extend tests** — `backend/tests/test_migrations.py` covers legacy-schema upgrade and idempotency; add a case there for the new migration step. Also check `backend/tests/test_models.py` / `test_schemas.py` if the model or schema shape changed.
6. **Verify**: `.venv/bin/pytest backend/tests/test_migrations.py backend/tests/test_backup_restore.py -q`, then `make lint-backend && make test`.

Full detail and the production deployment checklist (backup before deploy, verify migration log lines, restore procedure if validation fails): `backend/migrations/README.md`. Do not run `make restore-db` yourself — that's a human-confirmed, production-affecting action.
