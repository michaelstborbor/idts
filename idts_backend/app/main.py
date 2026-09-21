import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import auth, children, dashboard, defaulters, facilities, reports, users, vaccinations
from app.db.base import Base
from app.db.schema_sync import sync_missing_columns
from app.db.session import engine
import app.models  # noqa: F401 — registers all models before create_all


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Auto-provisions the schema and seeds demo data on first startup if the
    database is empty. This exists specifically so a fresh hosted deployment
    (Milestone 8) doesn't depend on someone manually SSHing in and running
    `python -m app.seed` — a step that's easy to miss or get wrong right
    after standing up a new hosting account for the first time.

    Runs in three steps, in this order:
    1. sync_missing_columns() — patches any EXISTING tables that are
       missing columns the current models now expect (see that function's
       docstring — this is what fixes the real "column children.address
       does not exist" production error, and prevents the same class of
       error on future schema changes too).
    2. Base.metadata.create_all() — creates any tables that don't exist
       at all yet. A no-op for tables that already exist.
    3. app.seed.seed() — seeds demo data, but only if the database has no
       users yet (see app/seed.py) — never duplicates or overwrites data
       that's already there.

    NOTE: this combination (step 1 + step 2) handles additive schema
    changes (new tables, new nullable columns) safely and automatically.
    It is still not a substitute for real migrations (Alembic) once a
    change is more than additive — flagged in the backend README.
    """
    added_columns = sync_missing_columns(engine)
    if added_columns:
        print(f"[startup] Schema sync added {len(added_columns)} column(s): {', '.join(added_columns)}")
    Base.metadata.create_all(bind=engine)
    if os.environ.get("IDTS_AUTO_SEED", "true").lower() in ("1", "true", "yes"):
        from app.seed import seed
        seed()
    yield


app = FastAPI(
    title="IDTS API",
    version="0.1.0",
    description=(
        "Immunization and Defaulter Tracking System — MVP backend. "
        "See IDTS-design-package.md for full architecture/ERD/roadmap. "
        "Synthetic data only; not authorized for real patient data pending "
        "programme/clinical/security/data-protection review."
    ),
    lifespan=lifespan,
)

# CORS: the frontend is a separate app/origin (different port in dev, a
# different domain once hosted), so the browser needs explicit permission
# to call this API. Origins are read from the environment, never hard-coded
# (§3.5/§58) — comma-separated list, e.g. "http://localhost:5173,https://idts.example.org".
_origins_env = os.environ.get("IDTS_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _origins_env.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(children.router)
app.include_router(vaccinations.router)
app.include_router(defaulters.router)
app.include_router(facilities.router)
app.include_router(users.router)
app.include_router(dashboard.router)
app.include_router(reports.router)


@app.get("/health")
def health_check():
    return {"status": "ok"}
