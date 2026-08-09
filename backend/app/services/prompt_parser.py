"""
Service for converting natural language text into structured prompt fields
using the acting user's own LLM provider, via the shared JSON-completion
helper in services/llm_client.py.
"""

from app.models.schemas import PromptField
from app.services.llm_client import LLMConnection, json_completion
from app.services.spend_ledger import LLMUsage

_SYSTEM_PROMPT = (
    "You are an expert at analyzing user descriptions and converting them into "
    "structured prompt fields for a prompt engineering tool. "
    "Extract meaningful, distinct aspects from the user's text and represent each as a named field. "
    "Common field names include: goal, setting, characters, style, tone, details, constraints, format. "
    "Use concise, lowercase field names (use underscores for multi-word names). "
    "Preserve the original intent and all relevant details from the user's text. "
    "Return at least one field."
)

_RESPONSE_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "prompt_fields",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "fields": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "content": {"type": "string"},
                        },
                        "required": ["name", "content"],
                        "additionalProperties": False,
                    },
                }
            },
            "required": ["fields"],
            "additionalProperties": False,
        },
    },
}


class PromptParserService:
    """Converts free-form text into structured prompt fields via the user's LLM provider."""

    @staticmethod
    def parse(text: str, connection: LLMConnection) -> tuple[list[PromptField], LLMUsage]:
        """
        Convert natural language text into a list of structured prompt fields.

        Args:
            text: User's free-form description of their desired prompt
            connection: The acting user's resolved provider connection

        Returns:
            (fields, usage) — the extracted PromptField objects and the call's
            billed token usage, for the caller to record in the spend ledger

        Raises:
            openai.OpenAIError: If the API call fails
            LLMResponseFormatError: If the provider returned no usable JSON
            ValueError: If the JSON is well-formed but missing expected keys
        """
        raw, usage = json_completion(
            connection,
            system_prompt=_SYSTEM_PROMPT,
            user_content=text,
            schema=_RESPONSE_SCHEMA,
        )
        # Providers without enforced schemas can return a conforming-looking
        # object with a missing or mistyped `fields` — validate at this
        # boundary rather than letting a KeyError surface as a 500.
        entries = raw.get("fields")
        if not isinstance(entries, list) or not entries:
            msg = "Provider response did not contain any prompt fields"
            raise ValueError(msg)
        fields = [
            PromptField(name=str(entry["name"]), content=str(entry["content"]))
            for entry in entries
            if isinstance(entry, dict) and "name" in entry and "content" in entry
        ]
        if not fields:
            msg = "Provider response did not contain any usable prompt fields"
            raise ValueError(msg)
        return fields, usage
