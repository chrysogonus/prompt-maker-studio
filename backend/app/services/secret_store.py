"""
Symmetric encryption for per-user provider API keys at rest.

Users bring their own LLM credentials, so the database now holds third-party
secrets. Those are stored Fernet-encrypted (AES-128-CBC + HMAC, from the
already-vendored `cryptography` package) rather than in the clear, so a stolen
database file or backup is not immediately a pile of usable API keys.

Key material comes from `LLM_ENCRYPTION_KEY` when set, otherwise it is derived
from `SECRET_KEY` via HKDF. The derivation exists so an existing deployment
gains encryption without a new mandatory env var; the dedicated variable exists
so an operator can rotate JWT signing independently of stored credentials.
Rotating whichever key is in use makes existing ciphertexts undecryptable —
that surfaces as `SecretDecryptionError` and is reported to the user as
"re-enter your API key", never as a 500.

The HKDF `info` string carries the product slug, which changed when the product
was renamed to "Prompt Maker Studio". Derived-key deployments would otherwise
have lost every stored credential at deploy time, so decryption falls back to
the pre-rename derivation and any subsequent write re-encrypts under the
current one. The fallback can be deleted once no ciphertext predates the
rename.
"""

from __future__ import annotations

import base64
import os

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

_HKDF_INFO = b"prompt-maker-studio:llm-api-key:v1"
_LEGACY_HKDF_INFO = b"prompt-maker:llm-api-key:v1"


class SecretDecryptionError(Exception):
    """Stored ciphertext could not be decrypted with the current key material."""


def _fernet(info: bytes = _HKDF_INFO) -> Fernet:
    """Build the Fernet instance for the current process configuration.

    Not cached: tests and operators change the environment between calls, and
    key derivation is cheap next to the network call that follows it.

    `info` selects the HKDF derivation and is only meaningful when
    `LLM_ENCRYPTION_KEY` is unset — an explicit key is used verbatim.
    """
    explicit = os.getenv("LLM_ENCRYPTION_KEY", "").strip()
    if explicit:
        try:
            return Fernet(explicit.encode("utf-8"))
        except (ValueError, TypeError) as exc:
            msg = (
                "LLM_ENCRYPTION_KEY is not a valid Fernet key. "
                "Generate one with: python -c "
                "'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
            )
            raise RuntimeError(msg) from exc

    # Imported lazily so this module stays importable without the auth stack.
    from app.auth.utils import SECRET_KEY

    derived = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=info,
    ).derive(SECRET_KEY.encode("utf-8"))
    return Fernet(base64.urlsafe_b64encode(derived))


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a credential for storage. Returns URL-safe base64 ciphertext."""
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_secret(ciphertext: str) -> str:
    """
    Decrypt a stored credential.

    Ciphertext written before the "Prompt Maker Studio" rename was derived with
    a different HKDF `info`, so a failure on the current derivation is retried
    against the legacy one before giving up.

    Raises:
        SecretDecryptionError: If the ciphertext is corrupt or was written
            under different key material (e.g. SECRET_KEY was rotated).
    """
    token = ciphertext.encode("utf-8")
    try:
        return _fernet().decrypt(token).decode("utf-8")
    except (InvalidToken, ValueError) as exc:
        # An explicit LLM_ENCRYPTION_KEY is used verbatim, so the legacy HKDF
        # derivation never produced those ciphertexts — nothing to retry.
        if not os.getenv("LLM_ENCRYPTION_KEY", "").strip():
            try:
                return _fernet(_LEGACY_HKDF_INFO).decrypt(token).decode("utf-8")
            except (InvalidToken, ValueError):
                pass
        msg = "Stored API key could not be decrypted"
        raise SecretDecryptionError(msg) from exc


_MIN_HINT_LENGTH = 12


def mask_secret(plaintext: str) -> str:
    """
    A display-only hint that a key is present, e.g. "sk-…4f2a".

    Never reversible and never enough to use: at most the last four characters
    survive, and short keys are masked entirely.
    """
    if len(plaintext) < _MIN_HINT_LENGTH:
        return "••••"
    return f"{plaintext[:3]}…{plaintext[-4:]}"
