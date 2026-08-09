"""
Pytest configuration and fixtures.
"""

import os
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Set testing environment variable before importing app
os.environ["TESTING"] = "true"
# Deterministic key material for the per-user provider-credential encryption
# (services/secret_store.py). Without it, encryption falls back to deriving
# from SECRET_KEY, which tests do not pin.
os.environ.setdefault("SECRET_KEY", "test-secret-key-that-is-long-enough-1234567890")
# Session cookies are Secure by default, which means an HTTPS-only cookie the
# TestClient (plain http://testserver) would never send back. Production keeps
# the default; only this in-process transport opts out.
os.environ.setdefault("COOKIE_SECURE", "false")
# Registration is closed by default in production (only the first account gets
# through). The suite registers many users per test, so it opts in explicitly;
# the closed-mode behaviour has its own tests in test_auth.py.
os.environ.setdefault("REGISTRATION_MODE", "open")


from app.database.connection import Base, apply_sqlite_pragmas, get_db
from app.main import app

# The bring-your-own provider connection every authenticated test user gets, so
# AI-backed routes resolve a client instead of 422-ing on "no provider". Tests
# that exercise the unconfigured path clear it explicitly.
TEST_LLM_PROVIDER = "openai"
TEST_LLM_MODEL = "gpt-4o-mini"
TEST_LLM_API_KEY = "sk-test-key-not-real-0000"
TEST_LITELLM_PRICING = {
    "gpt-4o-mini": {
        "litellm_provider": "openai",
        "input_cost_per_token": 1.5e-7,
        "output_cost_per_token": 6e-7,
    },
    "gemini/gemini-3.6-flash": {
        "litellm_provider": "gemini",
        "input_cost_per_token": 1.5e-6,
        "output_cost_per_token": 7.5e-6,
    },
}


@pytest.fixture(autouse=True)
def mock_litellm_pricing():
    """Keep the suite deterministic and prevent real LiteLLM HTTP requests."""
    from app.services import llm_pricing

    llm_pricing._reset_pricing_cache()
    with patch(
        "app.services.llm_pricing._fetch_pricing_json",
        return_value=TEST_LITELLM_PRICING,
    ) as mock_fetch:
        yield mock_fetch
    llm_pricing._reset_pricing_cache()


@pytest.fixture(autouse=True)
def reset_model_catalog_cache():
    """A process-global TTL cache must not leak model ids between tests."""
    from app.services import llm_model_catalog

    llm_model_catalog._reset_model_cache()
    yield
    llm_model_catalog._reset_model_cache()


@pytest.fixture
def test_db(tmp_path):
    """Create a fresh database for each test."""
    database_url = f"sqlite:///{tmp_path / 'test.db'}"
    engine = create_engine(database_url, connect_args={"check_same_thread": False})
    # Same PRAGMAs as production — foreign_keys in particular, or every
    # ON DELETE in the schema is inert here and cascade tests prove nothing.
    apply_sqlite_pragmas(engine)

    # Create all tables
    Base.metadata.create_all(bind=engine)

    testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    yield testing_session_local

    # Drop all tables after test
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db_session(test_db):
    """Provide a database session for tests."""
    session = test_db()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(test_db):
    """Create a test client with a test database."""

    def override_get_db():
        session = test_db()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()


def _register_and_connect(client, username: str, password: str, email: str) -> dict[str, str]:
    """Register a user, log in, and connect them to a test LLM provider.

    Logging in sets an httpOnly session cookie, but these fixtures return bearer
    headers instead: one TestClient has a single cookie jar, so two concurrent
    users (`auth_headers` and `second_auth_headers`, used together by every
    ownership test) cannot both be represented by cookies. The jar is emptied
    afterwards so requests authenticate via the returned header alone — leaving
    the cookie in place would route them down the cookie path and trip CSRF.

    The cookie path itself is covered directly in `test_auth_cookies.py`.
    """
    client.post(
        "/api/auth/register",
        json={"username": username, "password": password, "email": email},
    )
    client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    headers = {"Authorization": f"Bearer {client.cookies['access_token']}"}
    client.cookies.clear()

    client.put(
        "/api/auth/me/llm-connection",
        json={
            "provider": TEST_LLM_PROVIDER,
            "model": TEST_LLM_MODEL,
            "api_key": TEST_LLM_API_KEY,
        },
        headers=headers,
    )
    return headers


@pytest.fixture
def auth_headers(client):
    """Get authentication headers for the primary test user."""
    return _register_and_connect(client, "testuser", "testpass123", "testuser@example.com")


@pytest.fixture
def second_auth_headers(client):
    """Get authentication headers for a second, distinct test user."""
    return _register_and_connect(client, "otheruser", "otherpass123", "otheruser@example.com")


def make_connection(create, provider_handle: str = TEST_LLM_PROVIDER, model: str = TEST_LLM_MODEL):
    """Build an LLMConnection whose SDK client is a mock.

    Service-level tests take a connection as an argument now, so they no longer
    need to patch anything: hand them one of these with `create` set to a
    response or a side effect.
    """
    from app.services.llm_client import LLMConnection
    from app.services.llm_providers import PROVIDERS

    client = MagicMock()
    client.chat.completions.create = create
    return LLMConnection(provider=PROVIDERS[provider_handle], model=model, client=client)


def make_chat_response(content: str, prompt_tokens: int = 100, completion_tokens: int = 50):
    """Build a stand-in for an OpenAI-SDK chat completion response."""
    response = MagicMock()
    response.choices = [MagicMock()]
    response.choices[0].message.content = content
    response.usage.prompt_tokens = prompt_tokens
    response.usage.completion_tokens = completion_tokens
    return response


@pytest.fixture
def mock_llm():
    """Patch the one place a provider client is constructed.

    Yields the mocked `OpenAI` class, so a test can set
    `mock_llm.return_value.chat.completions.create` to a response or a side
    effect. Because `llm_client` is the sole construction site, this single
    patch covers every AI-backed feature.
    """
    with patch("app.services.llm_client.OpenAI") as mock_openai_cls:
        yield mock_openai_cls


@pytest.fixture
def allow_private_llm_urls(monkeypatch):
    """Opt in to private/loopback provider URLs for the self-hosted flows.

    Rejecting them is the default (see llm_providers.assert_public_host), so a
    test exercising an Ollama or vLLM endpoint on localhost has to make the
    same choice an operator would.
    """
    monkeypatch.setenv("ALLOW_PRIVATE_LLM_URLS", "true")
