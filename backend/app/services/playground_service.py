"""
Service for running a compiled prompt against the acting user's own LLM
provider and computing latency/token/cost metrics for the Playground feature.
"""

from dataclasses import dataclass
import time

from openai import OpenAIError

from app.services.llm_client import LLMConnection, text_completion
from app.services.llm_pricing import cost_usd_for


class PlaygroundRunError(Exception):
    """Raised when a Playground run fails; message is safe to show the user."""


@dataclass
class PlaygroundResult:
    output_text: str
    latency_ms: int
    prompt_tokens: int
    completion_tokens: int
    cost_usd: float
    provider: str
    model: str


class PlaygroundService:
    """Executes a compiled prompt against the user's configured chat model."""

    @staticmethod
    def run(compiled_prompt: str, connection: LLMConnection) -> PlaygroundResult:
        """
        Send `compiled_prompt` to the connection's model and return
        timing/usage/cost.

        Args:
            compiled_prompt: The prompt text with variables already substituted
            connection: The acting user's resolved provider connection

        Returns:
            The run's output text plus latency, token usage, and computed cost

        Raises:
            PlaygroundRunError: If the API call fails. The message is the
                upstream one; callers that surface it to a user should route
                it through llm_client.describe_llm_error instead.
        """
        start = time.monotonic()
        try:
            output_text, usage = text_completion(
                connection, [{"role": "user", "content": compiled_prompt}]
            )
        except OpenAIError as exc:
            raise PlaygroundRunError(str(exc)) from exc
        latency_ms = int((time.monotonic() - start) * 1000)

        cost_usd = cost_usd_for(
            usage.provider, usage.model, usage.prompt_tokens, usage.completion_tokens
        )

        return PlaygroundResult(
            output_text=output_text,
            latency_ms=latency_ms,
            prompt_tokens=usage.prompt_tokens,
            completion_tokens=usage.completion_tokens,
            cost_usd=round(cost_usd, 6),
            provider=usage.provider,
            model=usage.model,
        )
