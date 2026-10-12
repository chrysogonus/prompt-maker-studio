"""Historical SQLite migration v022_oauth_tables."""

from __future__ import annotations

from sqlalchemy.schema import CreateIndex, CreateTable

from app.models.oauth import OAuthAuthorizationCode, OAuthClient, OAuthRefreshToken


def _migration_022_oauth_tables(connection) -> None:
    """Create the OAuth client, authorization-code, and refresh-token tables
    behind MCP account linking. The DDL is rendered from the models, as in
    migration 020, so it cannot drift from them."""
    for model in (OAuthClient, OAuthAuthorizationCode, OAuthRefreshToken):
        connection.execute(CreateTable(model.__table__, if_not_exists=True))
        for index in model.__table__.indexes:
            connection.execute(CreateIndex(index, if_not_exists=True))
