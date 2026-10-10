"""
Business logic for generating prompts based on user input.
"""

from app.models.schemas import PromptField
from app.services.prompt_sections import render_sections


class PromptGeneratorService:
    """
    Generates structured prompts from user-provided parameters.
    Follows clean coding principles with single responsibility.
    """

    @staticmethod
    def generate(fields: list[PromptField]) -> str:
        """
        Generate a comprehensive prompt with XML tag notation from input fields.

        Args:
            fields: List of PromptField objects with name and content

        Returns:
            A formatted prompt string with XML tags
        """
        return render_sections(field.model_dump() for field in fields)
