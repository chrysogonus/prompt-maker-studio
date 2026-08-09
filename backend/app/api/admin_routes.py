"""
Operator diagnostics routes.
"""

import hmac
import logging
import os

from fastapi import APIRouter, HTTPException, Request, status

from app.limiter import limiter
from app.models.schemas import SmtpDiagnosticResponse
from app.services.email_service import check_smtp_connection

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _require_admin_diagnostics_token(request: Request) -> None:
    expected_token = os.getenv("ADMIN_DIAGNOSTICS_TOKEN")
    if not expected_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin diagnostics are not configured.",
        )

    supplied_token = request.headers.get("X-Admin-Token") or ""
    if not hmac.compare_digest(supplied_token, expected_token):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin diagnostics token is invalid.",
        )


@router.post("/smtp/check", response_model=SmtpDiagnosticResponse)
@limiter.limit("5/minute")
def check_smtp(request: Request):
    """Run a token-protected SMTP connectivity smoke test for operators."""
    _require_admin_diagnostics_token(request)

    try:
        check_smtp_connection()
    except Exception:
        # Full exception (host/port/internal error text) goes to the server log
        # only — the HTTP response stays generic to avoid disclosing SMTP
        # connection details, even though this route is already token-gated.
        logger.exception("smtp_diagnostic_failed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SMTP connectivity check failed. See server logs for details.",
        ) from None

    return SmtpDiagnosticResponse(ok=True, message="SMTP connectivity check succeeded.")
