-- Historical reference only; the application runs v026_user_auth_subject.py.
-- Add only when missing, then bind a fresh Python uuid4() string for each row
-- whose auth_subject is NULL. Do not use usernames or reusable numeric IDs.
ALTER TABLE users ADD COLUMN auth_subject VARCHAR(36);
UPDATE users SET auth_subject = :generated_uuid_v4 WHERE id = :user_id;
CREATE UNIQUE INDEX IF NOT EXISTS ix_users_auth_subject ON users (auth_subject);
-- Fresh databases declare auth_subject NOT NULL through the SQLAlchemy model;
-- SQLite cannot add that constraint to populated tables without a rebuild.
-- Old username-subject session and MCP access tokens require reauthentication.
