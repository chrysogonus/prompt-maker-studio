"""
Authentication utilities for password hashing and JWT token management.
"""

from datetime import UTC, datetime, timedelta
import hashlib
import logging
import os

import bcrypt
import jwt

logger = logging.getLogger(__name__)

# JWT Configuration
_INSECURE_DEFAULT_KEY = "your-secret-key-change-this-in-production"

# Every signing key this repository has ever shipped as an example. Each one is
# public, so a JWT signed with any of them can be forged by anyone who has read
# the repo — `is_insecure_secret_key` rejects all of them, not just the current
# `.env.example` value. Add to this set whenever a placeholder changes; removing
# an entry would silently re-accept a key that is already published.
_KNOWN_INSECURE_KEYS = frozenset(
    {
        _INSECURE_DEFAULT_KEY,
        "your-secret-key-change-this-in-production-use-openssl-rand-hex-32",
        "CHANGE_ME_RUN_openssl_rand_hex_32",
        "your-secret-key-here",
        "changeme",
        "secret",
    }
)

# `openssl rand -hex 32` produces 64 characters; anything materially shorter is
# too weak to sign session tokens with, whatever its origin.
_MIN_SECRET_KEY_LENGTH = 32

SECRET_KEY = os.getenv("SECRET_KEY", _INSECURE_DEFAULT_KEY)
ALGORITHM = "HS256"
# Token creation and validation can straddle a small host-clock correction.
# A narrow tolerance prevents a freshly issued token from being rejected as
# "not yet valid" while keeping both issue-time and expiry checks bounded.
_JWT_CLOCK_SKEW_SECONDS = 5


def is_insecure_secret_key(key: str) -> bool:
    """Report whether a JWT signing key must be rejected at startup.

    A key is insecure when it is one of the published example values or when it
    is too short to resist offline brute force.
    """
    return key.strip() in _KNOWN_INSECURE_KEYS or len(key.strip()) < _MIN_SECRET_KEY_LENGTH


_raw_expire = os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30")
try:
    ACCESS_TOKEN_EXPIRE_MINUTES = int(_raw_expire)
except ValueError as exc:
    msg = f"ACCESS_TOKEN_EXPIRE_MINUTES must be an integer, got: {_raw_expire!r}"
    raise ValueError(msg) from exc


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verify a plain password against a hashed password.

    Args:
        plain_password: The plain text password
        hashed_password: The hashed password to verify against

    Returns:
        True if password matches, False otherwise
    """
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))


def get_password_hash(password: str) -> str:
    """
    Hash a password using bcrypt.

    Args:
        password: Plain text password to hash

    Returns:
        Hashed password
    """
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")


def hash_password_reset_token(token: str) -> str:
    """Return a stable SHA-256 digest for a high-entropy password reset token."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_access_token(
    subject: str, expires_delta: timedelta | None = None, token_version: int = 0
) -> str:
    """
    Create a JWT access token for the given subject (username).

    Args:
        subject: The identity to encode as the token subject ("sub" claim)
        expires_delta: Optional custom expiration time
        token_version: The user's current `token_version`, carried in the "tv"
            claim. Authentication compares it against the stored value and
            rejects the token when they differ, which is how a password change
            or reset evicts sessions that were minted before it.

    Returns:
        Encoded JWT token
    """
    now = datetime.now(UTC)
    expire = now + (
        expires_delta
        if expires_delta is not None
        else timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    payload = {"sub": subject, "exp": expire, "iat": now, "tv": token_version}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    """
    Decode and verify a JWT access token.

    Args:
        token: JWT token to decode

    Returns:
        Decoded token payload or None if invalid
    """
    try:
        return jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM],
            leeway=_JWT_CLOCK_SKEW_SECONDS,
        )
    except jwt.PyJWTError as exc:
        logger.debug("JWT decode failed with %s", type(exc).__name__)
        return None
