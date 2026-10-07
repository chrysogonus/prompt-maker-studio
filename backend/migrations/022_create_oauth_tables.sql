-- 022_oauth_tables: tables behind MCP OAuth account linking (dynamic client
-- registration, one-time authorization codes, rotating refresh tokens).
-- Reference only; applied by app/database/migrations.py, which renders the
-- same DDL from app/models/oauth.py.

CREATE TABLE IF NOT EXISTS oauth_clients (
	client_id VARCHAR(64) NOT NULL,
	client_info TEXT NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (client_id)
);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
	code_hash VARCHAR(64) NOT NULL,
	client_id VARCHAR(64) NOT NULL,
	user_id INTEGER NOT NULL,
	redirect_uri TEXT NOT NULL,
	redirect_uri_provided_explicitly BOOLEAN NOT NULL,
	code_challenge VARCHAR(128) NOT NULL,
	scopes JSON NOT NULL,
	resource TEXT,
	expires_at DATETIME NOT NULL,
	PRIMARY KEY (code_hash),
	FOREIGN KEY(client_id) REFERENCES oauth_clients (client_id) ON DELETE CASCADE,
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_oauth_authorization_codes_user_id ON oauth_authorization_codes (user_id);

CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
	token_hash VARCHAR(64) NOT NULL,
	client_id VARCHAR(64) NOT NULL,
	user_id INTEGER NOT NULL,
	scopes JSON NOT NULL,
	resource TEXT,
	token_version INTEGER NOT NULL,
	expires_at DATETIME NOT NULL,
	PRIMARY KEY (token_hash),
	FOREIGN KEY(client_id) REFERENCES oauth_clients (client_id) ON DELETE CASCADE,
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_oauth_refresh_tokens_user_id ON oauth_refresh_tokens (user_id);
