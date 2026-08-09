"""
Tests for the Evaluate tab API: eval case CRUD, running an evaluation,
run history, and manual star ratings.
"""

from unittest.mock import patch

from openai import OpenAIError

from app.services.eval_generator_service import EvalCaseProposal
from app.services.playground_service import PlaygroundResult
from app.services.spend_ledger import LLMUsage
from tests.conftest import TEST_LLM_MODEL, TEST_LLM_PROVIDER


def _generator_usage() -> LLMUsage:
    return LLMUsage(
        provider=TEST_LLM_PROVIDER, model=TEST_LLM_MODEL, prompt_tokens=1, completion_tokens=1
    )


def _create_saved_prompt(client, headers, template="Say {{thing}}") -> int:
    response = client.post(
        "/api/prompts/generate",
        headers=headers,
        json={"fields": [{"name": "goal", "content": "x"}], "name": "Eval Prompt"},
    )
    prompt_id = response.json()["id"]
    client.patch(f"/api/prompts/{prompt_id}", headers=headers, json={"generated_prompt": template})
    return prompt_id


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
        mock_run.assert_not_called()

    def test_run_sends_completion_email_when_opted_in(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        client.post(
            f"/api/prompts/{prompt_id}/eval/cases",
            headers=auth_headers,
            json={"method": "rule", "criteria": "hello", "variables": {}},
        )
        client.patch("/api/auth/me", headers=auth_headers, json={"notify_eval_complete": True})

        with (
            patch("app.services.eval_service.PlaygroundService.run") as mock_run,
            patch("app.api.eval_routes.send_eval_run_complete_email") as mock_email,
        ):
            mock_run.return_value = _mock_playground_result("hello there")
            resp = client.post(f"/api/prompts/{prompt_id}/eval/runs", headers=auth_headers)

        assert resp.status_code == 200
        mock_email.assert_called_once()

    def test_run_does_not_send_completion_email_when_opted_out(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        client.post(
            f"/api/prompts/{prompt_id}/eval/cases",
            headers=auth_headers,
            json={"method": "rule", "criteria": "hello", "variables": {}},
        )

        with (
            patch("app.services.eval_service.PlaygroundService.run") as mock_run,
            patch("app.api.eval_routes.send_eval_run_complete_email") as mock_email,
        ):
            mock_run.return_value = _mock_playground_result("hello there")
            client.post(f"/api/prompts/{prompt_id}/eval/runs", headers=auth_headers)

        mock_email.assert_not_called()

    def test_run_sends_regression_email_when_score_drops(self, client, auth_headers):
        prompt_id = _create_saved_prompt(client, auth_headers)
        client.post(
            f"/api/prompts/{prompt_id}/eval/cases",
            headers=auth_headers,
            json={"method": "rule", "criteria": "hello", "variables": {}},
        )
        client.patch("/api/auth/me", headers=auth_headers, json={"notify_eval_regression": True})

        with patch("app.services.eval_service.PlaygroundService.run") as mock_run:
            mock_run.return_value = _mock_playground_result("hello there")
            client.post(f"/api/prompts/{prompt_id}/eval/runs", headers=auth_headers)

        with (
            patch("app.services.eval_service.PlaygroundService.run") as mock_run,
            patch("app.api.eval_routes.send_eval_score_regression_email") as mock_email,
        ):
            mock_run.return_value = _mock_playground_result("nothing matches")
            resp = client.post(f"/api/prompts/{prompt_id}/eval/runs", headers=auth_headers)

        assert resp.status_code == 200
        assert resp.json()["score"] == 0.0
        mock_email.assert_called_once()


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
        first_prompt_id = _create_saved_prompt(client, auth_headers, template="first {{thing}}")
        second_prompt_id = _create_saved_prompt(client, auth_headers, template="second {{thing}}")
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
