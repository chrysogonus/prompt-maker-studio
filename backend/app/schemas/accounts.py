"""Accounts request and response contracts."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, EmailStr, Field, field_validator

from app.auth.utils import BCRYPT_MAX_PASSWORD_BYTES


def _validate_new_password(value: str) -> str:
    """Enforce the policy for newly chosen passwords; login never applies it."""
    if len(value.encode("utf-8")) > BCRYPT_MAX_PASSWORD_BYTES:
        msg = "Password must not exceed 72 UTF-8 bytes"
        raise ValueError(msg)
    if not any(c.isdigit() for c in value):
        msg = "Password must contain at least one number"
        raise ValueError(msg)
    if not any(not c.isalnum() and not c.isspace() for c in value):
        msg = "Password must contain at least one special character, such as $ or #"
        raise ValueError(msg)
    return value


NewPassword = Annotated[str, AfterValidator(_validate_new_password)]


class UserCreate(BaseModel):
    """Schema for user registration."""

    username: str = Field(
        ...,
        min_length=3,
        max_length=50,
        pattern=r"^[a-zA-Z0-9_-]+$",
        description="Username (3-50 chars; letters, digits, underscores, hyphens)",
    )
    # Character limits bound validation; NewPassword also enforces bcrypt's byte limit.
    password: NewPassword = Field(..., min_length=10, max_length=72, description="Password")
    email: EmailStr = Field(
        ..., max_length=254, description="Email address used for password reset"
    )

    @field_validator("username", mode="before")
    @classmethod
    def strip_username(cls, v: str) -> str:
        if isinstance(v, str):
            return v.strip()
        return v


class UserLogin(BaseModel):
    """Schema for user login."""

    username: str = Field(..., description="Username or email")
    password: str = Field(..., description="Password")


class Token(BaseModel):
    """
    Schema for a session response.

    The access token itself is not here — it is set as an httpOnly cookie, so
    that page scripts (and anything that gets itself onto the page) cannot read
    it. `expires_at` is what the UI needs to warn about an imminent timeout.
    """

    token_type: str = "bearer"
    expires_at: datetime


class TokenData(BaseModel):
    """Schema for token payload data."""

    username: str | None = None


class UserResponse(BaseModel):
    """Schema for user response."""

    id: int
    username: str
    email: str | None = None
    created_at: datetime
    default_library_view: Literal["grid", "list"] | None = None
    default_eval_method: Literal["rule", "judge", "manual"] | None = None
    auto_run_eval_on_update: bool = False

    class Config:
        from_attributes = True


class UserUpdate(BaseModel):
    """Schema for updating the authenticated user's profile (PATCH /api/auth/me)."""

    email: EmailStr | None = Field(
        None,
        max_length=254,  # RFC 5321 maximum
        description="Email address used for password reset",
    )
    current_password: str | None = Field(
        None,
        max_length=72,
        description="Current password; required when changing the email address",
    )
    new_username: str | None = Field(
        None,
        min_length=3,
        max_length=50,
        pattern=r"^[a-zA-Z0-9_-]+$",
        description="New username (3-50 chars; letters, digits, underscores, hyphens)",
    )
    # `default_model` was removed here: the model now lives on the user's
    # provider connection (PUT /api/auth/me/llm-connection), so a second,
    # separately-validated model preference had no coherent meaning.
    default_library_view: Literal["grid", "list"] | None = Field(
        None, description="Initial view mode when opening the Library"
    )
    default_eval_method: Literal["rule", "judge", "manual"] | None = Field(
        None, description="Preselected scoring method for newly-added eval cases"
    )
    auto_run_eval_on_update: bool | None = Field(
        None,
        description=(
            "Kept for when Evaluate returns. Nothing starts an evaluation on its own "
            "while Evaluate is deferred."
        ),
    )

    @field_validator("new_username", mode="before")
    @classmethod
    def strip_new_username(cls, v: str | None) -> str | None:
        if isinstance(v, str):
            return v.strip()
        return v


class ForgotPasswordRequest(BaseModel):
    """Schema for requesting a password reset email."""

    email: EmailStr = Field(..., max_length=254, description="Email address on the account")


class ResetPasswordRequest(BaseModel):
    """Schema for completing a password reset using the emailed token."""

    token: str = Field(..., min_length=1, description="Reset token from the email link")
    new_password: NewPassword = Field(
        ...,
        min_length=10,
        max_length=72,
        description="New password (min 10 characters with a number and a special character)",
    )


class DeleteAccountRequest(BaseModel):
    """Schema for DELETE /api/auth/me.

    Deletion is irreversible and removes every row the user owns, so it asks for
    the password rather than accepting the session alone — an unattended or
    stolen browser session should not be enough to destroy an account.
    """

    current_password: str = Field(
        ..., min_length=1, max_length=72, description="Current password, for verification"
    )


class ChangePasswordRequest(BaseModel):
    """Schema for authenticated in-app password change (POST /api/auth/change-password)."""

    current_password: str = Field(
        ..., min_length=1, max_length=72, description="Current password, for verification"
    )
    new_password: NewPassword = Field(
        ...,
        min_length=10,
        max_length=72,
        description="New password (min 10 characters with a number and a special character)",
    )


_MAX_EVAL_VARIABLES = 50

_MAX_EVAL_VARIABLE_NAME_LENGTH = 100

_MAX_EVAL_VARIABLE_VALUE_LENGTH = 10_000
