"""Product branding constants shared by user-facing backend surfaces.

Kept separate from settings so importing the product name never pulls in the
auth or database stack — `email_service` and `main` both need it at import time.
"""

APP_NAME = "Prompt Maker Studio"
"""Display name used in the OpenAPI title, health payload, and outbound email."""
