"""
Service backing the Evaluate tab's AI-assisted eval set generator: proposes a
reviewable batch of eval cases (happy-path, edge-case, adversarial) from the
current template, its declared variables, and an optional user testing goal.
Follows the same structured-output pattern as PromptRefinerService, through the
shared helper in services/llm_client.py. Proposals are never persisted here —
the caller decides what to save via the existing eval-case creation path.
"""

from dataclasses import dataclass
import re

from app.services.llm_client import LLMConnection, json_completion
from app.services.prompt_compiler import extract_placeholder_names
from app.services.spend_ledger import LLMUsage

# Comfortably inside the 100-char cap `EvalCase.name` enforces, so a generated
# name is never truncated on its way into the case list.
_MAX_NAME_LENGTH = 60

_STRUCTURAL_RULE_TERMS = {
    "call to action",
    "call-to-action",
    "conclusion",
    "cta",
    "format",
    "introduction",
    "length",
    "paragraph",
    "professionalism",
    "summary",
    "tagline",
    "tone",
    "word count",
}

_SYSTEM_PROMPT = (
    "You are a prompt-evaluation expert. Read the prompt template and its "
    "declared variables, then propose a diverse set of test cases to "
    "validate the prompt: include a normal happy-path case, at least one "
    "edge case (unusual or boundary input), and at least one adversarial "
    "case (input designed to make the prompt fail, be misused, or produce "
    "an unsafe or undesired response). For each case: choose the scoring "
    "method that best fits — 'rule' when a short list of required "
    "substrings that must literally appear in a correct output can objectively verify it, "
    "'judge' when grading "
    "needs a nuanced rubric, or 'manual' when only a human can reasonably "
    "judge it; write criteria appropriate to that method (comma-separated "
    "required substrings for 'rule', a grading instruction for 'judge', or "
    "an empty string for 'manual'); supply a value for every declared "
    "variable so the case can run standalone; give a short descriptive name "
    "for the case — a label, not a sentence, at most {max_name_length} "
    "characters, e.g. 'Happy path: standard triage note' or 'Adversarial: "
    "prompt injection in subject' — and give a one-sentence "
    "rationale for why the case is useful. Never create a Rule check for the name of a "
    "structural or qualitative instruction (for example 'tagline', 'summary', 'tone', "
    "'call-to-action', 'paragraph', or 'word count'); those concepts require Judge grading "
    "unless the prompt explicitly requires that exact word to appear. Propose at most "
    "{max_cases} cases."
)


@dataclass
class EvalCaseProposal:
    """A single AI-proposed eval case, pending user review."""

    method: str
    criteria: str
    variables: dict[str, str]
    rationale: str
    name: str


def _shorten_to_words(text: str, limit: int) -> str:
    """Trim `text` to at most `limit` characters without cutting a word in half."""
    collapsed = " ".join(text.split())
    if len(collapsed) <= limit:
        return collapsed
    clipped = collapsed[:limit].rsplit(" ", 1)[0].rstrip(" ,;:-")
    # A single word longer than the limit has no boundary to fall back to.
    return clipped or collapsed[:limit]


def _case_name(case: dict) -> str:
    """
    The case's display label. The model is asked for a short name; fall back to
    the rationale's first clause so an older or malformed response still yields
    a readable label rather than a mid-word slice of a full sentence.
    """
    name = (case.get("name") or "").strip()
    if not name:
        name = re.split(r"(?<=[.!?])\s", case.get("rationale", ""), maxsplit=1)[0]
    return _shorten_to_words(name.rstrip("."), _MAX_NAME_LENGTH)


def _structural_rule_terms(criteria: str) -> list[str]:
    """Return generated Rule tokens that describe output properties, not literal content."""
    checks = re.split(r",\s*", criteria)
    matches: list[str] = []
    for check in checks:
        normalized = check.strip().lstrip("!~").strip().casefold()
        if normalized in _STRUCTURAL_RULE_TERMS:
            matches.append(check.strip())
    return matches


def _normalize_proposal(case: dict) -> EvalCaseProposal:
    """Downgrade unsafe literal Rule checks to a semantic Judge rubric."""
    method = case["method"]
    criteria = case["criteria"]
    if method == "rule" and _structural_rule_terms(criteria):
        method = "judge"
        requirements = "; ".join(part.strip() for part in criteria.split(",") if part.strip())
        criteria = (
            "Evaluate whether the output satisfies these requested content and structural "
            f"requirements: {requirements}. Treat structural labels as concepts, not words "
            "that must literally appear."
        )
    return EvalCaseProposal(
        method=method,
        criteria=criteria,
        variables=case.get("variables", {}),
        rationale=case["rationale"],
        name=_case_name(case),
    )


def _build_response_schema(variable_names: list[str]) -> dict:
    """
    Build the structured-output schema dynamically so the model is required
    to return a value for every variable the template actually declares
    (rather than an open-ended dict, which strict JSON schema modes don't
    support well for arbitrary keys).
    """
    item_properties = {
        "method": {
            "type": "string",
            "enum": ["rule", "judge", "manual"],
        },
        "name": {
            "type": "string",
            "description": f"Short label for the case, at most {_MAX_NAME_LENGTH} characters",
        },
        "criteria": {"type": "string"},
        "rationale": {"type": "string"},
    }
    item_required = ["method", "name", "criteria", "rationale"]

    if variable_names:
        item_properties["variables"] = {
            "type": "object",
            "properties": {name: {"type": "string"} for name in variable_names},
            "required": variable_names,
            "additionalProperties": False,
        }
        item_required.append("variables")

    return {
        "type": "json_schema",
        "json_schema": {
            "name": "eval_case_proposals",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {
                    "cases": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": item_properties,
                            "required": item_required,
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["cases"],
                "additionalProperties": False,
            },
        },
    }


class EvalGeneratorService:
    """Generates proposed eval cases for a prompt template via the user's LLM provider."""

    @staticmethod
    def generate_proposals(
        template: str,
        variable_metadata: dict[str, dict] | None,
        goal: str | None,
        max_cases: int,
        connection: LLMConnection,
    ) -> tuple[list[EvalCaseProposal], LLMUsage]:
        """
        Propose up to `max_cases` eval cases covering happy-path, edge-case,
        and adversarial inputs for `template`, plus the call's billed token
        usage for the caller to record in the spend ledger.

        Raises:
            openai.OpenAIError: If the API call fails
            LLMResponseFormatError: If the provider returned no usable JSON
            ValueError: If the JSON is missing the expected keys
        """
        variable_names = extract_placeholder_names(template)

        variable_lines = "\n".join(
            f"- {name}"
            + (
                f" (type: {meta.get('type')}, description: {meta.get('description')})"
                if (meta := (variable_metadata or {}).get(name))
                else ""
            )
            for name in variable_names
        )

        user_content = f"Prompt template:\n{template}"
        if variable_lines:
            user_content += f"\n\nDeclared variables:\n{variable_lines}"
        if goal and goal.strip():
            user_content += f"\n\nTesting goal: {goal.strip()}"

        raw, usage = json_completion(
            connection,
            system_prompt=_SYSTEM_PROMPT.format(
                max_cases=max_cases, max_name_length=_MAX_NAME_LENGTH
            ),
            user_content=user_content,
            schema=_build_response_schema(variable_names),
        )
        # Without an enforced schema a provider can return the right shape with
        # a field missing; skip malformed entries rather than 500 on one.
        cases = raw.get("cases")
        if not isinstance(cases, list):
            msg = "Provider response did not contain a cases list"
            raise ValueError(msg)
        # An empty list is a legitimate (if unhelpful) answer and surfaces as
        # "no cases proposed"; a malformed entry is dropped rather than
        # failing the whole batch.
        proposals = [
            _normalize_proposal(case)
            for case in cases[:max_cases]
            if isinstance(case, dict) and {"method", "criteria", "rationale"} <= case.keys()
        ]
        return proposals, usage
