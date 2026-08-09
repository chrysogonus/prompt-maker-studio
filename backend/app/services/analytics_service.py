"""
Service for computing Dashboard usage analytics from real data: prompt
generation events and Playground runs. No fabricated numbers — sections
with no data yet report null/zero rather than a placeholder figure.
"""

from collections import defaultdict
from datetime import UTC, datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.billed_call import BilledCall
from app.models.playground_run import PlaygroundRun
from app.models.prompt import Prompt

_TOP_PROMPTS_LIMIT = 5
_REQUEST_VOLUME_WINDOW_DAYS = 7


def _start_of_month(reference: datetime) -> datetime:
    return reference.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


class AnalyticsService:
    """Aggregates a user's Prompt/PlaygroundRun rows into Dashboard stats."""

    @staticmethod
    def dashboard_summary(db: Session, user_id: int) -> dict:
        now = datetime.now(UTC)
        runs_query = db.query(PlaygroundRun).filter(PlaygroundRun.user_id == user_id)

        start_of_this_month = _start_of_month(now)
        start_of_last_month = _start_of_month(start_of_this_month - timedelta(days=1))

        runs_this_month = runs_query.filter(PlaygroundRun.created_at >= start_of_this_month).count()
        runs_last_month = runs_query.filter(
            PlaygroundRun.created_at >= start_of_last_month,
            PlaygroundRun.created_at < start_of_this_month,
        ).count()

        runs_change_pct = None
        if runs_last_month > 0:
            runs_change_pct = round(100 * (runs_this_month - runs_last_month) / runs_last_month, 1)

        total_runs = runs_query.count()
        successful_runs = runs_query.filter(PlaygroundRun.status == "success").all()

        avg_latency_ms = None
        if successful_runs:
            avg_latency_ms = round(
                sum(r.latency_ms for r in successful_runs) / len(successful_runs)
            )

        success_rate_pct = None
        if total_runs > 0:
            success_rate_pct = round(100 * len(successful_runs) / total_runs, 1)

        # Total spend comes from the unified billed_calls ledger (all AI
        # features, not just Playground); avg cost stays per-Playground-run
        # by definition, so it keeps reading playground_runs.
        total_cost = (
            db.query(func.coalesce(func.sum(BilledCall.cost_usd), 0.0))
            .filter(BilledCall.user_id == user_id)
            .scalar()
        )
        avg_cost = runs_query.with_entities(func.avg(PlaygroundRun.cost_usd)).scalar()

        request_volume_7d = AnalyticsService._request_volume_series(db, user_id, now)
        top_prompts = AnalyticsService._top_prompts_by_usage(db, user_id)

        return {
            "runs_this_month": runs_this_month,
            "runs_change_pct": runs_change_pct,
            "avg_latency_ms": avg_latency_ms,
            "success_rate_pct": success_rate_pct,
            "total_cost_usd": round(float(total_cost), 6),
            "avg_cost_per_run_usd": round(float(avg_cost), 6) if avg_cost is not None else None,
            "request_volume_7d": request_volume_7d,
            "top_prompts": top_prompts,
        }

    @staticmethod
    def weekly_digest(db: Session, user_id: int) -> dict:
        """Last-7-days usage digest for the weekly-summary email.

        Mirrors `dashboard_summary`'s shape but scoped to a 7-day window
        instead of month-to-date, and without the 7-day series (redundant in
        an email covering exactly that window).
        """
        now = datetime.now(UTC)
        window_start = now - timedelta(days=7)
        runs_query = db.query(PlaygroundRun).filter(
            PlaygroundRun.user_id == user_id, PlaygroundRun.created_at >= window_start
        )

        total_runs = runs_query.count()
        successful_runs = runs_query.filter(PlaygroundRun.status == "success").count()

        success_rate_pct = None
        if total_runs > 0:
            success_rate_pct = round(100 * successful_runs / total_runs, 1)

        top_prompts = AnalyticsService._top_prompts_by_usage(db, user_id, since=window_start)

        return {
            "total_runs_7d": total_runs,
            "success_rate_pct_7d": success_rate_pct,
            "top_prompts_7d": top_prompts,
            "window_start": window_start,
            "window_end": now,
        }

    @staticmethod
    def run_counts_by_prompt_ids(
        db: Session, user_id: int, prompt_ids: list[int]
    ) -> dict[int, int]:
        """Playground run counts for the given prompt ids, scoped to `user_id`.

        Used to populate the real per-prompt "N runs" figure shown on Library
        cards and the Editor's Usage card (replacing the earlier placeholder).
        """
        if not prompt_ids:
            return {}

        rows = (
            db.query(PlaygroundRun.prompt_id, func.count(PlaygroundRun.id))
            .filter(PlaygroundRun.user_id == user_id, PlaygroundRun.prompt_id.in_(prompt_ids))
            .group_by(PlaygroundRun.prompt_id)
            .all()
        )
        return dict(rows)

    @staticmethod
    def _request_volume_series(db: Session, user_id: int, now: datetime) -> list[dict]:
        """Daily counts of prompt generations + Playground runs, oldest first."""
        window_start = (now - timedelta(days=_REQUEST_VOLUME_WINDOW_DAYS - 1)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )

        daily_counts: dict[str, int] = defaultdict(int)
        for (created_at,) in db.query(Prompt.created_at).filter(
            Prompt.user_id == user_id, Prompt.created_at >= window_start
        ):
            if created_at:
                daily_counts[created_at.date().isoformat()] += 1
        for (created_at,) in db.query(PlaygroundRun.created_at).filter(
            PlaygroundRun.user_id == user_id, PlaygroundRun.created_at >= window_start
        ):
            if created_at:
                daily_counts[created_at.date().isoformat()] += 1

        series = []
        for i in range(_REQUEST_VOLUME_WINDOW_DAYS):
            day = (window_start + timedelta(days=i)).date()
            series.append({"date": day.isoformat(), "count": daily_counts.get(day.isoformat(), 0)})
        return series

    @staticmethod
    def _top_prompts_by_usage(
        db: Session, user_id: int, since: datetime | None = None
    ) -> list[dict]:
        """The user's most Playground-run prompts, by run count.

        `since`, when given, scopes the ranking to runs at or after that
        timestamp (used by `weekly_digest` for a 7-day window); omitted, the
        ranking is all-time (used by `dashboard_summary`).
        """
        query = db.query(PlaygroundRun.prompt_id, func.count(PlaygroundRun.id).label("run_count"))
        query = query.filter(PlaygroundRun.user_id == user_id)
        if since is not None:
            query = query.filter(PlaygroundRun.created_at >= since)
        rows = (
            query.group_by(PlaygroundRun.prompt_id)
            .order_by(func.count(PlaygroundRun.id).desc())
            .limit(_TOP_PROMPTS_LIMIT)
            .all()
        )
        if not rows:
            return []

        prompt_ids = [row[0] for row in rows]
        prompts_by_id = {p.id: p for p in db.query(Prompt).filter(Prompt.id.in_(prompt_ids)).all()}

        return [
            {
                "prompt_id": prompt_id,
                "name": prompts_by_id[prompt_id].name or "Untitled",
                "run_count": run_count,
            }
            for prompt_id, run_count in rows
            if prompt_id in prompts_by_id
        ]
