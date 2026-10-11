"""Frozen section-recovery semantics for migration 023.

Keep independent of future changes to the current prompt renderer.
"""

from collections.abc import Iterable, Mapping
import re

# Fallback section for text that cannot be split back into sections exactly.
WHOLE_TEXT_SECTION = "prompt"

_RENDERED_SECTION = re.compile(r"<([A-Za-z_][A-Za-z0-9_-]*)>\n(.*?)\n</\1>", re.DOTALL)


def section_tag(name: str) -> str:
    """The XML tag a section renders as: `Output format` becomes `OUTPUT_FORMAT`."""
    return "_".join(name.split()).upper()


def render_sections(sections: Iterable[Mapping[str, str]]) -> str:
    """Render sections as `<TAG>` blocks separated by blank lines.

    Content is kept verbatim: the tags are a convention for the model reading
    the prompt, not markup anything here parses, so escaping it would silently
    change what the user wrote.
    """
    return "\n\n".join(
        f"<{section_tag(section['name'])}>\n{section['content']}\n</{section_tag(section['name'])}>"
        for section in sections
    )


def parse_rendered_sections(text: str, previous: list[Mapping[str, str]]) -> list[dict] | None:
    """Split text back into sections, or None unless that reproduces it exactly.

    Edited XML is arbitrary text, so a parse is only trusted when rendering the
    parsed sections gives back the original byte for byte. Section names reuse
    a previous section's spelling where its tag matches, so `Role` stays `Role`
    rather than becoming `ROLE`.
    """
    names_by_tag = {section_tag(section["name"]): section["name"] for section in previous}
    sections: list[dict] = []
    position = 0
    while position < len(text):
        if sections:
            if not text.startswith("\n\n", position):
                return None
            position += 2
        match = _RENDERED_SECTION.match(text, position)
        if match is None:
            return None
        tag = match.group(1)
        sections.append({"name": names_by_tag.get(tag, tag.lower()), "content": match.group(2)})
        position = match.end()
    if not sections or render_sections(sections) != text:
        return None
    return sections


def sections_for_text(text: str, previous: list[Mapping[str, str]]) -> list[dict]:
    """Sections that render to `text`, preferring `previous` when they already do."""
    if render_sections(previous) == text:
        return [{"name": section["name"], "content": section["content"]} for section in previous]
    return parse_rendered_sections(text, previous) or [
        {"name": WHOLE_TEXT_SECTION, "content": text}
    ]
