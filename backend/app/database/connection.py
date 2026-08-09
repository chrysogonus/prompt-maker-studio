"""
Database connection and session management.
Handles SQLite database setup and provides session factory.
"""

import os
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Use absolute path for SQLite database
backend_dir = Path(__file__).parent.parent.parent
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{backend_dir}/prompts.db")
_IS_SQLITE = DATABASE_URL.startswith("sqlite")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if _IS_SQLITE else {},
)


def apply_sqlite_pragmas(target_engine) -> None:
    """Register the per-connection PRAGMAs every SQLite engine in this project
    needs. Exposed so the test fixtures bind the same behaviour as production
    — the pragmas below are not defaults, and a test engine without them
    silently exercises different semantics from the running application.

    WAL mode lets readers and a writer proceed concurrently instead of blocking
    each other, and busy_timeout makes a writer wait for a lock instead of
    immediately raising "database is locked" — both matter once more than one
    request can hit SQLite at the same time.

    foreign_keys is off by default in SQLite and must be set per connection.
    Without it every ON DELETE clause in the schema is inert, so deleting a
    user left their Playground runs and billed calls behind as orphans while
    the API reported the account fully deleted.
    """

    @event.listens_for(target_engine, "connect")
    def _set_sqlite_pragmas(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


if _IS_SQLITE:
    apply_sqlite_pragmas(engine)


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """
    Dependency function to get database session.
    Yields a database session and ensures it's closed after use.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
