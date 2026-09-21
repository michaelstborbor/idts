"""
Schema-sync safety net.

Base.metadata.create_all() (used in app/main.py's startup lifespan) only
creates tables that don't exist yet — it never alters a table that already
exists to add a column that was added to the model afterward. This is
exactly what happened in production: `children.address` and
`schedule_entries.dosage/route/site` were added to the models, but the
live database (provisioned by an earlier deploy, before those columns
existed) never got them, and every request touching those tables failed
with `psycopg2.errors.UndefinedColumn`.

This function is a deliberate, narrow stop-gap: for every mapped table
that already exists in the database, it compares the model's columns
against what's actually there and issues an idempotent
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for anything missing. New
columns are always added as NULLable, regardless of what the model
declares — a NOT NULL column with no default cannot be safely added to a
table that may already have rows, and deciding how to backfill a new
NOT NULL column for existing data is a real decision that shouldn't
happen silently on startup.

This is NOT a substitute for real migrations (Alembic): it can only add
columns, never rename or retype one, drop one, or handle anything more
than that. It exists so that "the app just works after a redeploy"
(the whole point of auto-provisioning on startup — see main.py) stays
true as the schema grows, without requiring Alembic to be stood up
before this pilot can keep moving. Real migrations remain the documented
next step once the data actually matters enough that even nullable
additive changes need a controlled rollout (see backend README "Not yet
built").

Postgres-only: SQLite's ALTER TABLE support is limited (no easy "add
column if not exists" without raw pragma inspection), and the automated
test suite always starts from a freshly created, fully-formed schema
anyway, so there is never a drift to sync against there.
"""

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from app.db.base import Base


def sync_missing_columns(engine: Engine) -> list[str]:
    if engine.dialect.name != "postgresql":
        return []

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    added: list[str] = []

    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue  # brand-new table — create_all() handles this fully
            existing_columns = {col["name"] for col in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing_columns:
                    continue
                col_type = column.type.compile(dialect=engine.dialect)
                stmt = f'ALTER TABLE "{table.name}" ADD COLUMN IF NOT EXISTS "{column.name}" {col_type}'
                conn.execute(text(stmt))
                label = f"{table.name}.{column.name}"
                added.append(label)
                print(f"[schema-sync] Added missing column: {label} ({col_type})")

    return added
