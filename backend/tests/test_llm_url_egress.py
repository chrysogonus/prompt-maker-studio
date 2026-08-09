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
