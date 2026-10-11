"""Tests for backend/scripts/seed_demo_user.py."""

from pathlib import Path
import subprocess
import sys
from unittest.mock import patch

import pytest

from app.auth.utils import verify_password
from app.models.playground_run import PlaygroundRun
from app.models.prompt import Prompt
from app.models.prompt_version import PromptVersion
from app.models.user import User
from app.services.prompt_sections import render_sections
from scripts.seed_demo_user import EMAIL, PASSWORD, USERNAME, main, seed_alex


class TestMainOptIn:
    """`main()` must not create the known-credential account without opt-in."""

    def test_exits_without_opt_in_env_var(self, monkeypatch):
        monkeypatch.delenv("SEED_DEMO_USER", raising=False)

        with (
            patch("scripts.seed_demo_user.SessionLocal") as session_local,
            pytest.raises(SystemExit) as exc_info,
        ):
            main()

        assert exc_info.value.code == 1
        session_local.assert_not_called()

    def test_exits_when_opt_in_value_is_not_exactly_one(self, monkeypatch):
        monkeypatch.setenv("SEED_DEMO_USER", "true")

        with (
            patch("scripts.seed_demo_user.SessionLocal") as session_local,
            pytest.raises(SystemExit),
        ):
            main()

        session_local.assert_not_called()

    def test_seeds_when_opt_in_is_set(self, monkeypatch, db_session):
        monkeypatch.setenv("SEED_DEMO_USER", "1")

        with patch("scripts.seed_demo_user.SessionLocal", return_value=db_session):
            main()

        assert db_session.query(User).filter(User.username == USERNAME).count() == 1


class TestSeedAlex:
    def test_creates_user_with_expected_credentials(self, db_session):
        user = seed_alex(db_session)

        assert user.username == USERNAME
        assert user.email == EMAIL
        assert verify_password(PASSWORD, user.hashed_password)
        # Seeded pointing at a provider, but deliberately keyless — provider
        # credentials are bring-your-own.
        assert user.llm_provider == "openai"
        assert user.llm_model is not None
        assert user.llm_api_key_encrypted is None

    def test_seeds_a_library_showing_every_way_to_organise_it(self, db_session):
        user = seed_alex(db_session)

        prompts = db_session.query(Prompt).filter(Prompt.user_id == user.id).all()
        folders = {p.folder for p in prompts}

        assert len(prompts) >= 10
        assert all(p.name for p in prompts)
        assert {"Work", "Writing", "Learning", "Personal", "Recovered history"} <= folders
        assert None in folders  # an unfiled prompt
        assert any(p.is_favorite for p in prompts)
        assert any(p.variable_metadata for p in prompts)
        assert not any(p.tags for p in prompts)

    def test_every_prompt_and_version_text_is_rendered_from_its_sections(self, db_session):
        """The demo data obeys the same rule as the API: sections are the source."""
        user = seed_alex(db_session)

        prompts = db_session.query(Prompt).filter(Prompt.user_id == user.id).all()
        versions = (
            db_session.query(PromptVersion)
            .filter(PromptVersion.prompt_id.in_([p.id for p in prompts]))
            .all()
        )
        for row in [*prompts, *versions]:
            assert row.generated_prompt == render_sections(row.fields)

    def test_seeds_version_histories_worth_comparing(self, db_session):
        user = seed_alex(db_session)

        weekly = (
            db_session.query(Prompt)
            .filter(Prompt.user_id == user.id, Prompt.name == "Weekly status update")
            .one()
        )
        versions = sorted(weekly.versions, key=lambda v: v.version_number)
        assert [v.version_number for v in versions] == [1, 2]
        assert versions[1].note == "Added the Asks section"
        assert all(v.created_at < weekly.updated_at for v in versions)
        assert all(v.generated_prompt != weekly.generated_prompt for v in versions)

    def test_seeds_no_playground_runs(self, db_session):
        seed_alex(db_session)

        assert db_session.query(PlaygroundRun).count() == 0

    def test_rerun_is_idempotent_not_duplicated(self, db_session):
        seed_alex(db_session)
        first_prompt_count = db_session.query(Prompt).count()
        first_version_count = db_session.query(PromptVersion).count()

        second = seed_alex(db_session)

        # Exactly one alex account — re-running replaces rather than layers on top.
        assert db_session.query(User).filter(User.username == USERNAME).count() == 1
        assert (
            db_session.query(Prompt).filter(Prompt.user_id == second.id).count()
            == first_prompt_count
        )
        assert db_session.query(PromptVersion).count() == first_version_count

    def test_reseeding_clears_runs_left_by_older_seeds(self, db_session):
        user = seed_alex(db_session)
        prompt = db_session.query(Prompt).filter(Prompt.user_id == user.id).first()
        db_session.add(
            PlaygroundRun(
                prompt_id=prompt.id,
                user_id=user.id,
                model="gpt-4o-mini",
                output_text="old",
                latency_ms=1,
                prompt_tokens=1,
                completion_tokens=1,
                cost_usd=0.0,
                status="success",
            )
        )
        db_session.commit()

        seed_alex(db_session)

        assert db_session.query(PlaygroundRun).count() == 0


class TestModelRegistryIsComplete:
    """The seed script imports four models; `User` and `Prompt` relate to nine.

    SQLAlchemy resolves `relationship("BilledCall", ...)` by name, lazily, the
    first time a mapper is configured — so a process that imports only some
    models fails at runtime, not at import. That is exactly how `make
    screenshots` broke when `User` gained `billed_calls`:

        sqlalchemy.exc.InvalidRequestError: When initializing mapper
        Mapper[User(users)], expression 'BilledCall' failed to locate a name

    `app/models/__init__.py` re-exports every model to keep the registry
    complete for any entry point. The whole test suite imports the models
    transitively, so it cannot catch a regression here — this has to be a fresh
    interpreter that imports exactly one.
    """

    def test_importing_one_model_configures_every_mapper(self):
        code = (
            "from app.models.user import User;"
            "from sqlalchemy.orm import configure_mappers;"
            "configure_mappers()"
        )
        result = subprocess.run(
            [sys.executable, "-c", code], capture_output=True, text=True, timeout=60, check=False
        )
        assert result.returncode == 0, result.stderr

    def test_every_model_module_is_re_exported(self):
        """A new model file that nobody adds to `__init__` reintroduces the bug."""
        import app.models

        module_names = {
            path.stem
            for path in Path(app.models.__file__).parent.glob("*.py")
            if path.stem not in {"__init__", "schemas"}
        }
        exported_modules = {
            getattr(app.models, name).__module__.rsplit(".", 1)[-1] for name in app.models.__all__
        }
        assert module_names == exported_modules
