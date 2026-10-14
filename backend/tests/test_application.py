"""Application composition initializes persistence during server startup."""

from unittest.mock import Mock

from fastapi.testclient import TestClient

from app import main


def test_factory_initializes_database_once_during_lifespan(monkeypatch):
    initialize = Mock()
    validate = Mock()
    monkeypatch.setattr(main, "init_db", initialize)
    monkeypatch.setattr(main, "enforce_secret_key_policy", validate)
    application = main.create_app()
    initialize.assert_not_called()
    monkeypatch.setenv("TESTING", "false")
    with TestClient(application) as client:
        assert client.get("/").status_code == 200
        assert client.get("/").status_code == 200
        initialize.assert_called_once_with()
        validate.assert_called_once_with()


def test_testing_lifespan_skips_production_initialization(monkeypatch):
    initialize = Mock()
    monkeypatch.setattr(main, "init_db", initialize)
    with TestClient(main.create_app()) as client:
        assert client.get("/").json()["status"] == "healthy"
    initialize.assert_not_called()


def test_insecure_signing_key_prevents_database_initialization(monkeypatch):
    import pytest

    initialize = Mock()
    monkeypatch.setattr(main, "init_db", initialize)
    monkeypatch.setattr(main, "SECRET_KEY", "secret")
    monkeypatch.setenv("TESTING", "false")
    with pytest.raises(RuntimeError, match="SECRET_KEY"), TestClient(main.create_app()):
        pass
    initialize.assert_not_called()
