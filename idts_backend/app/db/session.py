"""
Engine + session factory.

DATABASE_URL is read from the environment so the exact same code runs
against SQLite here in the sandbox / test suite and against PostgreSQL in
production (design doc §41) — nothing about the connection target is
hard-coded, per the master spec's repeated instruction not to hard-code
configuration (§3.5, §58).
"""

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./idts_dev.db")

# Real-world gotcha: several managed Postgres providers (Render among them)
# hand out connection strings starting with "postgres://", a legacy scheme
# alias that modern SQLAlchemy (2.x) no longer accepts — it requires the
# full "postgresql://" scheme. Rewriting here means whoever configures
# DATABASE_URL doesn't need to know about this quirk or edit the string
# the platform gave them.
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
