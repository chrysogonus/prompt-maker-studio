"""
Unit tests for the PromptGeneratorService.
"""

from app.models.schemas import PromptField
from app.services.prompt_generator import PromptGeneratorService


class TestPromptGeneratorService:
    """Test cases for the prompt generator service."""

    def test_generate_with_single_field(self):
        """Test generating a prompt with a single field."""
        fields = [PromptField(name="goal", content="Create a hero")]
        result = PromptGeneratorService.generate(fields=fields)

        assert "<GOAL>" in result
        assert "Create a hero" in result
        assert "</GOAL>" in result

    def test_generate_with_multiple_fields(self):
        """Test generating a prompt with multiple fields."""
        fields = [
            PromptField(name="goal", content="Create a fantasy character"),
            PromptField(name="characters", content="A brave knight named Sir Roland"),
            PromptField(name="style", content="Epic and heroic"),
            PromptField(name="setting", content="Medieval kingdom under siege"),
        ]
        result = PromptGeneratorService.generate(fields=fields)

        # Check all XML tags are present
        assert "<GOAL>" in result
        assert "Create a fantasy character" in result
        assert "</GOAL>" in result

        assert "<CHARACTERS>" in result
        assert "A brave knight named Sir Roland" in result
        assert "</CHARACTERS>" in result

        assert "<STYLE>" in result
        assert "Epic and heroic" in result
        assert "</STYLE>" in result

        assert "<SETTING>" in result
        assert "Medieval kingdom under siege" in result
        assert "</SETTING>" in result

    def test_generate_xml_formatting(self):
        """Test that XML tags are properly formatted."""
        fields = [PromptField(name="test", content="Test content")]
        result = PromptGeneratorService.generate(fields=fields)

        # Check proper XML structure with newlines
        assert result.startswith("<TEST>\n")
        assert result.endswith("</TEST>")
        assert "Test content" in result

    def test_generate_preserves_multiline_content(self):
        """Test that multiline content is preserved in XML tags."""
        multiline_content = "Line 1\nLine 2\nLine 3"
        fields = [PromptField(name="goal", content=multiline_content)]
        result = PromptGeneratorService.generate(fields=fields)

        assert "Line 1\nLine 2\nLine 3" in result
        assert "<GOAL>" in result
        assert "</GOAL>" in result

    def test_generate_with_special_characters(self):
        """Content containing apostrophes/quotes passes through unescaped (XML-safe as-is)."""
        fields = [
            PromptField(name="characters", content="Character's name with apostrophe"),
        ]
        result = PromptGeneratorService.generate(fields=fields)

        assert "Character's name with apostrophe" in result

    def test_generate_preserves_angle_brackets_and_ampersands(self):
        """Regression test: field content containing '<', '>', '&' must survive
        generation byte-for-byte. A prior fix HTML-entity-escaped this content to
        keep the output parseable as strict XML, but that silently corrupted the
        prompt users actually save/compile/copy/export — the <TAG> wrapper is an
        LLM-facing convention, not markup any parser in this app consumes."""
        fields = [
            PromptField(name="goal", content="if x < 10 then y > 0 & z != 1"),
        ]
        result = PromptGeneratorService.generate(fields=fields)

        assert "if x < 10 then y > 0 & z != 1" in result
        assert "&lt;" not in result
        assert "&amp;" not in result
        # The tag markers themselves must remain real angle brackets.
        assert result.startswith("<GOAL>\n")
        assert result.endswith("</GOAL>")

    def test_generate_round_trips_reserved_characters(self):
        """Round-trip fidelity for all HTML/XML-significant characters a prompt
        author might type: & < > " '."""
        reserved_content = """Use "quotes" & <tags> and 'apostrophes' > all preserved"""
        fields = [PromptField(name="goal", content=reserved_content)]
        result = PromptGeneratorService.generate(fields=fields)

        assert reserved_content in result

    def test_generate_with_custom_field_names(self):
        """Test that custom field names are properly converted to XML tags."""
        fields = [
            PromptField(name="custom_field", content="Custom content"),
            PromptField(name="another-field", content="Another content"),
        ]
        result = PromptGeneratorService.generate(fields=fields)

        assert "<CUSTOM_FIELD>" in result
        assert "Custom content" in result
        assert "</CUSTOM_FIELD>" in result

        assert "<ANOTHER-FIELD>" in result
        assert "Another content" in result
        assert "</ANOTHER-FIELD>" in result

    def test_generate_empty_fields_list(self):
        """Test generating with empty fields list."""
        fields = []
        result = PromptGeneratorService.generate(fields=fields)

        assert result == ""
