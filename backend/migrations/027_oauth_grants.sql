-- Historical reference only; the application runs v027_oauth_grants.py.
CREATE TABLE IF NOT EXISTS oauth_grants (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id VARCHAR(64) NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, client_id)
);
-- Add each column only when missing, as the Python migration does.
ALTER TABLE oauth_authorization_codes ADD COLUMN grant_version INTEGER NOT NULL DEFAULT -1;
ALTER TABLE oauth_authorization_codes ADD COLUMN token_version INTEGER NOT NULL DEFAULT -1;
ALTER TABLE oauth_refresh_tokens ADD COLUMN grant_version INTEGER NOT NULL DEFAULT -1;
DELETE FROM oauth_authorization_codes WHERE grant_version = -1;
DELETE FROM oauth_refresh_tokens WHERE grant_version = -1;
-- Old access tokens lack the grant-version claim and are rejected by the verifier.
-- Client registrations survive; existing OAuth connections must reauthorize.
