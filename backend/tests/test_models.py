"""
Unit tests for database models.
"""

from datetime import UTC, datetime

import pytest

from app.models.prompt import Prompt
from app.models.user import User


@pytest.fixture
def test_user(db_session) -> User:
    """Create and persist a minimal user so Prompt FK constraints are satisfied."""
    user = User(username="modeltest", hashed_password="hashed")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


class TestPromptModel:
    """Test cases for the Prompt database model."""

    def test_create_prompt_with_multiple_fields(self, db_session, test_user):
        """Test creating a prompt with multiple fields."""
        prompt = Prompt(
            user_id=test_user.id,
            fields=[
                {"name": "goal", "content": "Create a character"},
                {"name": "characters", "content": "Hero and villain"},
                {"name": "style", "content": "Dark and mysterious"},
                {"name": "setting", "content": "Post-apocalyptic world"},
            ],
            generated_prompt="<GOAL>\nCreate a character\n</GOAL>",
        )

        db_session.add(prompt)
        db_session.commit()
        db_session.refresh(prompt)

        assert prompt.id is not None
        assert prompt.user_id == test_user.id
        assert len(prompt.fields) == 4
        assert prompt.fields[0]["name"] == "goal"
        assert prompt.fields[0]["content"] == "Create a character"
        assert prompt.fields[1]["name"] == "characters"
        assert prompt.fields[1]["content"] == "Hero and villain"
        assert prompt.generated_prompt == "<GOAL>\nCreate a character\n</GOAL>"
        assert isinstance(prompt.created_at, datetime)

    def test_create_prompt_with_single_field(self, db_session, test_user):
        """Test creating a prompt with a single field."""
        prompt = Prompt(
            user_id=test_user.id,
            fields=[{"name": "goal", "content": "Test goal"}],
            generated_prompt="<GOAL>\nTest goal\n</GOAL>",
        )

        db_session.add(prompt)
        db_session.commit()
        db_session.refresh(prompt)

        assert prompt.id is not None
        assert len(prompt.fields) == 1
        assert prompt.fields[0]["name"] == "goal"
        assert prompt.fields[0]["content"] == "Test goal"

    def test_prompt_created_at_auto_set(self, db_session, test_user):
        """Test that created_at is automatically set."""
        prompt = Prompt(
            user_id=test_user.id,
            fields=[{"name": "test", "content": "test"}],
            generated_prompt="Test prompt",
        )

        db_session.add(prompt)
        db_session.commit()
        db_session.refresh(prompt)

        assert prompt.created_at is not None
        assert isinstance(prompt.created_at, datetime)
        # Compare timestamps (created_at from DB is naive, so compare as UTC)
        now = datetime.now(UTC)
        created_naive = (
            prompt.created_at.replace(tzinfo=None)
            if prompt.created_at.tzinfo
            else prompt.created_at
        )
        now_naive = now.replace(tzinfo=None)
        assert created_naive <= now_naive

    def test_query_prompts(self, db_session, test_user):
        """Test querying prompts from database, scoped to the owning user."""
        prompt1 = Prompt(
            user_id=test_user.id,
            fields=[{"name": "goal", "content": "Goal 1"}],
            generated_prompt="Prompt 1",
        )
        prompt2 = Prompt(
            user_id=test_user.id,
            fields=[{"name": "goal", "content": "Goal 2"}],
            generated_prompt="Prompt 2",
        )

        db_session.add(prompt1)
        db_session.add(prompt2)
        db_session.commit()

        # Query all prompts for this user
        prompts = db_session.query(Prompt).filter(Prompt.user_id == test_user.id).all()
        assert len(prompts) == 2

        # Query specific prompt by generated_prompt (more compatible than JSON querying)
        found = db_session.query(Prompt).filter_by(generated_prompt="Prompt 1").first()
        assert found is not None
        assert found.fields[0]["content"] == "Goal 1"
