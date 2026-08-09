"""
Unit tests for Pydantic schemas.
"""

from datetime import UTC, datetime

from pydantic import ValidationError
import pytest

from app.models.schemas import (
    EvalCaseCreateRequest,
    EvalRunRateRequest,
    ParseTextRequest,
    PromptField,
    PromptHistoryResponse,
    PromptRequest,
    PromptResponse,
    PromptUpdateRequest,
    RefineDraftRequest,
    VariableMetadataItem,
)


class TestPromptField:
    """Test cases for PromptField schema."""

    def test_valid_prompt_field(self):
        """Test creating a valid PromptField."""
        field = PromptField(name="goal", content="Create a story")
        assert field.name == "goal"
        assert field.content == "Create a story"

    def test_prompt_field_empty_name(self):
        """Test that empty name is rejected."""
        with pytest.raises(ValidationError):
            PromptField(name="", content="Some content")

    def test_prompt_field_missing_name(self):
        """Test that missing name is rejected."""
        with pytest.raises(ValidationError):
            PromptField(content="Some content")

    def test_prompt_field_missing_content(self):
        """Test that missing content is rejected."""
        with pytest.raises(ValidationError):
            PromptField(name="goal")

    def test_prompt_field_name_with_space_rejected(self):
        """Names with spaces produce invalid XML tags — must be rejected."""
        with pytest.raises(ValidationError):
            PromptField(name="bad name", content="Some content")

    def test_prompt_field_name_starting_with_digit_rejected(self):
        """Names starting with a digit produce invalid XML tags — must be rejected."""
        with pytest.raises(ValidationError):
            PromptField(name="123abc", content="Some content")

    def test_prompt_field_name_with_angle_bracket_rejected(self):
        """Names containing angle brackets would break XML output — must be rejected."""
        with pytest.raises(ValidationError):
            PromptField(name="<script>", content="Some content")

    def test_prompt_field_name_too_long_rejected(self):
        """Names exceeding 100 chars are rejected."""
        with pytest.raises(ValidationError):
            PromptField(name="a" * 101, content="Some content")

    def test_prompt_field_name_with_hyphen_allowed(self):
        """Hyphens are valid in XML tag names and must be accepted."""
        field = PromptField(name="my-field", content="value")
        assert field.name == "my-field"

    def test_prompt_field_name_with_underscore_allowed(self):
        """Underscores are valid in XML tag names and must be accepted."""
        field = PromptField(name="_private", content="value")
        assert field.name == "_private"

    def test_prompt_field_content_too_long_rejected(self):
        """Content exceeding 10 000 chars is rejected."""
        with pytest.raises(ValidationError):
            PromptField(name="goal", content="x" * 10_001)


class TestPromptRequest:
    """Test cases for PromptRequest schema."""

    def test_valid_prompt_request_with_single_field(self):
        """Test creating a valid PromptRequest with one field."""
        data = {"fields": [{"name": "goal", "content": "Create a story"}]}
        request = PromptRequest(**data)

        assert len(request.fields) == 1
        assert request.fields[0].name == "goal"
        assert request.fields[0].content == "Create a story"

    def test_valid_prompt_request_with_multiple_fields(self):
        """Test creating a valid PromptRequest with multiple fields."""
        data = {
            "fields": [
                {"name": "goal", "content": "Create a story"},
                {"name": "characters", "content": "Hero and villain"},
                {"name": "style", "content": "Epic"},
                {"name": "setting", "content": "Fantasy world"},
            ]
        }

        request = PromptRequest(**data)

        assert len(request.fields) == 4
        assert request.fields[0].name == "goal"
        assert request.fields[1].name == "characters"
        assert request.fields[2].name == "style"
        assert request.fields[3].name == "setting"

    def test_invalid_prompt_request_missing_fields(self):
        """Test that PromptRequest validation fails without fields."""
        data = {}

        with pytest.raises(ValidationError) as exc_info:
            PromptRequest(**data)

        errors = exc_info.value.errors()
        assert any(error["loc"] == ("fields",) for error in errors)

    def test_invalid_prompt_request_empty_fields(self):
        """Test that PromptRequest validation fails with empty fields array."""
        data = {"fields": []}

        with pytest.raises(ValidationError) as exc_info:
            PromptRequest(**data)

        errors = exc_info.value.errors()
        assert any("fields" in str(error["loc"]) for error in errors)

    def test_invalid_prompt_request_too_many_fields_rejected(self):
        """Regression test for Low (Security): fields had no upper bound,
        unlike tags (capped at 20) — bounded only indirectly by Caddy's
        10MB body-size limit."""
        data = {
            "fields": [{"name": f"field_{i}", "content": "x"} for i in range(101)],
        }

        with pytest.raises(ValidationError) as exc_info:
            PromptRequest(**data)

        errors = exc_info.value.errors()
        assert any(error["loc"] == ("fields",) for error in errors)

    def test_valid_prompt_request_at_field_cap(self):
        """Exactly 100 fields is accepted."""
        data = {
            "fields": [{"name": f"field_{i}", "content": "x"} for i in range(100)],
        }
        request = PromptRequest(**data)
        assert len(request.fields) == 100

    def test_invalid_prompt_request_duplicate_field_names(self):
        """Test that PromptRequest validation fails with duplicate field names."""
        data = {
            "fields": [
                {"name": "goal", "content": "First"},
                {"name": "goal", "content": "Second"},
            ]
        }

        with pytest.raises(ValidationError) as exc_info:
            PromptRequest(**data)

        assert "Field names must be unique" in str(exc_info.value)

    def test_valid_prompt_request_custom_field_names(self):
        """Test that custom field names are allowed."""
        data = {
            "fields": [
                {"name": "custom_field", "content": "Custom content"},
                {"name": "another-field", "content": "Another content"},
            ]
        }

        request = PromptRequest(**data)
        assert len(request.fields) == 2
        assert request.fields[0].name == "custom_field"
        assert request.fields[1].name == "another-field"


class TestPromptResponse:
    """Test cases for PromptResponse schema."""

    def test_valid_prompt_response(self):
        """Test creating a valid PromptResponse."""
        data = {
            "id": 1,
            "name": None,
            "generated_prompt": "<GOAL>\nTest\n</GOAL>",
            "created_at": datetime.now(UTC),
        }

        response = PromptResponse(**data)
        assert response.id == 1
        assert response.name is None
        assert response.generated_prompt == "<GOAL>\nTest\n</GOAL>"
        assert isinstance(response.created_at, datetime)


class TestPromptHistoryResponse:
    """Test cases for PromptHistoryResponse schema."""

    def test_valid_history_response_with_multiple_fields(self):
        """Test creating a valid PromptHistoryResponse with multiple fields."""
        data = {
            "id": 1,
            "name": "My Template",
            "fields": [
                {"name": "goal", "content": "Create a character"},
                {"name": "characters", "content": "Hero"},
                {"name": "style", "content": "Dark"},
            ],
            "generated_prompt": "<GOAL>\nCreate a character\n</GOAL>",
            "created_at": datetime.now(UTC),
        }

        response = PromptHistoryResponse(**data)
        assert response.id == 1
        assert response.name == "My Template"
        assert len(response.fields) == 3
        assert response.fields[0].name == "goal"
        assert response.fields[0].content == "Create a character"

    def test_valid_history_response_with_single_field(self):
        """Test creating a valid PromptHistoryResponse with single field."""
        data = {
            "id": 1,
            "name": None,
            "fields": [{"name": "goal", "content": "Test"}],
            "generated_prompt": "Test prompt",
            "created_at": datetime.now(UTC),
        }

        response = PromptHistoryResponse(**data)
        assert response.id == 1
        assert response.name is None
        assert len(response.fields) == 1
        assert response.fields[0].name == "goal"
        # Default when the caller (e.g. a fresh ORM instance) doesn't set it.
        assert response.run_count == 0

    def test_variable_metadata_round_trips(self):
        data = {
            "id": 1,
            "name": None,
            "fields": [{"name": "goal", "content": "Test"}],
            "generated_prompt": "Hi {{customer_name}}",
            "created_at": datetime.now(UTC),
            "variable_metadata": {
                "customer_name": {"type": "text", "description": "Who to address"}
            },
        }
        response = PromptHistoryResponse(**data)
        assert response.variable_metadata["customer_name"].type == "text"
        assert response.variable_metadata["customer_name"].description == "Who to address"


class TestVariableMetadataItem:
    """Test cases for VariableMetadataItem schema."""

    def test_defaults_to_text_type_and_no_description(self):
        item = VariableMetadataItem()
        assert item.type == "text"
        assert item.description is None

    def test_accepts_all_valid_types(self):
        for valid_type in ("text", "number", "boolean", "list"):
            assert VariableMetadataItem(type=valid_type).type == valid_type

    def test_rejects_invalid_type(self):
        with pytest.raises(ValidationError):
            VariableMetadataItem(type="date")

    def test_description_too_long_rejected(self):
        with pytest.raises(ValidationError):
            VariableMetadataItem(description="x" * 501)


class TestParseTextRequest:
    """Test cases for ParseTextRequest schema."""

    def test_valid_parse_text_request(self):
        req = ParseTextRequest(text="Write a story about a dragon.")
        assert req.text == "Write a story about a dragon."

    def test_empty_text_rejected(self):
        with pytest.raises(ValidationError):
            ParseTextRequest(text="")

    def test_text_at_max_boundary_accepted(self):
        ParseTextRequest(text="x" * 10_000)

    def test_text_exceeding_max_rejected(self):
        with pytest.raises(ValidationError):
            ParseTextRequest(text="x" * 10_001)


class TestPromptUpdateRequest:
    """Test cases for PromptUpdateRequest schema."""

    def test_all_fields_optional(self):
        req = PromptUpdateRequest()
        assert req.name is None
        assert req.fields is None
        assert req.generated_prompt is None
        assert req.variable_metadata is None

    def test_generated_prompt_at_max_boundary_accepted(self):
        PromptUpdateRequest(generated_prompt="x" * 50_000)

    def test_generated_prompt_exceeding_max_rejected(self):
        with pytest.raises(ValidationError):
            PromptUpdateRequest(generated_prompt="x" * 50_001)

    def test_note_optional_and_bounded(self):
        assert PromptUpdateRequest().note is None
        PromptUpdateRequest(note="x" * 255)
        with pytest.raises(ValidationError):
            PromptUpdateRequest(note="x" * 256)

    def test_fields_too_many_rejected(self):
        """Regression test for Low (Security): fields had no upper bound."""
        with pytest.raises(ValidationError):
            PromptUpdateRequest(fields=[{"name": f"field_{i}", "content": "x"} for i in range(101)])


class TestEvalCaseCreateRequest:
    """Test cases for EvalCaseCreateRequest schema."""

    def test_valid_rule_case(self):
        req = EvalCaseCreateRequest(method="rule", criteria="hello, world", variables={})
        assert req.method == "rule"

    def test_rejects_invalid_method(self):
        with pytest.raises(ValidationError):
            EvalCaseCreateRequest(method="vibes", criteria=None, variables={})

    def test_criteria_exceeding_max_rejected(self):
        with pytest.raises(ValidationError):
            EvalCaseCreateRequest(method="rule", criteria="x" * 2001, variables={})

    def test_too_many_variables_rejected(self):
        with pytest.raises(ValidationError):
            EvalCaseCreateRequest(
                method="manual", criteria=None, variables={f"v{i}": "x" for i in range(51)}
            )

    def test_variable_value_too_long_rejected(self):
        with pytest.raises(ValidationError):
            EvalCaseCreateRequest(method="manual", criteria=None, variables={"v": "x" * 10_001})


class TestEvalRunRateRequest:
    """Test cases for EvalRunRateRequest schema."""

    def test_valid_stars_boundaries(self):
        assert EvalRunRateRequest(stars=1).stars == 1
        assert EvalRunRateRequest(stars=5).stars == 5

    def test_rejects_zero_stars(self):
        with pytest.raises(ValidationError):
            EvalRunRateRequest(stars=0)

    def test_rejects_six_stars(self):
        with pytest.raises(ValidationError):
            EvalRunRateRequest(stars=6)


class TestRefineDraftRequest:
    """Test cases for RefineDraftRequest schema."""

    def test_valid_qa_pairs(self):
        req = RefineDraftRequest(qa_pairs=[{"question": "What tone?", "answer": "Formal"}])
        assert len(req.qa_pairs) == 1

    def test_rejects_empty_qa_pairs(self):
        with pytest.raises(ValidationError):
            RefineDraftRequest(qa_pairs=[])

    def test_rejects_too_many_qa_pairs(self):
        with pytest.raises(ValidationError):
            RefineDraftRequest(qa_pairs=[{"question": "q", "answer": "a"} for _ in range(11)])
