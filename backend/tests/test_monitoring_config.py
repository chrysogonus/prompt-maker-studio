"""Protect operator views and alert contracts without extra parser dependencies."""

import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
MONITORING = ROOT / "monitoring"


def _dashboards():
    return [
        json.loads(path.read_text())
        for path in (MONITORING / "grafana/provisioning/dashboards").glob("*.json")
    ]


def test_dashboards_have_readable_defaults_and_shared_filters():
    dashboards = _dashboards()
    assert {dashboard["title"] for dashboard in dashboards} == {
        "App Overview",
        "AI & Evaluation",
        "API Health",
    }
    assert len({dashboard["uid"] for dashboard in dashboards}) == 3
    for dashboard in dashboards:
        assert dashboard["time"] == {"from": "now-24h", "to": "now"}
        assert dashboard["refresh"] == "30s"
        assert dashboard["editable"] is False
        filters = {item["name"] for item in dashboard["templating"]["list"]}
        assert {"job", "instance"} <= filters
        assert len({panel["id"] for panel in dashboard["panels"]}) == len(dashboard["panels"])


def test_queries_keep_missing_data_distinct_from_quiet_periods():
    for dashboard in _dashboards():
        for panel in dashboard["panels"]:
            for target in panel.get("targets", []):
                expression = target["expr"]
                assert 'job=~"$job"' in expression
                assert 'instance=~"$instance"' in expression
                assert "or vector(0)" not in expression
                assert target["interval"] in {"1m", "1d"}
                if panel["title"] == "Daily activity by channel":
                    assert target["interval"] == "1d"
                if "increase(" in expression:
                    window = "$__range" if target["instant"] else "$__interval"
                    assert f"[{window}]" in expression
                    assert 'up{job=~"$job",instance=~"$instance"}' in expression
                assert target["datasource"]["uid"] == "prometheus"


def test_overview_separates_current_snapshots_from_period_events():
    # Locate by title below rather than depending on file-system ordering.
    overview = next(d for d in _dashboards() if d["title"] == "App Overview")
    panels = {panel["title"]: panel for panel in overview["panels"]}
    for title, metric in {
        "Accounts now": "pms_accounts_current",
        "Prompts now": "pms_prompts_current",
        "Signups · selected period": "pms_operations_total",
        "Logins · selected period": "pms_operations_total",
        "Refinement requests · selected period": "refine_questions|refine_draft",
        "Evaluations completed · selected period": "eval_run",
    }.items():
        assert metric in panels[title]["targets"][0]["expr"]
    assert not any("increase(" in t["expr"] for t in panels["Accounts now"]["targets"])


def test_every_dashboard_query_has_a_promtool_missing_source_case():
    semantic = json.loads((MONITORING / "prometheus/rules.test.json").read_text())
    cases = semantic["tests"][0]["promql_expr_test"]
    tested = {case["expr"] for case in cases}
    replacements = {
        "$__range": "24h",
        "$__interval": "1m",
        "$__rate_interval": "1m",
        "$job": "fastapi-backend",
        "$instance": "backend:8000",
        "$operation": ".*",
        "$channel": ".*",
        "$provider": ".*",
    }
    for dashboard in _dashboards():
        for panel in dashboard["panels"]:
            for target in panel.get("targets", []):
                expression = target["expr"]
                for key, value in replacements.items():
                    expression = expression.replace(key, value)
                assert expression in tested
    assert all(case["exp_samples"] == [] for case in cases)


def test_monitoring_remains_opt_in_private_and_persistent():
    compose = (ROOT / "docker-compose.yml").read_text()
    for service, port, volume in (
        ("prometheus", "9090:9090", "prometheus_data:/prometheus"),
        ("grafana", "3010:3000", "grafana_data:/var/lib/grafana"),
    ):
        block = re.search(rf"\n  {service}:\n(.*?)(?=\n  \S|\Z)", compose, re.S)[1]
        assert re.search(r"profiles:\s*\n\s*- monitoring", block)
        assert f'"127.0.0.1:{port}"' in block
        assert volume in block
    for setting in (
        "--storage.tsdb.retention.time=30d",
        "--config.file=/etc/prometheus/prometheus.yml",
        "--storage.tsdb.path=/prometheus",
        "./monitoring/prometheus/rules.json:/etc/prometheus/rules.json:ro",
    ):
        assert setting in compose
    prometheus = (MONITORING / "prometheus/prometheus.yml").read_text()
    assert "scrape_interval: 15s" in prometheus
    assert "scrape_interval: 5s" not in prometheus
    assert "/etc/prometheus/rules.json" in prometheus


def test_grafana_bridges_prometheus_alerts_without_duplicate_conditions():
    prometheus = json.loads((MONITORING / "prometheus/rules.json").read_text())
    rules = [rule for group in prometheus["groups"] for rule in group["rules"]]
    alerts = {rule["alert"]: rule for rule in rules if "alert" in rule}
    expected = {
        "BackendUnavailable",
        "SustainedServerErrors",
        "ProviderFailureRate",
        "PasswordResetDeliveryFailures",
        "SnapshotStale",
    }
    assert alerts.keys() == expected
    assert "absent(up{" in alerts["BackendUnavailable"]["expr"]
    server_errors = next(
        rule for rule in rules if rule.get("record") == "pms:http_server_errors:rate5m"
    )
    assert 'status=~"5.."' in server_errors["expr"]
    assert ">= 100" in alerts["SustainedServerErrors"]["expr"]
    assert ">= 20" in alerts["ProviderFailureRate"]["expr"]
    assert "password_reset_email" in alerts["PasswordResetDeliveryFailures"]["expr"]
    grafana = json.loads((MONITORING / "grafana/provisioning/alerting/alerts.json").read_text())
    assert grafana["apiVersion"] == 1
    assert "contactPoints" not in grafana
    assert "policies" not in grafana
    imported = grafana["groups"][0]["rules"]
    assert {rule["title"] for rule in imported} == expected
    for rule in imported:
        assert rule["for"] == "0s"
        assert f'alertname="{rule["title"]}"' in rule["data"][0]["model"]["expr"]
        assert 'alertstate="firing"' in rule["data"][0]["model"]["expr"]
        assert rule["execErrState"] == "Alerting"
