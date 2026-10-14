"""Egress policy for user-supplied provider base URLs.

Regression tests for the "open registration turns custom provider URLs into an
internal-network SSRF primitive" finding. A base URL becomes a server-side
request target, so a host that resolves into private address space must be
rejected unless the operator explicitly allowed it.
"""

import socket

import pytest

from app.services.llm_providers import InvalidConnectionError, validate_base_url


def _resolve_to(monkeypatch, *addresses: str) -> None:
    """Pin DNS so these tests never depend on the network."""

    def fake_getaddrinfo(host, port, *args, **kwargs):
        return [
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (address, 0))
            for address in addresses
        ]

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)


@pytest.fixture(autouse=True)
def _closed_by_default(monkeypatch):
    monkeypatch.delenv("ALLOW_PRIVATE_LLM_URLS", raising=False)


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",  # loopback
        "10.1.2.3",  # RFC1918
        "172.16.5.4",  # RFC1918
        "192.168.1.10",  # RFC1918
        "169.254.169.254",  # cloud instance metadata
        "0.0.0.0",  # unspecified
        "224.0.0.1",  # multicast
        "100.100.100.200",  # CGNAT / Alibaba metadata
    ],
)
def test_private_destinations_are_rejected(monkeypatch, address):
    _resolve_to(monkeypatch, address)
    with pytest.raises(InvalidConnectionError, match="private or loopback"):
        validate_base_url("https://evil.example.com/v1")


def test_ipv6_loopback_and_mapped_ipv4_are_rejected(monkeypatch):
    _resolve_to(monkeypatch, "::1")
    with pytest.raises(InvalidConnectionError, match="private or loopback"):
        validate_base_url("https://evil.example.com/v1")

    _resolve_to(monkeypatch, "::ffff:169.254.169.254")
    with pytest.raises(InvalidConnectionError, match="private or loopback"):
        validate_base_url("https://evil.example.com/v1")


def test_a_single_private_answer_rejects_the_whole_host(monkeypatch):
    """A name resolving to one public and one internal address must not pass:
    checking only the first answer would let the connection land internally."""
    _resolve_to(monkeypatch, "93.184.216.34", "10.0.0.5")
    with pytest.raises(InvalidConnectionError, match="private or loopback"):
        validate_base_url("https://split-horizon.example.com/v1")


def test_public_destinations_are_accepted(monkeypatch):
    _resolve_to(monkeypatch, "93.184.216.34")
    assert validate_base_url("https://api.example.com/v1/") == "https://api.example.com/v1"


def test_unresolvable_host_is_a_user_safe_error(monkeypatch):
    def boom(*args, **kwargs):
        error = socket.gaierror("nope")
        raise error

    monkeypatch.setattr(socket, "getaddrinfo", boom)
    with pytest.raises(InvalidConnectionError, match="Could not resolve"):
        validate_base_url("https://nx.example.com/v1")


def test_operator_can_opt_in_to_local_providers(monkeypatch):
    """Self-hosting Ollama or vLLM on the same network is a real use case, so
    the block is an opt-out — but one the operator has to make deliberately."""
    monkeypatch.setenv("ALLOW_PRIVATE_LLM_URLS", "true")
    _resolve_to(monkeypatch, "127.0.0.1")
    assert validate_base_url("http://localhost:11434/v1") == "http://localhost:11434/v1"


def test_opt_in_is_not_enabled_by_a_stray_value(monkeypatch):
    monkeypatch.setenv("ALLOW_PRIVATE_LLM_URLS", "no")
    _resolve_to(monkeypatch, "127.0.0.1")
    with pytest.raises(InvalidConnectionError):
        validate_base_url("http://localhost:11434/v1")


@pytest.mark.parametrize("provider", ["ollama", "vllm"])
def test_omitted_local_url_still_requires_private_network_opt_in(monkeypatch, provider):
    from app.services.llm_providers import resolve_connection

    _resolve_to(monkeypatch, "127.0.0.1")
    with pytest.raises(InvalidConnectionError):
        resolve_connection(
            provider_handle=provider,
            base_url=None,
            model="test",
            api_key=None,
            has_stored_key=False,
        )


def test_transport_pins_public_ip_and_keeps_host_and_tls_identity(monkeypatch):
    import httpx

    from app.services.llm_transport import PublicLLMTransport

    _resolve_to(monkeypatch, "93.184.216.34")
    sent = []

    def send(self, request):
        sent.append(request)
        return httpx.Response(200, json={"ok": True})

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", send)
    with httpx.Client(transport=PublicLLMTransport(), trust_env=False) as client:
        assert client.get("https://provider.example/v1/models").status_code == 200
    assert sent[0].url.host == "93.184.216.34"
    assert sent[0].headers["host"] == "provider.example"
    assert sent[0].extensions["sni_hostname"] == "provider.example"


def test_transport_rejects_rebound_private_address_before_connecting(monkeypatch):
    import httpx

    from app.services.llm_transport import PublicLLMTransport

    _resolve_to(monkeypatch, "93.184.216.34")
    validate_base_url("https://provider.example/v1")
    _resolve_to(monkeypatch, "169.254.169.254")

    def forbidden(self, request):
        pytest.fail("private address reached the network transport")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", forbidden)
    with (
        httpx.Client(transport=PublicLLMTransport(), trust_env=False) as client,
        pytest.raises(httpx.ConnectError, match="private or loopback"),
    ):
        client.get("https://provider.example/v1/models")


def test_provider_client_does_not_follow_redirect_to_metadata(monkeypatch):
    import httpx
    from openai import APIStatusError

    from app.services.llm_client import _build_connection
    from app.services.llm_providers import PROVIDERS

    _resolve_to(monkeypatch, "93.184.216.34")
    sent = []

    def redirect(self, request):
        sent.append(request)
        return httpx.Response(307, headers={"location": "http://169.254.169.254/latest/meta-data/"})

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", redirect)
    connection = _build_connection(
        PROVIDERS["custom"], "test", "https://provider.example/v1", "fake"
    )
    with connection.client, pytest.raises(APIStatusError):
        connection.client.models.list()
    assert len(sent) == 1


def test_transport_preserves_idna_hostname_for_dns_and_tls(monkeypatch):
    import ssl

    import httpx

    from app.services.llm_transport import PublicLLMTransport

    resolved_hosts = []
    sent = []

    def resolve(host, port, *args, **kwargs):
        resolved_hosts.append(host)
        return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("93.184.216.34", 0))]

    def send(self, request):
        sent.append(request)
        return httpx.Response(200, json={"ok": True})

    monkeypatch.setattr(socket, "getaddrinfo", resolve)
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", send)
    with httpx.Client(transport=PublicLLMTransport(), trust_env=False) as client:
        client.get("https://faß.de/v1/models")

    assert resolved_hosts == ["xn--fa-hia.de"]
    assert sent[0].headers["host"] == "xn--fa-hia.de"
    tls = ssl.create_default_context().wrap_bio(
        ssl.MemoryBIO(),
        ssl.MemoryBIO(),
        server_side=False,
        server_hostname=sent[0].extensions["sni_hostname"],
    )
    assert tls.server_hostname == "xn--fa-hia.de"


@pytest.mark.parametrize(("trusted", "allow_private"), [(True, False), (False, True)])
def test_trusted_connections_keep_redirect_and_proxy_defaults(monkeypatch, trusted, allow_private):
    import httpx

    from app.services.llm_client import _build_connection
    from app.services.llm_providers import PROVIDERS
    from app.services.llm_transport import PublicLLMTransport

    monkeypatch.setenv("ALLOW_PRIVATE_LLM_URLS", str(allow_private).lower())
    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.example:8080")
    connection = _build_connection(
        PROVIDERS["custom"], "test", "http://localhost:11434/v1", "fake", trusted=trusted
    )
    with connection.client:
        client = connection.client._client
        assert client.follow_redirects is True
        assert client._trust_env is True
        assert not isinstance(client._transport, PublicLLMTransport)
        assert any(
            isinstance(transport, httpx.HTTPTransport) for transport in client._mounts.values()
        )


def test_public_only_client_disables_environment_proxies(monkeypatch):
    from app.services.llm_client import _build_connection
    from app.services.llm_providers import PROVIDERS
    from app.services.llm_transport import PublicLLMTransport

    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.example:8080")
    connection = _build_connection(
        PROVIDERS["custom"], "test", "https://provider.example/v1", "fake"
    )
    with connection.client:
        client = connection.client._client
        assert client._trust_env is False
        assert client._mounts == {}
        assert isinstance(client._transport, PublicLLMTransport)
