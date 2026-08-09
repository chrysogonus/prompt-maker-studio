"""Optimistic concurrency control for prompt writes.

Two sessions editing one prompt must not silently overwrite each other. The
client echoes back the `updated_at` it last saw, and a write is rejected with
409 when the stored value has moved on since.

That comparison is only sound if two things hold, and neither did.

**`updated_at` must never go backwards.** `datetime.now()` reads the wall clock,
which is not monotonic — it steps whenever NTP corrects it, a VM migrates, or a
host resumes from suspend. Captured in this project's own E2E run: a write
stamped 403ms *earlier* than the value it replaced. The stored timestamp then
compared as older than the stale token a second session was holding, so a
genuine conflict was accepted as 200 and one session's edit was lost.
`next_write_stamp` fixes the direction by never returning a value below the one
it replaces.

**Any difference must count as a conflict.** The check this replaces allowed a
100ms tolerance, so two sessions saving within 100ms of each other never
conflicted at all — a lost update on every fast collision, clock behaviour
aside. (The tolerance was load-bearing for the test that covered it, which slept
0.15s to get past it.) Stamps are therefore truncated to a fixed resolution and
pushed to the next tick when they collide, which makes consecutive versions of a
row differ by a known minimum and lets the comparison be exact.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

# Stamp resolution. A write landing inside an instant that is already taken is
# pushed to the next one, so two consecutive versions of a row always differ by
# at least this much.
_RESOLUTION = timedelta(milliseconds=1)

# Half a tick. Wide enough to absorb a stamp that lost sub-millisecond digits in
# transit, far narrower than the gap between two versions — so it can never hide
# a real conflict the way a 100ms window did.
_COMPARISON_EPSILON_SECONDS = _RESOLUTION.total_seconds() / 2


def as_utc(value: datetime) -> datetime:
    """Read a stored timestamp as UTC.

    SQLite's DATETIME columns hand back naive datetimes; everything written to
    them is UTC, so an absent tzinfo means UTC rather than local time.
    """
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def next_write_stamp(previous: datetime | None) -> datetime:
    """The `updated_at` to stamp on a write, guaranteed to advance.

    Args:
        previous: The row's current `updated_at` (or `created_at` when it has
            never been updated). The result is always strictly greater.

    Returns:
        A UTC timestamp at `_RESOLUTION`, at least one tick past `previous`.
        Under a backwards clock step this stays one tick ahead of the stored
        value rather than following the clock down, so ordering survives.
    """
    now = datetime.now(UTC)
    stamp = now.replace(microsecond=(now.microsecond // 1000) * 1000)
    if previous is None:
        return stamp
    floor = as_utc(previous) + _RESOLUTION
    return max(stamp, floor)


def is_stale(stored: datetime, client_supplied: datetime) -> bool:
    """Whether a write built on `client_supplied` has already been overtaken.

    Any difference is a conflict. A `client_supplied` value *ahead* of the
    stored one counts too: it cannot have come from this row, so the safe
    reading is that the two sides disagree.
    """
    difference = abs(as_utc(stored).timestamp() - as_utc(client_supplied).timestamp())
    return difference > _COMPARISON_EPSILON_SECONDS
