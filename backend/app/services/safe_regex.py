"""Time-bounded regex matching for user-supplied patterns.

Eval rule criteria accept a `~regex` term that is applied to model output.
Python's `re` backtracks, so a pattern a user can save — `(a+)+$` is the
classic — grows exponentially with input length: 24 characters already takes
~0.9s, and a slightly longer string monopolises the worker for minutes. Several
concurrent eval runs then exhaust the service without going anywhere near a rate
limit.

`re` has no timeout, so the match runs in a separate process that can be killed.
This keeps `re`'s exact semantics — a linear-time engine such as RE2 would be
cheaper per call, but it does not support backreferences or lookaround, so
patterns users have already saved would start failing.

The worker process is reused across calls; only a timeout costs a respawn.
"""

from __future__ import annotations

import atexit
import concurrent.futures
from concurrent.futures import BrokenExecutor, ProcessPoolExecutor
import logging
import re
import threading

logger = logging.getLogger(__name__)

# Generous for any honest pattern — a legitimate check against a model response
# resolves in low single-digit milliseconds — and short enough that a hostile one
# cannot hold a worker.
MATCH_TIMEOUT_SECONDS = 0.25

# Matching is capped on input as well as time. Backtracking blows up with length,
# so a bound here raises the cost of finding a pattern that fits inside the
# timeout while still covering any plausible model response.
MAX_MATCH_INPUT_CHARS = 100_000

_executor: ProcessPoolExecutor | None = None
_executor_lock = threading.Lock()


class UnsafePatternError(Exception):
    """A pattern did not resolve within the time budget."""


def _search(pattern: str, text: str) -> bool:
    """Runs in the worker process; must stay importable and side-effect free."""
    return re.search(pattern, text) is not None


def _get_executor() -> ProcessPoolExecutor:
    global _executor  # noqa: PLW0603 - module-level singleton pool, guarded by _executor_lock
    with _executor_lock:
        if _executor is None:
            # One worker: matching is not parallelised here, and a single process
            # keeps the blast radius of a kill to one in-flight match.
            _executor = ProcessPoolExecutor(max_workers=1)
        return _executor


def _discard_executor() -> None:
    """Drop the pool after a timeout, killing the worker that is still running.

    The worker processes have to be terminated explicitly. `shutdown()` only
    stops *waiting* for a running task — it does not interrupt one — so a
    runaway match would keep a core pegged indefinitely after the caller gave
    up. Measured: abandoning without this left two workers burning 90% CPU each
    ten minutes later, which is the machine-level half of the denial of service
    this module exists to prevent.

    `_processes` is a private attribute, hence the defensive getattr: if a
    future Python removes it, this degrades to the old abandon-only behaviour
    rather than raising, and the accompanying test fails loudly.
    """
    global _executor
    with _executor_lock:
        executor, _executor = _executor, None
    if executor is None:
        return

    for process in list(getattr(executor, "_processes", {}).values()):
        if process.is_alive():
            process.kill()
    executor.shutdown(wait=False, cancel_futures=True)


def reset_executor() -> None:
    """Tear down the worker pool. For tests and interpreter shutdown."""
    _discard_executor()


# Without this, a pool worker keeps a non-daemon process alive and the
# interpreter will not exit — which showed up as a hung test run, not as an
# error.
atexit.register(reset_executor)


def safe_search(pattern: str, text: str) -> bool:
    """`re.search(pattern, text) is not None`, under a hard time limit.

    Raises:
        UnsafePatternError: if the match did not finish within the budget, or
            the worker died trying. The caller decides what a rule that cannot
            be evaluated means; this deliberately does not guess by returning
            False, which would read as a legitimate failed check.
        re.error: if the pattern is invalid, as `re.search` would raise.
    """
    # Compile in-process first: an invalid pattern is a plain validation error
    # and should not cost a round trip to the worker.
    re.compile(pattern)

    if len(text) > MAX_MATCH_INPUT_CHARS:
        text = text[:MAX_MATCH_INPUT_CHARS]

    try:
        future = _get_executor().submit(_search, pattern, text)
        return future.result(timeout=MATCH_TIMEOUT_SECONDS)
    except concurrent.futures.TimeoutError as exc:
        _discard_executor()
        logger.warning(
            "Abandoned a regex match that exceeded %ss (pattern length %d)",
            MATCH_TIMEOUT_SECONDS,
            len(pattern),
        )
        msg = (
            f"This pattern took longer than {MATCH_TIMEOUT_SECONDS}s to evaluate and was "
            "stopped. Simplify it — nested quantifiers such as (a+)+ are the usual cause."
        )
        raise UnsafePatternError(msg) from exc
    except BrokenExecutor as exc:
        _discard_executor()
        msg = "The pattern could not be evaluated. Simplify it and try again."
        raise UnsafePatternError(msg) from exc
