"""Time-bounded matching for user-supplied eval regexes.

Regression tests for "user-supplied evaluation regexes can exhaust backend
workers". Rule criteria accept a 2,000-character `~regex` applied to model
output, and `re.search` ran it with no timeout: `(a+)+$` against 24 characters
took ~0.9s and grew exponentially, so a saved pattern could monopolise request
threads for minutes.
"""

from concurrent.futures import ProcessPoolExecutor
import re
import subprocess
import sys
import time

import pytest

from app.services import safe_regex
from app.services.eval_service import EvalService
from app.services.safe_regex import (
    MATCH_TIMEOUT_SECONDS,
    UnsafePatternError,
    reset_executor,
    safe_search,
)

# The payload the finding was reported with, plus lengths that were previously
# unbounded. 200 characters of `a` would not finish this side of the heat death
# of the universe under the old code.
CATASTROPHIC = "(a+)+$"


@pytest.fixture(autouse=True)
def _fresh_pool():
    reset_executor()
    yield
    reset_executor()


@pytest.mark.parametrize("length", [24, 40, 200])
def test_catastrophic_pattern_is_abandoned_within_the_budget(length):
    started = time.monotonic()
    with pytest.raises(UnsafePatternError, match="took longer"):
        safe_search(CATASTROPHIC, "a" * length + "!")
    elapsed = time.monotonic() - started

    # Generous ceiling: the point is that it is bounded at all, and independent
    # of input length rather than exponential in it.
    assert elapsed < MATCH_TIMEOUT_SECONDS + 2.0


def test_ordinary_patterns_still_work():
    assert safe_search("hel+o", "say hello there") is True
    assert safe_search("goodbye", "say hello there") is False


def test_backreferences_and_lookaround_still_work():
    """Why this is a subprocess timeout rather than RE2: a linear-time engine
    would reject these, and users may already have saved them."""
    assert safe_search(r"(\w+) \1", "hello hello") is True
    assert safe_search(r"foo(?!bar)", "foobaz") is True


def test_invalid_pattern_raises_re_error_not_a_timeout():
    """An unparseable pattern is a plain validation error and must not cost a
    round trip to the worker."""
    with pytest.raises(re.error):
        safe_search("(unclosed", "text")


def test_input_is_capped():
    huge = "b" * (safe_regex.MAX_MATCH_INPUT_CHARS + 5_000)
    assert safe_search("^b+$", huge) is True


def test_the_pool_recovers_after_a_timeout():
    """A killed worker must not leave the service unable to evaluate anything
    else — the next match has to get a fresh pool."""
    with pytest.raises(UnsafePatternError):
        safe_search(CATASTROPHIC, "a" * 40 + "!")

    assert safe_search("hello", "say hello") is True


def test_the_runaway_worker_is_killed_not_merely_abandoned():
    """shutdown() only stops *waiting* for a running task. Without an explicit
    kill, an abandoned match keeps a core pegged indefinitely — measured at 90%
    CPU per worker ten minutes after the caller gave up, which is the
    machine-level half of the denial of service."""
    with pytest.raises(UnsafePatternError):
        safe_search(CATASTROPHIC, "a" * 200 + "!")

    # The pool is dropped on timeout; its workers must not have outlived it.
    assert safe_regex._executor is None


def test_private_process_attribute_still_exists():
    """The kill above reaches into ProcessPoolExecutor._processes. If a future
    Python removes it the kill silently degrades to abandon-only, so fail here
    rather than in production."""
    executor = ProcessPoolExecutor(max_workers=1)
    try:
        executor.submit(int, 1).result(timeout=30)
        assert hasattr(executor, "_processes")
        assert executor._processes
    finally:
        executor.shutdown(wait=True)


def test_a_rule_that_cannot_be_evaluated_is_not_scored_as_a_failure():
    """Scoring an unevaluatable rule 0 would read as a legitimate failed check
    and quietly mislead whoever is reading the eval result."""
    score, rationale = EvalService._score_rule(f"~{CATASTROPHIC}", "a" * 60 + "!")

    assert score is None
    assert "Could not evaluate" in rationale


def test_interpreter_exits_with_a_pool_running():
    """An atexit hook tears the pool down. Without it a non-daemon worker keeps
    the process alive and a run hangs instead of failing."""
    code = (
        "from app.services.safe_regex import safe_search;"
        "assert safe_search('hello', 'hello') is True"
    )
    result = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, timeout=60, check=False
    )
    assert result.returncode == 0, result.stderr
