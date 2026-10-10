"""Tests for rendering a prompt's sections and recovering sections from text."""

import pytest

from app.services.prompt_sections import (
    parse_rendered_sections,
    render_sections,
    section_tag,
    sections_for_text,
)


@pytest.mark.parametrize(
    ("name", "tag"),
    [("role", "ROLE"), ("Output format", "OUTPUT_FORMAT"), ("my-style", "MY-STYLE")],
)
def test_section_tag_upper_cases_and_joins_words(name, tag):
    assert section_tag(name) == tag


def test_render_sections_keeps_content_verbatim():
    sections = [
        {"name": "Role", "content": "Use <b>bold</b> & {{tone}}"},
        {"name": "Output format", "content": ""},
    ]

    assert render_sections(sections) == (
        "<ROLE>\nUse <b>bold</b> & {{tone}}\n</ROLE>\n\n<OUTPUT_FORMAT>\n\n</OUTPUT_FORMAT>"
    )


def test_parse_reuses_previous_spelling_and_lowercases_new_tags():
    text = "<OUTPUT_FORMAT>\nbullets\n</OUTPUT_FORMAT>\n\n<TASK>\nsummarise\n</TASK>"

    sections = parse_rendered_sections(text, [{"name": "Output format", "content": "old"}])

    assert sections == [
        {"name": "Output format", "content": "bullets"},
        {"name": "task", "content": "summarise"},
    ]


@pytest.mark.parametrize(
    "text",
    [
        "",
        "plain text",
        "<ROLE>\na\n</ROLE>\nb\n</ROLE>",
        "<ROLE>\na\n</ROLE>\n\n\n<TASK>\nb\n</TASK>",
    ],
)
def test_parse_refuses_text_that_would_not_round_trip(text):
    assert parse_rendered_sections(text, []) is None


def test_sections_for_text_prefers_matching_previous_sections():
    previous = [{"name": "Role", "content": "a"}]

    assert sections_for_text("<ROLE>\na\n</ROLE>", previous) == previous


def test_sections_for_text_keeps_unsplittable_text_whole():
    assert sections_for_text("Fix typos:\n<TEXT>", [{"name": "Role", "content": "a"}]) == [
        {"name": "prompt", "content": "Fix typos:\n<TEXT>"}
    ]
