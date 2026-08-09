"""Go-live smoke tests for critical user journeys."""

from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from fastapi import status

from app.auth.utils import hash_password_reset_token
from app.models.user import User


def test_register_login_generate_save_reload_and_reset_password(client, db_session):
    """Critical happy path: account, prompt persistence, reload, and account recovery."""
    register = client.post(
        "/api/auth/register",
        json={"username": "smokeuser", "password": "OldPass99!", "email": "smoke@example.com"},
    )
    assert register.status_code == status.HTTP_201_CREATED

    login = client.post(
        "/api/auth/login",
        json={"username": "smokeuser", "password": "OldPass99!"},
    )
    assert login.status_code == status.HTTP_200_OK
    token = client.cookies["access_token"]
    client.cookies.clear()
    headers = {"Authorization": f"Bearer {token}"}

    generated = client.post(
        "/api/prompts/generate",
        json={"fields": [{"name": "goal", "content": "ship a go-live smoke test"}]},
        headers=headers,
    )
    assert generated.status_code == status.HTTP_200_OK
    prompt_id = generated.json()["id"]

    saved = client.patch(
        f"/api/prompts/{prompt_id}",
        json={"name": "Go-live smoke prompt"},
        headers=headers,
    )
    assert saved.status_code == status.HTTP_200_OK
    assert saved.json()["name"] == "Go-live smoke prompt"

    reloaded = client.get("/api/prompts/saved", headers=headers)
    assert reloaded.status_code == status.HTTP_200_OK
    assert [prompt["name"] for prompt in reloaded.json()] == ["Go-live smoke prompt"]

    profile = client.patch(
        "/api/auth/me",
        json={"email": "smoke@example.com"},
        headers=headers,
    )
    assert profile.status_code == status.HTTP_200_OK

    captured_links: list[str] = []

    def capture_reset_email(to_email: str, reset_link: str) -> None:
        assert to_email == "smoke@example.com"
        captured_links.append(reset_link)

    with patch("app.api.auth_routes.send_password_reset_email", side_effect=capture_reset_email):
        forgot = client.post(
            "/api/auth/forgot-password",
            json={"email": "smoke@example.com"},
        )

    assert forgot.status_code == status.HTTP_200_OK
    assert len(captured_links) == 1

    reset_token = parse_qs(urlparse(captured_links[0]).query)["token"][0]
    user = db_session.query(User).filter(User.username == "smokeuser").one()
    assert user.reset_token == hash_password_reset_token(reset_token)
    assert user.reset_token != reset_token

    reset = client.post(
        "/api/auth/reset-password",
        json={"token": reset_token, "new_password": "NewPass99!"},
    )
    assert reset.status_code == status.HTTP_200_OK

    old_login = client.post(
        "/api/auth/login",
        json={"username": "smokeuser", "password": "OldPass99!"},
    )
    assert old_login.status_code == status.HTTP_401_UNAUTHORIZED

    new_login = client.post(
        "/api/auth/login",
        json={"username": "smokeuser", "password": "NewPass99!"},
    )
    assert new_login.status_code == status.HTTP_200_OK
