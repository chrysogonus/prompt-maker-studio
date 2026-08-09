"""Tests for backend/app/services/optimistic_concurrency.py.

The conflict check is what stops two browser sessions from silently overwriting
each other's edits, so the cases that matter are the ones where it used to fail
open: a fast second write, and a wall clock that steps backwards.
"""

from datetime import UTC, datetime, timedelta

from app.services.optimistic_concurrency import (
    as_utc,
    is_stale,
    next_write_stamp,
)


def _freeze_clock(monkeypatch, instant: datetime) -> None:
    """Pin the wall clock the service reads, so a test can step it at will."""

    class FrozenDatetime(datetime):
        @classmethod
        def now(cls, _tz=None):
            return instant

    monkeypatch.setattr("app.services.optimistic_concurrency.datetime", FrozenDatetime)


class TestNextWriteStamp:
    def test_advances_past_the_value_it_replaces(self):
        previous = datetime.now(UTC)
        assert next_write_stamp(previous) > previous

    def test_advances_when_the_clock_steps_backwards(self, monkeypatch):
        """The failure that started this: a write stamped earlier than the one
        before it, which made a stale token compare as current."""
        previous = datetime.now(UTC)
        _freeze_clock(monkeypatch, previous - timedelta(milliseconds=403))

        stamp = next_write_stamp(previous)
        assert stamp > previous, "a backwards clock must not drag updated_at down with it"

    def test_repeated_writes_in_one_instant_still_advance(self, monkeypatch):
        """Two writes inside the same millisecond must not share a stamp, or the
        second is indistinguishable from the first."""
        frozen = datetime.now(UTC)
        _freeze_clock(monkeypatch, frozen)

        stamps = []
        previous = frozen
        for _ in range(5):
            previous = next_write_stamp(previous)
            stamps.append(previous)

        assert stamps == sorted(stamps)
        assert len(set(stamps)) == len(stamps)

    def test_no_previous_value_is_allowed(self):
        assert next_write_stamp(None) <= datetime.now(UTC) + timedelta(seconds=1)

    def test_accepts_a_naive_previous_value(self):
        """SQLite hands back naive datetimes; they are UTC."""
        previous = datetime.now(UTC).replace(tzinfo=None)
        assert next_write_stamp(previous) > as_utc(previous)


class TestIsStale:
    def test_the_value_just_read_is_not_stale(self):
        stored = next_write_stamp(datetime.now(UTC))
        assert is_stale(stored, stored) is False

    def test_a_superseded_value_is_stale(self):
        client_held = next_write_stamp(datetime.now(UTC))
        stored = next_write_stamp(client_held)
        assert is_stale(stored, client_held) is True

    def test_one_tick_of_difference_is_enough(self):
        """The old check tolerated 100ms, so any collision inside that window was
        a silent lost update. One stamp resolution apart must now conflict."""
        client_held = datetime.now(UTC).replace(microsecond=0)
        stored = client_held + timedelta(milliseconds=1)
        assert is_stale(stored, client_held) is True

    def test_sub_millisecond_drift_is_not_a_conflict(self):
        """A stamp that lost trailing digits in transit is still the same stamp."""
        stored = datetime.now(UTC).replace(microsecond=123456)
        truncated = stored.replace(microsecond=123000)
        assert is_stale(stored, truncated) is False

    def test_a_client_value_ahead_of_storage_is_a_conflict(self):
        """It cannot have come from this row, so the two sides disagree."""
        stored = datetime.now(UTC)
        assert is_stale(stored, stored + timedelta(seconds=5)) is True

    def test_compares_naive_storage_as_utc(self):
        aware = datetime.now(UTC)
        assert is_stale(aware.replace(tzinfo=None), aware) is False
