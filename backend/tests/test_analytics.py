"""Tests for AnalyticsService and GET /api/analytics/dashboard."""

from datetime import UTC, datetime, timedelta

from app.models.billed_call import BilledCall
from app.models.playground_run import PlaygroundRun
from app.services.analytics_service import AnalyticsService


def _get_user_id(client, auth_headers) -> int:
    return client.get("/api/auth/me", headers=auth_headers).json()["id"]


def _create_prompt(client, headers, name="P") -> int:
    resp = client.post(
        "/api/prompts/generate",
        headers=headers,
        json={"fields": [{"name": "goal", "content": "x"}], "name": name},
    )
    return resp.json()["id"]


def _add_run(
    db_session,
    prompt_id,
    user_id,
    *,
    status="success",
    latency_ms=100,
    cost_usd=0.0,
    created_at=None,
):
    run = PlaygroundRun(
        prompt_id=prompt_id,
        user_id=user_id,
        model="gpt-4o-mini",
        status=status,
        latency_ms=latency_ms,
        cost_usd=cost_usd,
        created_at=created_at or datetime.now(UTC),
    )
    db_session.add(run)
    # Mirror the playground endpoint: a successful run also writes its cost to
    # the unified billed_calls ledger (failed runs bill nothing).
    if status == "success":
        db_session.add(
            BilledCall(
                user_id=user_id,
                source="playground",
                model="gpt-4o-mini",
                cost_usd=cost_usd,
                created_at=created_at or datetime.now(UTC),
            )
        )
    db_session.commit()
    return run


class TestDashboardEndpoint:
    def test_empty_state_reports_zero_and_null_not_fabricated_numbers(self, client, auth_headers):
        resp = client.get("/api/analytics/dashboard", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["runs_this_month"] == 0
        assert data["runs_change_pct"] is None
        assert data["avg_latency_ms"] is None
        assert data["success_rate_pct"] is None
        assert data["total_cost_usd"] == 0
        assert data["avg_cost_per_run_usd"] is None
        assert len(data["request_volume_7d"]) == 7
        assert all(day["count"] == 0 for day in data["request_volume_7d"])
        assert data["top_prompts"] == []

    def test_requires_auth(self, client):
        resp = client.get("/api/analytics/dashboard")
        assert resp.status_code in (401, 403)

    def test_success_rate_reflects_mixed_run_outcomes(self, client, auth_headers, db_session):
        user_id = _get_user_id(client, auth_headers)
        prompt_id = _create_prompt(client, auth_headers)
        _add_run(db_session, prompt_id, user_id, status="success", latency_ms=200)
        _add_run(db_session, prompt_id, user_id, status="success", latency_ms=400)
        _add_run(db_session, prompt_id, user_id, status="error", latency_ms=0)

        data = client.get("/api/analytics/dashboard", headers=auth_headers).json()

        assert data["runs_this_month"] == 3
        # 2 of 3 succeeded
        assert data["success_rate_pct"] == 66.7
        # Average latency is computed over successful runs only (200+400)/2
        assert data["avg_latency_ms"] == 300

    def test_runs_change_pct_compares_this_month_to_last_month(
        self, client, auth_headers, db_session
    ):
        user_id = _get_user_id(client, auth_headers)
        prompt_id = _create_prompt(client, auth_headers)
        now = datetime.now(UTC)
        last_month = (now.replace(day=1) - timedelta(days=1)).replace(day=15)

        _add_run(db_session, prompt_id, user_id, created_at=last_month)
        _add_run(db_session, prompt_id, user_id, created_at=last_month)
        _add_run(db_session, prompt_id, user_id, created_at=now)
        _add_run(db_session, prompt_id, user_id, created_at=now)
        _add_run(db_session, prompt_id, user_id, created_at=now)
        _add_run(db_session, prompt_id, user_id, created_at=now)

        data = client.get("/api/analytics/dashboard", headers=auth_headers).json()

        assert data["runs_this_month"] == 4
        # (4 - 2) / 2 * 100 = 100%
        assert data["runs_change_pct"] == 100.0

    def test_cost_metrics_include_all_owned_runs(self, client, auth_headers, db_session):
        user_id = _get_user_id(client, auth_headers)
        prompt_id = _create_prompt(client, auth_headers)
        _add_run(db_session, prompt_id, user_id, cost_usd=0.001)
        _add_run(db_session, prompt_id, user_id, status="error", cost_usd=0.0)
        _add_run(db_session, prompt_id, user_id, cost_usd=0.002)

        data = client.get("/api/analytics/dashboard", headers=auth_headers).json()

        assert data["total_cost_usd"] == 0.003
        assert data["avg_cost_per_run_usd"] == 0.001

    def test_total_cost_includes_non_playground_ai_spend(self, client, auth_headers, db_session):
        """The Dashboard total reads the unified ledger, so eval/refine spend
        counts even though it never creates a PlaygroundRun row."""
        user_id = _get_user_id(client, auth_headers)
        prompt_id = _create_prompt(client, auth_headers)
        _add_run(db_session, prompt_id, user_id, cost_usd=0.001)
        db_session.add(
            BilledCall(
                user_id=user_id,
                source="eval_judge",
                model="gpt-4.1-mini-2025-04-14",
                cost_usd=0.004,
            )
        )
        db_session.commit()

        data = client.get("/api/analytics/dashboard", headers=auth_headers).json()

        assert data["total_cost_usd"] == 0.005
        assert data["avg_cost_per_run_usd"] == 0.001

    def test_top_prompts_ranked_by_run_count_and_scoped_to_owner(
        self, client, auth_headers, second_auth_headers, db_session
    ):
        user_id = _get_user_id(client, auth_headers)
        other_user_id = _get_user_id(client, second_auth_headers)
        popular = _create_prompt(client, auth_headers, name="Popular")
        quiet = _create_prompt(client, auth_headers, name="Quiet")
        others_prompt = _create_prompt(client, second_auth_headers, name="Not Mine")

        for _ in range(3):
            _add_run(db_session, popular, user_id)
        _add_run(db_session, quiet, user_id)
        for _ in range(5):
            _add_run(db_session, others_prompt, other_user_id)

        data = client.get("/api/analytics/dashboard", headers=auth_headers).json()

        assert data["top_prompts"][0] == {"prompt_id": popular, "name": "Popular", "run_count": 3}
        assert len(data["top_prompts"]) == 2
        assert all(p["name"] != "Not Mine" for p in data["top_prompts"])

    def test_request_volume_series_counts_generations_and_runs_together(
        self, client, auth_headers, db_session
    ):
        user_id = _get_user_id(client, auth_headers)
        prompt_id = _create_prompt(client, auth_headers)  # one generation "today"
        _add_run(db_session, prompt_id, user_id)  # one run "today"

        data = client.get("/api/analytics/dashboard", headers=auth_headers).json()

        today = datetime.now(UTC).date().isoformat()
        today_entry = next(d for d in data["request_volume_7d"] if d["date"] == today)
        assert today_entry["count"] == 2


class TestAnalyticsService:
    def test_dashboard_summary_is_isolated_per_user(self, db_session, client, auth_headers):
        user_id = _get_user_id(client, auth_headers)
        prompt_id = _create_prompt(client, auth_headers)
        _add_run(db_session, prompt_id, user_id)

        summary = AnalyticsService.dashboard_summary(db_session, user_id + 999)
        assert summary["runs_this_month"] == 0


class TestRunCountsByPromptIds:
    def test_empty_prompt_ids_returns_empty_dict(self, db_session):
        assert AnalyticsService.run_counts_by_prompt_ids(db_session, 1, []) == {}

    def test_counts_runs_per_prompt(self, client, auth_headers, db_session):
        user_id = _get_user_id(client, auth_headers)
        popular = _create_prompt(client, auth_headers, name="Popular")
        quiet = _create_prompt(client, auth_headers, name="Quiet")
        unrun = _create_prompt(client, auth_headers, name="Unrun")

        for _ in range(3):
            _add_run(db_session, popular, user_id)
        _add_run(db_session, quiet, user_id)

        counts = AnalyticsService.run_counts_by_prompt_ids(
            db_session, user_id, [popular, quiet, unrun]
        )
        assert counts == {popular: 3, quiet: 1}
        assert counts.get(unrun, 0) == 0

    def test_isolated_per_user(self, client, auth_headers, second_auth_headers, db_session):
        user_id = _get_user_id(client, auth_headers)
        other_user_id = _get_user_id(client, second_auth_headers)
        prompt_id = _create_prompt(client, auth_headers)
        others_prompt = _create_prompt(client, second_auth_headers, name="Not Mine")

        _add_run(db_session, prompt_id, user_id)
        _add_run(db_session, others_prompt, other_user_id)

        counts = AnalyticsService.run_counts_by_prompt_ids(
            db_session, user_id, [prompt_id, others_prompt]
        )
        assert counts == {prompt_id: 1}


class TestWeeklyDigest:
    def test_empty_state_reports_zero_and_null(self, db_session):
        digest = AnalyticsService.weekly_digest(db_session, user_id=1)
        assert digest["total_runs_7d"] == 0
        assert digest["success_rate_pct_7d"] is None
        assert digest["top_prompts_7d"] == []

    def test_only_counts_runs_within_the_last_7_days(self, client, auth_headers, db_session):
        user_id = _get_user_id(client, auth_headers)
        prompt_id = _create_prompt(client, auth_headers)
        now = datetime.now(UTC)

        _add_run(db_session, prompt_id, user_id, created_at=now)
        _add_run(db_session, prompt_id, user_id, created_at=now, status="error")
        _add_run(db_session, prompt_id, user_id, created_at=now - timedelta(days=10))

        digest = AnalyticsService.weekly_digest(db_session, user_id)

        assert digest["total_runs_7d"] == 2
        assert digest["success_rate_pct_7d"] == 50.0
        assert digest["top_prompts_7d"] == [{"prompt_id": prompt_id, "name": "P", "run_count": 2}]
