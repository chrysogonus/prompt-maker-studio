"""
Compile a prompt template by substituting `{{variable}}` placeholders with
user-supplied values. Mirrors the mustache-style matching in
frontend/src/lib/placeholders.ts (the `[Insert ...]` bracket style there is
frontend-only, used for freshly AI-imported text — not needed here).
"""

import re

_MUSTACHE_PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}")


def compile_prompt(template: str, variables: dict[str, str]) -> str:
    """Replace each `{{name}}` token with its value; unmatched tokens are left as-is."""

    def _substitute(match: re.Match) -> str:
        value = variables.get(match.group(1), "").strip()
        return value if value else match.group(0)

    return _MUSTACHE_PLACEHOLDER.sub(_substitute, template)


def extract_placeholder_names(template: str) -> list[str]:
    """Return each distinct `{{name}}` placeholder in `template`, in first-seen order."""
    seen: dict[str, None] = {}
    for match in _MUSTACHE_PLACEHOLDER.finditer(template):
        seen.setdefault(match.group(1), None)
    return list(seen)
