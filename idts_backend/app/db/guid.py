"""
Cross-dialect GUID column type.

Production runs on PostgreSQL (native UUID type, per design doc §41's
database choice). Locally in this sandbox — and in the automated test
suite — we use SQLite, which has no native UUID type. This TypeDecorator
lets the exact same model definitions work against both: PostgreSQL gets
a real UUID column, SQLite gets a CHAR(36) string that round-trips to a
Python uuid.UUID on the way out.

This is a well-established SQLAlchemy pattern (documented in SQLAlchemy's
own "backend agnostic GUID type" recipe) — not a custom invention — chosen
specifically so the test suite can run fast and offline in this sandbox
without requiring a live Postgres server, while production code paths are
unaffected.
"""

import uuid

from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.types import CHAR, TypeDecorator


class GUID(TypeDecorator):
    impl = CHAR
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PG_UUID(as_uuid=True))
        return dialect.type_descriptor(CHAR(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        if dialect.name == "postgresql":
            return str(value)
        if not isinstance(value, uuid.UUID):
            return str(uuid.UUID(value))
        return str(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return value
        if isinstance(value, uuid.UUID):
            return value
        return uuid.UUID(value)


def new_uuid() -> uuid.UUID:
    return uuid.uuid4()
