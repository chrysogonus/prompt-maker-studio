"""
Keeps `backend/tests/README.md`'s module table in sync with the test files that
actually exist.

This used to be an instruction in `backend/AGENTS.md` asking whoever added a
test module to update the table by hand. It drifted anyway — the README's prose
claimed 29 modules while 32 existed. An assertion catches it on the same run
that introduces it, which prose cannot.
"""

from pathlib import Path
import re

_TESTS_DIR = Path(__file__).parent
_README_PATH = _TESTS_DIR / "README.md"

# Table rows look like: | `test_foo.py` | Coverage area ... |
_ROW_PATTERN = re.compile(r"^\|\s*`(test_\w+\.py)`\s*\|", re.M)


def _documented_modules() -> set[str]:
    return set(_ROW_PATTERN.findall(_README_PATH.read_text()))


def _actual_modules() -> set[str]:
    return {path.name for path in _TESTS_DIR.glob("test_*.py")}


def test_readme_table_lists_every_test_module():
    documented = _documented_modules()
    actual = _actual_modules()

    undocumented = sorted(actual - documented)
    assert not undocumented, (
        f"{len(undocumented)} test module(s) missing from backend/tests/README.md's table: "
        f"{', '.join(undocumented)}. Add a row describing each one's coverage area."
    )


def test_readme_table_has_no_rows_for_deleted_modules():
    documented = _documented_modules()
    actual = _actual_modules()

    stale = sorted(documented - actual)
    assert not stale, (
        f"backend/tests/README.md's table documents {len(stale)} module(s) that no longer "
        f"exist: {', '.join(stale)}. Remove the stale row(s)."
    )
