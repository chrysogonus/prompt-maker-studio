"""
Unit tests for services/secret_store.py — encryption at rest for the per-user
provider API keys.
"""

import pytest

from app.services.secret_store import (
    _LEGACY_HKDF_INFO,
    SecretDecryptionError,
    _fernet,
    decrypt_secret,
    encrypt_secret,
    mask_secret,
)


class TestRoundTrip:
    def test_encrypt_then_decrypt_returns_the_original(self):
        assert decrypt_secret(encrypt_secret("sk-super-secret-value")) == "sk-super-secret-value"

    def test_ciphertext_does_not_contain_the_plaintext(self):
        """The whole point: a stolen database file must not be a pile of keys."""
        secret = "sk-super-secret-value"
        assert secret not in encrypt_secret(secret)

    def test_encryption_is_non_deterministic(self):
        """Fernet includes a random IV, so identical keys don't produce
        identical ciphertext that could be correlated across users."""
        assert encrypt_secret("same-value") != encrypt_secret("same-value")

    def test_handles_unicode_and_whitespace(self):
        value = "  ключ-ünïcode-🔑  "
        assert decrypt_secret(encrypt_secret(value)) == value


class TestDecryptionFailures:
    def test_corrupt_ciphertext_raises_a_typed_error(self):
        with pytest.raises(SecretDecryptionError):
            decrypt_secret("this-is-not-a-fernet-token")

    def test_key_rotation_invalidates_existing_ciphertext(self, monkeypatch):
        """Rotating key material must surface as a re-enter-your-key error,
        not as a crash or a silently wrong credential."""
        from cryptography.fernet import Fernet

        monkeypatch.setenv("LLM_ENCRYPTION_KEY", Fernet.generate_key().decode())
        ciphertext = encrypt_secret("sk-value")

        monkeypatch.setenv("LLM_ENCRYPTION_KEY", Fernet.generate_key().decode())
        with pytest.raises(SecretDecryptionError):
            decrypt_secret(ciphertext)

    def test_invalid_configured_key_fails_loudly(self, monkeypatch):
        monkeypatch.setenv("LLM_ENCRYPTION_KEY", "not-a-valid-fernet-key")
        with pytest.raises(RuntimeError, match="LLM_ENCRYPTION_KEY"):
            encrypt_secret("sk-value")


class TestPreRenameCiphertext:
    """The "Prompt Maker Studio" rename changed the HKDF info string. Keys
    stored before it must keep working on derived-key deployments."""

    @staticmethod
    def _encrypt_as_legacy(plaintext: str) -> str:
        return _fernet(_LEGACY_HKDF_INFO).encrypt(plaintext.encode("utf-8")).decode("utf-8")

    def test_legacy_ciphertext_still_decrypts(self, monkeypatch):
        monkeypatch.delenv("LLM_ENCRYPTION_KEY", raising=False)
        assert decrypt_secret(self._encrypt_as_legacy("sk-old-value")) == "sk-old-value"

    def test_current_ciphertext_still_decrypts(self, monkeypatch):
        """The fallback must not regress the normal path."""
        monkeypatch.delenv("LLM_ENCRYPTION_KEY", raising=False)
        assert decrypt_secret(encrypt_secret("sk-new-value")) == "sk-new-value"

    def test_writes_upgrade_to_the_current_derivation(self, monkeypatch):
        monkeypatch.delenv("LLM_ENCRYPTION_KEY", raising=False)
        rewritten = encrypt_secret(decrypt_secret(self._encrypt_as_legacy("sk-old-value")))
        # Decodable without the fallback => stored under the current info.
        assert _fernet().decrypt(rewritten.encode("utf-8")).decode("utf-8") == "sk-old-value"

    def test_garbage_still_raises_with_the_fallback_in_place(self, monkeypatch):
        monkeypatch.delenv("LLM_ENCRYPTION_KEY", raising=False)
        with pytest.raises(SecretDecryptionError):
            decrypt_secret("this-is-not-a-fernet-token")

    def test_explicit_key_deployments_skip_the_fallback(self, monkeypatch):
        """An explicit key is used verbatim, so a legacy-derived token is not
        a pre-rename credential — it must still fail."""
        from cryptography.fernet import Fernet

        monkeypatch.delenv("LLM_ENCRYPTION_KEY", raising=False)
        legacy = self._encrypt_as_legacy("sk-old-value")

        monkeypatch.setenv("LLM_ENCRYPTION_KEY", Fernet.generate_key().decode())
        with pytest.raises(SecretDecryptionError):
            decrypt_secret(legacy)


class TestMasking:
    def test_hint_keeps_only_a_short_fragment(self):
        hint = mask_secret("sk-proj-abcdefghijklmnop4f2a")
        assert hint == "sk-…4f2a"
        assert "abcdefghijklmnop" not in hint

    def test_short_secrets_are_masked_entirely(self):
        assert mask_secret("short") == "••••"
