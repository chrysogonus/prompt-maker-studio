"""Admin request and response contracts."""

from pydantic import BaseModel


class SmtpDiagnosticResponse(BaseModel):
    """Schema for SMTP diagnostic check responses."""

    ok: bool
    message: str
