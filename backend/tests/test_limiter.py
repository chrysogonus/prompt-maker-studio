"""
Unit tests for the shared rate-limiter key function.

Regression coverage for the Blocker finding where `_rate_limit_key` fell back to
slowapi's `get_ipaddr`, which checks for a header literally named
"X_FORWARDED_FOR" (underscore) — never sent by any real proxy — and so always
degraded to a single shared bucket for every client.
"""

from starlette.requests import Request

from app.limiter import _rate_limit_key


def _make_request(client_host: str | None, headers: dict[str, str] | None = None) -> Request:
    scope = {
        "type": "http",
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
        "client": (client_host, 12345) if client_host else None,
    }
    return Request(scope)


class TestRateLimitKey:
    def test_bypasses_to_unique_key_in_testing_env(self, monkeypatch):
        monkeypatch.setenv("TESTING", "true")
        request = _make_request("1.2.3.4")
        assert _rate_limit_key(request) != _rate_limit_key(request)

    def test_different_clients_get_different_keys(self, monkeypatch):
        monkeypatch.setenv("TESTING", "false")
        request_a = _make_request("1.2.3.4")
        request_b = _make_request("5.6.7.8")
        assert _rate_limit_key(request_a) != _rate_limit_key(request_b)

    def test_same_client_gets_same_key(self, monkeypatch):
        monkeypatch.setenv("TESTING", "false")
        request_a = _make_request("1.2.3.4")
        request_b = _make_request("1.2.3.4")
        assert _rate_limit_key(request_a) == _rate_limit_key(request_b)

    def test_does_not_trust_client_supplied_underscore_header(self, monkeypatch):
        """Regression test for the original bug: a header literally named
        X_FORWARDED_FOR must never be consulted — only the ASGI-scope client
        address (already trust-boundary-verified by uvicorn's
        ProxyHeadersMiddleware) determines the key."""
        monkeypatch.setenv("TESTING", "false")
        spoofed = _make_request("1.2.3.4", headers={"X_FORWARDED_FOR": "9.9.9.9"})
        plain = _make_request("1.2.3.4")
        assert _rate_limit_key(spoofed) == _rate_limit_key(plain) == "1.2.3.4"

    def test_missing_client_falls_back_to_loopback(self, monkeypatch):
        monkeypatch.setenv("TESTING", "false")
        request = _make_request(None)
        assert _rate_limit_key(request) == "127.0.0.1"
