"""
Session cookie handling.

The access token used to be returned in the response body and kept in the
browser's `localStorage`, which made it readable by any script that got itself
onto the page. It now travels in an httpOnly cookie the page's own JavaScript
cannot see.

Because the browser attaches that cookie automatically, cookie-authenticated
state-changing requests need CSRF protection. This module implements the
double-submit pattern: alongside the httpOnly session cookie, the server sets a
readable CSRF cookie, and the client must echo its value in a request header.
An attacker on another origin can cause the cookie to be sent but cannot read
it to forge the header.

Deployment note: the frontend and `/api` share one origin behind Caddy. Leave
`COOKIE_DOMAIN` unset so the cookie remains host-only; widening it would expose
the session to sibling subdomains without helping the default topology. Local
development also shares a host (cookies ignore ports).
"""

from datetime import UTC, datetime, timedelta
import os
import secrets

from fastapi import Response

from app.auth.utils import ACCESS_TOKEN_EXPIRE_MINUTES

SESSION_COOKIE_NAME = "access_token"
CSRF_COOKIE_NAME = "csrf_token"
CSRF_HEADER_NAME = "X-CSRF-Token"

# Methods that cannot change server state, and so need no CSRF token.
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})


def _cookie_domain() -> str | None:
    """The domain to scope cookies to, or None to bind them to the exact host."""
    return os.getenv("COOKIE_DOMAIN") or None


def _cookie_secure() -> bool:
    """
    Whether to mark cookies Secure (HTTPS-only).

    Defaults to on. Local development over plain HTTP must opt out explicitly
    with `COOKIE_SECURE=false`, so a production deployment cannot end up sending
    session cookies in the clear by forgetting to set something.
    """
    return os.getenv("COOKIE_SECURE", "true").strip().lower() not in {"false", "0", "no"}


def session_expires_at() -> datetime:
    """When a session issued right now will expire."""
    return datetime.now(UTC) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)


def issue_session(response: Response, access_token: str) -> None:
    """Attach a fresh session cookie and its matching CSRF cookie."""
    max_age = ACCESS_TOKEN_EXPIRE_MINUTES * 60
    common = {
        "max_age": max_age,
        "path": "/",
        "domain": _cookie_domain(),
        "secure": _cookie_secure(),
        "samesite": "lax",
    }

    response.set_cookie(SESSION_COOKIE_NAME, access_token, httponly=True, **common)
    # Deliberately NOT httpOnly: the frontend has to read this one to echo it
    # back in a header. It is not a credential on its own — it only proves the
    # request came from a page that can read this site's cookies.
    response.set_cookie(CSRF_COOKIE_NAME, secrets.token_urlsafe(32), httponly=False, **common)


def clear_session(response: Response) -> None:
    """Remove both cookies. Attributes must match those used to set them."""
    for name in (SESSION_COOKIE_NAME, CSRF_COOKIE_NAME):
        response.delete_cookie(
            name,
            path="/",
            domain=_cookie_domain(),
            secure=_cookie_secure(),
            samesite="lax",
        )
