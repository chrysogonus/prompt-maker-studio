"""
Shared rate limiter instance.
Import this in main.py to wire it up, and in route modules to apply limits.
"""

import os
import uuid

from slowapi import Limiter
from slowapi.util import get_remote_address


def _rate_limit_key(request):
    """Use a unique key per request in test environments to bypass rate limiting.

    In production `request.client.host` is the real per-client IP: uvicorn's
    ProxyHeadersMiddleware (see `run.py`'s `forwarded_allow_ips`) rewrites it from
    the trusted Caddy hop's X-Forwarded-For header before the request reaches here.
    We deliberately don't re-parse X-Forwarded-For ourselves — slowapi's own
    `get_ipaddr` helper checks for a header literally named "X_FORWARDED_FOR"
    (underscore, never sent by any real proxy) and, worse, would blindly trust
    whatever value a client puts in that header if it ever matched. Trusting the
    already-verified `request.client.host` avoids both problems.
    """
    if os.getenv("TESTING") == "true":
        return str(uuid.uuid4())
    return get_remote_address(request)


limiter = Limiter(key_func=_rate_limit_key)
