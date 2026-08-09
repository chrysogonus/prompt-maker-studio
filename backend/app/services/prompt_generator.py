"""
Business logic for generating prompts based on user input.
"""

from app.models.schemas import PromptField


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
        prompt_parts = []

        for field in fields:
            # Normalize field name to uppercase for XML tags
            tag_name = field.name.upper()
            # Field content is preserved verbatim: the <TAG> wrapper is a
            # convention for the LLM reading the prompt, not markup any parser
            # in this app consumes, so entity-escaping it would silently
            # corrupt what the user typed (round-trip fidelity through
            # save/compile/copy/export matters more than strict well-formedness).
            prompt_parts.append(f"<{tag_name}>\n{field.content}\n</{tag_name}>")

        return "\n\n".join(prompt_parts)
