"""Prompt operations are usable independently of REST and MCP adapters."""

import pytest

from app.models.prompt import Prompt
from app.models.prompt_version import PromptVersion
from app.models.user import User
from app.schemas.prompts import PromptCreateRequest, PromptUpdateRequest
from app.services.errors import OperationError
from app.services.prompts.library import create_prompt, get_prompt_by_id, update_prompt


@pytest.fixture
def test_user(db_session, auth_headers):
    return db_session.query(User).filter(User.username == "testuser").one()


def test_service_preserves_rendering_versions_and_ownership(db_session, test_user):
    prompt = create_prompt(
        PromptCreateRequest(name="Service", fields=[{"name": "Task", "content": "First"}]),
        db_session,
        test_user.id,
    )
    updated = update_prompt(
        prompt.id,
        PromptUpdateRequest(fields=[{"name": "Task", "content": "Second"}]),
        db_session,
        test_user.id,
    )
    assert updated.generated_prompt == "<TASK>\nSecond\n</TASK>"
    assert db_session.query(PromptVersion).one().generated_prompt == "<TASK>\nFirst\n</TASK>"
    with pytest.raises(OperationError, match="Prompt not found"):
        get_prompt_by_id(prompt.id, db_session, test_user.id + 1)


def test_failed_update_does_not_commit_its_snapshot(db_session, test_user, monkeypatch):
    prompt = create_prompt(
        PromptCreateRequest(name="Service", fields=[{"name": "Task", "content": "First"}]),
        db_session,
        test_user.id,
    )
    prompt_id = prompt.id

    def fail_render(_fields):
        message = "Rendering failed"
        raise RuntimeError(message)

    monkeypatch.setattr("app.services.prompts.library.render_sections", fail_render)
    with pytest.raises(RuntimeError, match="Rendering failed"):
        update_prompt(
            prompt_id,
            PromptUpdateRequest(fields=[{"name": "Task", "content": "Second"}]),
            db_session,
            test_user.id,
        )
    db_session.rollback()
    assert db_session.get(Prompt, prompt_id).generated_prompt == "<TASK>\nFirst\n</TASK>"
    assert db_session.query(PromptVersion).count() == 0


def test_organization_preserves_content_recency_but_advances_conflict_stamp(db_session, test_user):
    prompt = create_prompt(
        PromptCreateRequest(name="Recency", fields=[{"name": "Task", "content": "First"}]),
        db_session,
        test_user.id,
    )
    created = prompt.created_at
    assert prompt.content_updated_at is None
    update_prompt(prompt.id, PromptUpdateRequest(is_favorite=True), db_session, test_user.id)
    favorite_stamp = prompt.updated_at
    assert favorite_stamp > created
    assert prompt.content_updated_at is None
    update_prompt(
        prompt.id,
        PromptUpdateRequest(fields=[{"name": "Task", "content": "Second"}]),
        db_session,
        test_user.id,
    )
    edited = prompt.content_updated_at
    assert edited > favorite_stamp
    update_prompt(
        prompt.id, PromptUpdateRequest(folder="Work", name="Better name"), db_session, test_user.id
    )
    assert prompt.content_updated_at == edited
    assert prompt.updated_at > edited
    assert db_session.query(PromptVersion).count() == 1


def test_restore_counts_as_content_edit(db_session, test_user):
    from app.services.prompts.versions import restore_prompt_version

    prompt = create_prompt(
        PromptCreateRequest(name="Restore", fields=[{"name": "Task", "content": "First"}]),
        db_session,
        test_user.id,
    )
    update_prompt(
        prompt.id,
        PromptUpdateRequest(fields=[{"name": "Task", "content": "Second"}]),
        db_session,
        test_user.id,
    )
    previous_stamp = prompt.content_updated_at
    version = db_session.query(PromptVersion).one()
    restored = restore_prompt_version(prompt.id, version.id, db_session, test_user.id)
    assert restored.content_updated_at > previous_stamp
    assert restored.content_updated_at == restored.updated_at
    assert restored.fields[0]["content"] == "First"
