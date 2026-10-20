"""
Tests for the Evaluate tab API: eval case CRUD, running an evaluation,
run history, and manual star ratings.
"""

from unittest.mock import patch

from openai import OpenAIError
import pytest

from app.services.eval_generator_service import EvalCaseProposal
from app.services.playground_service import PlaygroundResult
from app.services.spend_ledger import LLMUsage
from tests.conftest import TEST_LLM_MODEL, TEST_LLM_PROVIDER


def test_eval_history_paginates_with_stable_newest_first_order(client, auth_headers, db_session):
    from datetime import UTC, datetime

    from app.models.eval_run import EvalRun

    prompt_id = _create_saved_prompt(client, auth_headers)
    runs = [
        EvalRun(prompt_id=prompt_id, created_at=datetime(2026, 1, 1, tzinfo=UTC)) for _ in range(5)
    ]
    db_session.add_all(runs)
    db_session.commit()
    ids = [run.id for run in runs]
    response = client.get(
        f"/api/prompts/{prompt_id}/eval/runs?limit=2&offset=1", headers=auth_headers
    )
    assert response.status_code == 200
    assert [run["id"] for run in response.json()] == [ids[3], ids[2]]


@pytest.mark.parametrize("query", ["limit=0", "limit=101", "offset=-1"])
def test_eval_history_rejects_invalid_page_bounds(client, auth_headers, query):
    prompt_id = _create_saved_prompt(client, auth_headers)
    assert (
        client.get(f"/api/prompts/{prompt_id}/eval/runs?{query}", headers=auth_headers).status_code
        == 422
    )


def test_eval_history_loads_child_results_without_n_plus_one(db_session):
    from sqlalchemy import event

    from app.models.eval_run import EvalRun
    from app.models.eval_run_result import EvalRunResult
    from app.models.prompt import Prompt
    from app.models.user import User
    from app.schemas.evaluation import EvalRunResponse
    from app.services.evaluation.results import list_eval_runs

    user = User(username="history", hashed_password="unused")
    db_session.add(user)
    db_session.flush()
    prompt = Prompt(user_id=user.id, fields=[], generated_prompt="test")
    db_session.add(prompt)
    db_session.flush()
    for _ in range(5):
        # Unsaved drafts: describing them looks up saved texts, once per list.
        run = EvalRun(prompt_id=prompt.id, tested_prompt="draft")
        db_session.add(run)
        db_session.flush()
        db_session.add(EvalRunResult(eval_run_id=run.id, method="rule", label="case"))
    db_session.commit()
    prompt_id, user_id = prompt.id, user.id
    db_session.expunge_all()
    statements = []

    def capture(conn, cursor, statement, params, context, many):
        if statement.startswith("SELECT"):
            statements.append(statement)

    engine = db_session.get_bind()
    event.listen(engine, "before_cursor_execute", capture)
    try:
        rows = list_eval_runs(prompt_id, db_session, user_id)
        assert len([EvalRunResponse.model_validate(row) for row in rows]) == 5
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    # prompt, runs, results, live version number, saved version texts
    assert len(statements) == 5


def _generator_usage() -> LLMUsage:
    return LLMUsage(
        provider=TEST_LLM_PROVIDER, model=TEST_LLM_MODEL, prompt_tokens=1, completion_tokens=1
    )


def _create_saved_prompt(client, headers, goal="Say {{thing}}") -> int:
    response = client.post(
        "/api/prompts",
        headers=headers,
        json={"fields": [{"name": "goal", "content": goal}], "name": "Eval Prompt"},
    )
    return response.json()["id"]


def _mock_playground_result(output_text="hello world"):
    return PlaygroundResult(
        output_text=output_text,
        latency_ms=1,
        prompt_tokens=1,
        completion_tokens=1,
        cost_usd=0.0,
        provider=TEST_LLM_PROVIDER,
        model=TEST_LLM_MODEL,
    )


class TestEvalCaseCrud:
    def test_create_and_list_case(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)

        resp = client.post(
            f"/api/prompts/{prompt_id}/eval/cases",
            headers=auth_headers,
            json={"method": "rule", "criteria": "hello", "variables": {"thing": "hello"}},
        )
        assert resp.status_code == 200
        case = resp.json()
        assert case["method"] == "rule"
        assert case["position"] == 0

        list_resp = client.get(f"/api/prompts/{prompt_id}/eval/cases", headers=auth_headers)
        assert list_resp.status_code == 200
        assert len(list_resp.json()) == 1

    def test_create_case_blocked_for_non_owner(self, client, auth_headers, second_auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        resp = client.post(
            f"/api/prompts/{prompt_id}/eval/cases",
            headers=second_auth_headers,
            json={"method": "rule", "criteria": "x", "variables": {}},
        )
        assert resp.status_code == 404

    def test_create_case_rejects_invalid_method(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        resp = client.post(
            f"/api/prompts/{prompt_id}/eval/cases",
            headers=auth_headers,
            json={"method": "not-a-method", "criteria": "x", "variables": {}},
        )
        assert resp.status_code == 422

    def test_create_case_rejects_past_cap(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        for _ in range(20):
            resp = client.post(
                f"/api/prompts/{prompt_id}/eval/cases",
                headers=auth_headers,
                json={"method": "manual", "criteria": None, "variables": {}},
            )
            assert resp.status_code == 200

        resp = client.post(
            f"/api/prompts/{prompt_id}/eval/cases",
            headers=auth_headers,
            json={"method": "manual", "criteria": None, "variables": {}},
        )
        assert resp.status_code == 422

    def test_update_case(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        case_id = client.post(
            f"/api/prompts/{prompt_id}/eval/cases",
            headers=auth_headers,
            json={"method": "rule", "criteria": "a", "variables": {}},
        ).json()["id"]

        resp = client.patch(
            f"/api/prompts/{prompt_id}/eval/cases/{case_id}",
            headers=auth_headers,
            json={"method": "judge", "criteria": "b"},
        )
        assert resp.status_code == 200
        assert resp.json()["method"] == "judge"
        assert resp.json()["criteria"] == "b"

    def test_update_case_not_found_returns_404(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        resp = client.patch(
            f"/api/prompts/{prompt_id}/eval/cases/99999",
            headers=auth_headers,
            json={"method": "judge"},
        )
        assert resp.status_code == 404

    def test_delete_case(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        case_id = client.post(
            f"/api/prompts/{prompt_id}/eval/cases",
            headers=auth_headers,
            json={"method": "rule", "criteria": "a", "variables": {}},
        ).json()["id"]

        resp = client.delete(f"/api/prompts/{prompt_id}/eval/cases/{case_id}", headers=auth_headers)
        assert resp.status_code == 204

        list_resp = client.get(f"/api/prompts/{prompt_id}/eval/cases", headers=auth_headers)
        assert list_resp.json() == []


class TestGenerateEvalCases:
    def test_generates_and_does_not_persist_proposals(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)

        with patch("app.api.eval_routes.EvalGeneratorService.generate_proposals") as mock_generate:
            mock_generate.return_value = (
                [
                    EvalCaseProposal(
                        method="rule",
                        criteria="hello",
                        variables={"thing": "hello"},
                        rationale="Happy path.",
                        name="Happy path: greeting",
                    ),
                    EvalCaseProposal(
                        method="judge",
                        criteria="Be concise",
                        variables={"thing": ""},
                        rationale="Edge case: empty input.",
                        name="Edge case: empty input",
                    ),
                ],
                LLMUsage(
                    provider=TEST_LLM_PROVIDER,
                    model=TEST_LLM_MODEL,
                    prompt_tokens=200,
                    completion_tokens=90,
                ),
            )
            resp = client.post(
                f"/api/prompts/{prompt_id}/eval/cases/generate",
                headers=auth_headers,
                json={"goal": "Cover empty input"},
            )

        assert resp.status_code == 200
        proposals = resp.json()["proposals"]
        assert len(proposals) == 2
        assert proposals[0]["rationale"] == "Happy path."
        # The short name is exposed separately so the client never has to derive
        # a case label by slicing the rationale.
        assert proposals[0]["name"] == "Happy path: greeting"

        listed = client.get(f"/api/prompts/{prompt_id}/eval/cases", headers=auth_headers).json()
        assert listed == []

    def test_requires_auth(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        resp = client.post(f"/api/prompts/{prompt_id}/eval/cases/generate", json={})
        assert resp.status_code in (401, 403)

    def test_blocked_for_non_owner(self, client, auth_headers, second_auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        resp = client.post(
            f"/api/prompts/{prompt_id}/eval/cases/generate",
            headers=second_auth_headers,
            json={},
        )
        assert resp.status_code == 404

    def test_rejects_when_at_case_cap(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        for _ in range(20):
            resp = client.post(
                f"/api/prompts/{prompt_id}/eval/cases",
                headers=auth_headers,
                json={"method": "manual", "criteria": None, "variables": {}},
            )
            assert resp.status_code == 200

        resp = client.post(
            f"/api/prompts/{prompt_id}/eval/cases/generate", headers=auth_headers, json={}
        )
        assert resp.status_code == 422
        assert "maximum" in resp.json()["detail"].lower() or "20" in resp.json()["detail"]

    def test_returns_402_when_budget_exceeded(self, client, auth_headers, monkeypatch):
        prompt_id = _create_saved_prompt(client, auth_headers)
        monkeypatch.setenv("GLOBAL_MONTHLY_BUDGET_USD", "0")
        with patch("app.api.eval_routes.EvalGeneratorService.generate_proposals") as mock_generate:
            resp = client.post(
                f"/api/prompts/{prompt_id}/eval/cases/generate", headers=auth_headers, json={}
            )
        assert resp.status_code == 402
        assert "budget" in resp.json()["detail"].lower()
        mock_generate.assert_not_called()

    def test_returns_502_on_openai_error(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        with patch(
            "app.api.eval_routes.EvalGeneratorService.generate_proposals",
            side_effect=OpenAIError("down"),
        ):
            resp = client.post(
                f"/api/prompts/{prompt_id}/eval/cases/generate", headers=auth_headers, json={}
            )
        assert resp.status_code == 502

    def test_caps_generation_count_to_remaining_slots(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        for _ in range(15):
            client.post(
                f"/api/prompts/{prompt_id}/eval/cases",
                headers=auth_headers,
                json={"method": "manual", "criteria": None, "variables": {}},
            )

        with patch("app.api.eval_routes.EvalGeneratorService.generate_proposals") as mock_generate:
            mock_generate.return_value = ([], _generator_usage())
            client.post(
                f"/api/prompts/{prompt_id}/eval/cases/generate", headers=auth_headers, json={}
            )
            # max_cases is the 4th positional arg; the resolved connection follows it.
            assert mock_generate.call_args.args[3] == 5


class TestEvalCaseCsv:
    def test_export_and_import_round_trip_with_quoted_values(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        client.post(
            f"/api/prompts/{prompt_id}/eval/cases",
            headers=auth_headers,
            json={
                "method": "judge",
                "name": "Multilingual clarity",
                "criteria": "Clear, concise\nand accurate",
                "variables": {"thing": "hello, world", "audience": "München"},
                "intentionally_empty": True,
            },
        )

        exported = client.get(f"/api/prompts/{prompt_id}/eval/cases/export", headers=auth_headers)
        assert exported.status_code == 200
        assert exported.headers["content-type"].startswith("text/csv")
        assert exported.text.splitlines()[0] == (
            "method,criteria,name,intentionally_empty,audience,thing"
        )

        other_prompt_id = _create_saved_prompt(client, auth_headers)
        imported = client.post(
            f"/api/prompts/{other_prompt_id}/eval/cases/import",
            headers={**auth_headers, "Content-Type": "text/csv"},
            content=exported.content,
        )
        assert imported.status_code == 200
        assert imported.json()[0]["criteria"] == "Clear, concise\nand accurate"
        assert imported.json()[0]["name"] == "Multilingual clarity"
        assert imported.json()[0]["intentionally_empty"] is True
        assert imported.json()[0]["variables"] == {
            "audience": "München",
            "thing": "hello, world",
        }

    def test_import_skips_blank_rows_and_preserves_order(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        csv_text = "method,criteria,thing\nmanual,,\n,,\nrule,hello,world\n"
        response = client.post(
            f"/api/prompts/{prompt_id}/eval/cases/import",
            headers={**auth_headers, "Content-Type": "text/csv"},
            content=csv_text.encode(),
        )
        assert response.status_code == 200
        assert [case["position"] for case in response.json()] == [0, 1]

    def test_import_is_atomic_when_a_row_is_invalid(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        response = client.post(
            f"/api/prompts/{prompt_id}/eval/cases/import",
            headers={**auth_headers, "Content-Type": "text/csv"},
            content=b"method,criteria\nrule,hello\ninvalid,nope\n",
        )
        assert response.status_code == 422
        assert "Row 3" in response.json()["detail"]
        listed = client.get(f"/api/prompts/{prompt_id}/eval/cases", headers=auth_headers)
        assert listed.json() == []

    def test_import_rejects_bad_headers_and_case_cap(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        bad_header = client.post(
            f"/api/prompts/{prompt_id}/eval/cases/import",
            headers={**auth_headers, "Content-Type": "text/csv"},
            content=b"criteria,method\nhello,rule\n",
        )
        assert bad_header.status_code == 422

        rows = "\n".join(["manual,"] * 21)
        over_cap = client.post(
            f"/api/prompts/{prompt_id}/eval/cases/import",
            headers={**auth_headers, "Content-Type": "text/csv"},
            content=f"method,criteria\n{rows}\n".encode(),
        )
        assert over_cap.status_code == 422
        assert "maximum of 20" in over_cap.json()["detail"]

    def test_csv_routes_enforce_ownership(self, client, auth_headers, second_auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        assert (
            client.get(
                f"/api/prompts/{prompt_id}/eval/cases/export", headers=second_auth_headers
            ).status_code
            == 404
        )
        assert (
            client.post(
                f"/api/prompts/{prompt_id}/eval/cases/import",
                headers={**second_auth_headers, "Content-Type": "text/csv"},
                content=b"method,criteria\n",
            ).status_code
            == 404
        )

    def test_import_is_rate_limited(self, client, auth_headers, monkeypatch):
        """Regression test for Medium (Security): the CSV import endpoint had
        no rate limit despite writing multiple DB rows per request."""
        prompt_id = _create_saved_prompt(client, auth_headers)
        monkeypatch.setenv("TESTING", "false")

        for _ in range(10):
            response = client.post(
                f"/api/prompts/{prompt_id}/eval/cases/import",
                headers={**auth_headers, "Content-Type": "text/csv"},
                content=b"method,criteria\n",
            )
            assert response.status_code == 200

        response = client.post(
            f"/api/prompts/{prompt_id}/eval/cases/import",
            headers={**auth_headers, "Content-Type": "text/csv"},
            content=b"method,criteria\n",
        )
        assert response.status_code == 429


class TestCreateEvalRun:
    def test_run_requires_auth(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        resp = client.post(f"/api/prompts/{prompt_id}/eval/runs")
        assert resp.status_code in (401, 403)

    def test_run_success_returns_scored_run(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        client.post(
            f"/api/prompts/{prompt_id}/eval/cases",
            headers=auth_headers,
            json={"method": "rule", "criteria": "hello", "variables": {"thing": "hello"}},
        )

        with patch("app.services.eval_service.PlaygroundService.run") as mock_run:
            mock_run.return_value = _mock_playground_result("hello there")
            resp = client.post(f"/api/prompts/{prompt_id}/eval/runs", headers=auth_headers)

        assert resp.status_code == 200
        data = resp.json()
        assert data["score"] == 100.0
        assert len(data["results"]) == 1
        assert data["model"]
        assert data["results"][0]["criteria"] == "hello"
        assert data["results"][0]["variables"] == {"thing": "hello"}

    def test_run_with_no_cases_returns_empty_run(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        resp = client.post(f"/api/prompts/{prompt_id}/eval/runs", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["results"] == []
        assert resp.json()["score"] is None

    def test_run_returns_502_on_openai_error(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        client.post(
            f"/api/prompts/{prompt_id}/eval/cases",
            headers=auth_headers,
            json={"method": "judge", "criteria": "be nice", "variables": {}},
        )

        with (
            patch("app.services.eval_service.PlaygroundService.run") as mock_run,
            patch("app.services.llm_client.OpenAI") as mock_openai_cls,
        ):
            mock_run.return_value = _mock_playground_result()
            mock_openai_cls.return_value.chat.completions.create.side_effect = OpenAIError("down")
            resp = client.post(f"/api/prompts/{prompt_id}/eval/runs", headers=auth_headers)

        assert resp.status_code == 200
        data = resp.json()
        assert data["results"][0]["score"] is None
        assert "Judge grading failed" in data["results"][0]["rationale"]

    def test_run_blocked_for_non_owner(self, client, auth_headers, second_auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        resp = client.post(f"/api/prompts/{prompt_id}/eval/runs", headers=second_auth_headers)
        assert resp.status_code == 404

    def test_delete_prompt_leaves_no_orphaned_run_data(self, client, auth_headers, db_session):
        prompt_id = _create_saved_prompt(client, auth_headers)
        client.post(
            f"/api/prompts/{prompt_id}/eval/cases",
            headers=auth_headers,
            json={"method": "rule", "criteria": "hello", "variables": {"thing": "hello"}},
        )
        with patch("app.services.eval_service.PlaygroundService.run") as mock_run:
            mock_run.return_value = _mock_playground_result("hello there")
            resp = client.post(f"/api/prompts/{prompt_id}/eval/runs", headers=auth_headers)
        assert resp.status_code == 200

        from app.models.eval_run import EvalRun
        from app.models.eval_run_result import EvalRunResult

        assert db_session.query(EvalRunResult).count() == 1

        resp = client.delete(f"/api/prompts/{prompt_id}", headers=auth_headers)
        assert resp.status_code == 204

        db_session.expire_all()
        assert db_session.query(EvalRun).count() == 0
        assert db_session.query(EvalRunResult).count() == 0

    def test_run_returns_402_when_budget_exceeded(self, client, auth_headers, monkeypatch):
        prompt_id = _create_saved_prompt(client, auth_headers)
        client.post(
            f"/api/prompts/{prompt_id}/eval/cases",
            headers=auth_headers,
            json={"method": "rule", "criteria": "hello", "variables": {}},
        )
        monkeypatch.setenv("GLOBAL_MONTHLY_BUDGET_USD", "0")

        with patch("app.services.eval_service.PlaygroundService.run") as mock_run:
            resp = client.post(f"/api/prompts/{prompt_id}/eval/runs", headers=auth_headers)

        assert resp.status_code == 402
        assert "budget" in resp.json()["detail"].lower()
        assert resp.json()["budget"]["scope"] == "shared"
        assert resp.json()["budget"]["reason"] == "exhausted"
        assert resp.json()["budget"]["resets_at"].endswith("+00:00")
        assert int(resp.headers["Retry-After"]) > 0
        mock_run.assert_not_called()


class TestRunVersionIdentity:
    def _run(self, client, auth_headers, prompt_id, body=None):
        with patch("app.services.eval_service.PlaygroundService.run") as mock_run:
            mock_run.return_value = _mock_playground_result()
            response = client.post(
                f"/api/prompts/{prompt_id}/eval/runs", headers=auth_headers, json=body
            )
        return response, mock_run

    def _setup(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        client.post(
            f"/api/prompts/{prompt_id}/eval/cases",
            headers=auth_headers,
            json={"method": "rule", "criteria": "hello", "variables": {"thing": "hi"}},
        )
        return prompt_id

    def _list(self, client, auth_headers, prompt_id):
        return client.get(f"/api/prompts/{prompt_id}/eval/runs", headers=auth_headers).json()

    def test_saved_run_matches_current_until_the_prompt_changes(self, client, auth_headers):
        prompt_id = self._setup(client, auth_headers)
        response, _ = self._run(client, auth_headers, prompt_id)
        run = response.json()
        assert (run["tested_version"], run["matches_current"]) == (1, True)

        client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "Shout {{thing}}"}]},
        )
        listed = self._list(client, auth_headers, prompt_id)[0]
        assert (listed["tested_version"], listed["matches_current"]) == (1, False)

    def test_unsaved_sections_are_tested_without_saving_them(self, client, auth_headers):
        prompt_id = self._setup(client, auth_headers)
        draft = [{"name": "goal", "content": "Whisper {{thing}}"}]

        response, mock_run = self._run(client, auth_headers, prompt_id, {"fields": draft})

        assert response.status_code == 200
        assert "Whisper hi" in mock_run.call_args.args[0]
        run = response.json()
        assert run["prompt_version_number"] == 0
        assert (run["tested_version"], run["matches_current"]) == (None, False)
        saved = client.get(f"/api/prompts/{prompt_id}", headers=auth_headers).json()
        assert "Say {{thing}}" in saved["generated_prompt"]

        # Saving the draft's text gives the earlier run its version.
        client.patch(f"/api/prompts/{prompt_id}", headers=auth_headers, json={"fields": draft})
        listed = self._list(client, auth_headers, prompt_id)[0]
        assert (listed["tested_version"], listed["matches_current"]) == (2, True)

        # It stays attributed to that version after the prompt moves on.
        client.patch(
            f"/api/prompts/{prompt_id}",
            headers=auth_headers,
            json={"fields": [{"name": "goal", "content": "Sing {{thing}}"}]},
        )
        listed = self._list(client, auth_headers, prompt_id)[0]
        assert (listed["tested_version"], listed["matches_current"]) == (2, False)

    def test_sections_matching_the_saved_prompt_count_as_the_saved_version(
        self, client, auth_headers
    ):
        prompt_id = self._setup(client, auth_headers)
        response, _ = self._run(
            client,
            auth_headers,
            prompt_id,
            {"fields": [{"name": "goal", "content": "Say {{thing}}"}]},
        )
        run = response.json()
        assert (run["prompt_version_number"], run["tested_version"]) == (1, 1)
        assert run["matches_current"] is True

    def test_runs_recorded_before_tested_text_keep_their_version_number(
        self, client, auth_headers, db_session
    ):
        from app.models.eval_run import EvalRun

        prompt_id = self._setup(client, auth_headers)
        db_session.add(EvalRun(prompt_id=prompt_id, prompt_version_number=1))
        db_session.commit()

        listed = self._list(client, auth_headers, prompt_id)[0]
        assert (listed["tested_version"], listed["matches_current"]) == (1, True)

    def test_duplicate_section_tags_are_rejected(self, client, auth_headers):
        prompt_id = self._setup(client, auth_headers)
        response, mock_run = self._run(
            client,
            auth_headers,
            prompt_id,
            {"fields": [{"name": "Role", "content": "a"}, {"name": "role", "content": "b"}]},
        )
        assert response.status_code == 422
        mock_run.assert_not_called()


class TestListEvalRuns:
    def test_list_runs_returns_newest_first(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        client.post(
            f"/api/prompts/{prompt_id}/eval/cases",
            headers=auth_headers,
            json={"method": "rule", "criteria": "x", "variables": {}},
        )

        with patch("app.services.eval_service.PlaygroundService.run") as mock_run:
            mock_run.return_value = _mock_playground_result("x here")
            client.post(f"/api/prompts/{prompt_id}/eval/runs", headers=auth_headers)
            client.post(f"/api/prompts/{prompt_id}/eval/runs", headers=auth_headers)

        resp = client.get(f"/api/prompts/{prompt_id}/eval/runs", headers=auth_headers)
        assert resp.status_code == 200
        runs = resp.json()
        assert len(runs) == 2
        assert runs[0]["id"] > runs[1]["id"]

    def test_list_runs_never_includes_another_prompts_results(self, client, auth_headers):
        first_prompt_id = _create_saved_prompt(client, auth_headers, goal="first {{thing}}")
        second_prompt_id = _create_saved_prompt(client, auth_headers, goal="second {{thing}}")
        for prompt_id, criterion in (
            (first_prompt_id, "first-only"),
            (second_prompt_id, "second-only"),
        ):
            client.post(
                f"/api/prompts/{prompt_id}/eval/cases",
                headers=auth_headers,
                json={"method": "rule", "criteria": criterion, "variables": {"thing": criterion}},
            )

        with patch("app.services.eval_service.PlaygroundService.run") as mock_run:
            mock_run.side_effect = [
                _mock_playground_result("first-only"),
                _mock_playground_result("second-only"),
            ]
            client.post(f"/api/prompts/{first_prompt_id}/eval/runs", headers=auth_headers)
            client.post(f"/api/prompts/{second_prompt_id}/eval/runs", headers=auth_headers)

        first_runs = client.get(
            f"/api/prompts/{first_prompt_id}/eval/runs", headers=auth_headers
        ).json()
        second_runs = client.get(
            f"/api/prompts/{second_prompt_id}/eval/runs", headers=auth_headers
        ).json()

        assert [result["criteria"] for result in first_runs[0]["results"]] == ["first-only"]
        assert [result["criteria"] for result in second_runs[0]["results"]] == ["second-only"]


class TestRateEvalResult:
    def _run_with_manual_case(self, client, auth_headers, prompt_id):
        client.post(
            f"/api/prompts/{prompt_id}/eval/cases",
            headers=auth_headers,
            json={"method": "manual", "criteria": None, "variables": {}},
        )
        with patch("app.services.eval_service.PlaygroundService.run") as mock_run:
            mock_run.return_value = _mock_playground_result("anything")
            return client.post(f"/api/prompts/{prompt_id}/eval/runs", headers=auth_headers).json()

    def test_rate_pending_result(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        run = self._run_with_manual_case(client, auth_headers, prompt_id)
        result_id = run["results"][0]["id"]

        resp = client.post(
            f"/api/prompts/{prompt_id}/eval/runs/{run['id']}/results/{result_id}/rate",
            headers=auth_headers,
            json={"stars": 4},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["score"] == 80.0
        assert data["results"][0]["score"] == 80.0
        assert data["results"][0]["is_pending"] is False

    def test_rate_rejects_out_of_range_stars(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        run = self._run_with_manual_case(client, auth_headers, prompt_id)
        result_id = run["results"][0]["id"]

        resp = client.post(
            f"/api/prompts/{prompt_id}/eval/runs/{run['id']}/results/{result_id}/rate",
            headers=auth_headers,
            json={"stars": 6},
        )
        assert resp.status_code == 422

    def test_rate_already_rated_result_returns_404(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        run = self._run_with_manual_case(client, auth_headers, prompt_id)
        result_id = run["results"][0]["id"]

        client.post(
            f"/api/prompts/{prompt_id}/eval/runs/{run['id']}/results/{result_id}/rate",
            headers=auth_headers,
            json={"stars": 3},
        )
        resp = client.post(
            f"/api/prompts/{prompt_id}/eval/runs/{run['id']}/results/{result_id}/rate",
            headers=auth_headers,
            json={"stars": 3},
        )
        assert resp.status_code == 404

    def _run_with_judge_case(self, client, auth_headers, prompt_id, judge_side_effect):
        from app.services.eval_service import EvalService

        client.post(
            f"/api/prompts/{prompt_id}/eval/cases",
            headers=auth_headers,
            json={"method": "judge", "criteria": "be nice", "variables": {}},
        )
        with (
            patch("app.services.eval_service.PlaygroundService.run") as mock_run,
            patch.object(EvalService, "_score_judge", side_effect=judge_side_effect),
        ):
            mock_run.return_value = _mock_playground_result()
            return client.post(f"/api/prompts/{prompt_id}/eval/runs", headers=auth_headers).json()

    def test_rating_a_judged_result_records_agreement_without_changing_scores(
        self, client, auth_headers
    ):
        from app.services.eval_service import JudgeResult

        prompt_id = _create_saved_prompt(client, auth_headers)
        judged = JudgeResult(
            score=90.0,
            rationale="ok",
            provider="openai",
            model="m",
            latency_ms=1,
            prompt_tokens=1,
            completion_tokens=1,
            cost_usd=0.0,
        )
        run = self._run_with_judge_case(client, auth_headers, prompt_id, [judged])
        result_id = run["results"][0]["id"]
        url = f"/api/prompts/{prompt_id}/eval/runs/{run['id']}/results/{result_id}/rate"

        resp = client.post(url, headers=auth_headers, json={"stars": 2})

        assert resp.status_code == 200
        data = resp.json()
        assert data["results"][0]["human_score"] == 40.0
        assert data["results"][0]["score"] == 90.0
        assert data["score"] == 90.0
        listed = client.get(f"/api/prompts/{prompt_id}/eval/runs", headers=auth_headers).json()
        assert listed[0]["results"][0]["human_score"] == 40.0
        # A rating is final, like a manual one.
        assert client.post(url, headers=auth_headers, json={"stars": 5}).status_code == 404

    def test_failed_judge_result_cannot_be_rated(self, client, auth_headers):
        from app.services.eval_service import JudgeError

        prompt_id = _create_saved_prompt(client, auth_headers)
        run = self._run_with_judge_case(client, auth_headers, prompt_id, JudgeError("bad"))
        result_id = run["results"][0]["id"]

        resp = client.post(
            f"/api/prompts/{prompt_id}/eval/runs/{run['id']}/results/{result_id}/rate",
            headers=auth_headers,
            json={"stars": 3},
        )
        assert resp.status_code == 404


@pytest.mark.parametrize(
    ("setting", "scope"),
    [("USER_MONTHLY_BUDGET_USD", "user"), ("GLOBAL_MONTHLY_BUDGET_USD", "shared")],
)
def test_eval_estimate_rejection_preserves_remaining_budget_and_cases(
    client, auth_headers, monkeypatch, setting, scope
):
    prompt_id = _create_saved_prompt(client, auth_headers)
    client.post(
        f"/api/prompts/{prompt_id}/eval/cases",
        headers=auth_headers,
        json={"method": "rule", "criteria": "hello", "variables": {}},
    )
    monkeypatch.setenv(setting, "0.000001")
    with patch("app.services.eval_service.PlaygroundService.run") as provider:
        response = client.post(f"/api/prompts/{prompt_id}/eval/runs", headers=auth_headers)
    assert response.status_code == 402
    details = response.json()
    assert "estimated" in details["detail"].lower()
    assert details["budget"]["scope"] == scope
    assert details["budget"]["reason"] == "estimated_cost_exceeds_remaining"
    assert details["budget"]["retry_after"] == int(response.headers["Retry-After"])
    assert (
        client.get("/api/prompts/config", headers=auth_headers).json()["budget_exhausted"] is False
    )
    assert len(client.get(f"/api/prompts/{prompt_id}/eval/cases", headers=auth_headers).json()) == 1
    assert client.get(f"/api/prompts/{prompt_id}/eval/runs", headers=auth_headers).json() == []
    provider.assert_not_called()
