"""
Tests for marking a known-good version and the library's evaluation status.
"""

from unittest.mock import patch

from app.models.eval_run import EvalRun
from app.models.prompt_version import PromptVersion
from app.services.playground_service import PlaygroundResult


def _create(client, headers, content="Say {{thing}}") -> int:
    response = client.post(
        "/api/prompts",
        headers=headers,
        json={"fields": [{"name": "goal", "content": content}], "name": "Known good"},
    )
    return response.json()["id"]


def _patch(client, headers, prompt_id, body):
    return client.patch(f"/api/prompts/{prompt_id}", headers=headers, json=body)


def _run(client, headers, prompt_id, score_text="hello"):
    client.post(
        f"/api/prompts/{prompt_id}/eval/cases",
        headers=headers,
        json={"method": "rule", "criteria": "hello", "variables": {"thing": "x"}},
    )
    result = PlaygroundResult(
        output_text=score_text,
        latency_ms=1,
        prompt_tokens=1,
        completion_tokens=1,
        cost_usd=0.0,
        provider="openai",
        model="m",
    )
    with patch("app.services.eval_service.PlaygroundService.run", return_value=result):
        return client.post(f"/api/prompts/{prompt_id}/eval/runs", headers=headers).json()


def _listed(client, headers, prompt_id):
    saved = client.get("/api/prompts/saved", headers=headers).json()
    return next(item for item in saved if item["id"] == prompt_id)


class TestKnownGoodVersion:
    def test_marking_a_version_keeps_content_and_history_unchanged(
        self, client, auth_headers, db_session
    ):
        prompt_id = _create(client, auth_headers)
        _patch(client, auth_headers, prompt_id, {"fields": [{"name": "goal", "content": "v2"}]})
        before = client.get(f"/api/prompts/{prompt_id}", headers=auth_headers).json()

        response = _patch(client, auth_headers, prompt_id, {"known_good_version": 1})

        assert response.status_code == 200
        data = response.json()
        assert data["known_good_version"] == 1
        assert data["content_updated_at"] == before["content_updated_at"]
        assert db_session.query(PromptVersion).filter_by(prompt_id=prompt_id).count() == 1

    def test_zero_clears_the_mark(self, client, auth_headers):
        prompt_id = _create(client, auth_headers)
        _patch(client, auth_headers, prompt_id, {"known_good_version": 1})
        response = _patch(client, auth_headers, prompt_id, {"known_good_version": 0})
        assert response.json()["known_good_version"] is None

    def test_a_version_that_does_not_exist_is_rejected_without_changes(self, client, auth_headers):
        prompt_id = _create(client, auth_headers)
        response = _patch(
            client,
            auth_headers,
            prompt_id,
            {"known_good_version": 2, "name": "Renamed"},
        )
        assert response.status_code == 422
        prompt = client.get(f"/api/prompts/{prompt_id}", headers=auth_headers).json()
        assert (prompt["name"], prompt["known_good_version"]) == ("Known good", None)

    def test_the_version_saved_by_the_same_request_can_be_marked(self, client, auth_headers):
        prompt_id = _create(client, auth_headers)
        response = _patch(
            client,
            auth_headers,
            prompt_id,
            {"fields": [{"name": "goal", "content": "v2"}], "known_good_version": 2},
        )
        assert response.json()["known_good_version"] == 2

    def test_negative_versions_are_invalid(self, client, auth_headers):
        prompt_id = _create(client, auth_headers)
        assert (
            _patch(client, auth_headers, prompt_id, {"known_good_version": -1}).status_code == 422
        )

    def test_export_includes_the_mark(self, client, auth_headers):
        prompt_id = _create(client, auth_headers)
        _patch(client, auth_headers, prompt_id, {"known_good_version": 1})
        exported = client.get("/api/prompts/export", headers=auth_headers).json()
        [item] = [p for p in exported["prompts"] if p["id"] == prompt_id]
        assert item["known_good_version"] == 1


class TestLibraryEvalStatus:
    def test_untested_prompts_have_no_score(self, client, auth_headers):
        prompt_id = _create(client, auth_headers)
        listed = _listed(client, auth_headers, prompt_id)
        assert (listed["eval_status"], listed["eval_score"]) == ("untested", None)

    def test_a_run_of_the_current_text_is_current_until_the_text_changes(
        self, client, auth_headers
    ):
        prompt_id = _create(client, auth_headers)
        _run(client, auth_headers, prompt_id)
        listed = _listed(client, auth_headers, prompt_id)
        assert (listed["eval_status"], listed["eval_score"]) == ("current", 100.0)

        _patch(client, auth_headers, prompt_id, {"fields": [{"name": "goal", "content": "v2"}]})
        listed = _listed(client, auth_headers, prompt_id)
        assert (listed["eval_status"], listed["eval_score"]) == ("stale", None)

        # Restoring the tested text makes the earlier run current again.
        _patch(
            client,
            auth_headers,
            prompt_id,
            {"fields": [{"name": "goal", "content": "Say {{thing}}"}]},
        )
        assert _listed(client, auth_headers, prompt_id)["eval_status"] == "current"

    def test_the_newest_run_of_the_current_text_gives_the_score(self, client, auth_headers):
        prompt_id = _create(client, auth_headers)
        _run(client, auth_headers, prompt_id, score_text="nope")
        _run(client, auth_headers, prompt_id, score_text="hello")
        assert _listed(client, auth_headers, prompt_id)["eval_score"] == 100.0

    def test_runs_without_tested_text_use_their_version_number(
        self, client, auth_headers, db_session
    ):
        prompt_id = _create(client, auth_headers)
        db_session.add(EvalRun(prompt_id=prompt_id, prompt_version_number=1, score=40.0))
        db_session.commit()
        listed = _listed(client, auth_headers, prompt_id)
        assert (listed["eval_status"], listed["eval_score"]) == ("current", 40.0)

    def test_another_accounts_runs_are_not_counted(self, client, auth_headers, second_auth_headers):
        mine = _create(client, auth_headers)
        theirs = _create(client, second_auth_headers)
        _run(client, second_auth_headers, theirs)
        assert _listed(client, auth_headers, mine)["eval_status"] == "untested"
