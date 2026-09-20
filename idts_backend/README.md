# IDTS Backend — Milestones 6–8: working, tested, deployable API

This is a real, running FastAPI backend — booted with a live server and
exercised over actual HTTP requests, not just Python function calls.
**44/44 tests pass** (14 domain-layer unit tests + 30 end-to-end
integration tests).

## What's actually working right now

- **Official Ministry schedule**: the immunization schedule's antigens,
  ages, dosage, route, and site of administration are now sourced from
  the actual Ministry of Health & Sanitation vaccination schedule chart
  (27 entries — BCG, OPV, Pentavalent, PCV, Rota, IPTi, IPV, Yellow
  Fever, Measles-Rubella, Malaria vaccine, Vitamin A/Albendazole), not a
  placeholder. Minimum intervals between doses are *derived* from the
  age columns (documented explicitly in `seed.py`, not independently
  Ministry-stated). The due/overdue/defaulter day-thresholds are still
  placeholders — see `IDTS_Schedule_Verification_Request.docx`.
- **Address field** on child registration and profile.
- **Edit and soft-delete** for child records (`PATCH`/`DELETE
  /api/v1/children/{id}`) — delete keeps the row and its full history for
  audit purposes rather than permanently erasing it; see the
  `delete_child` docstring for why that's the deliberate choice.
- **Dashboard aggregate endpoint** (`GET /api/v1/dashboard`): registered,
  fully-immunized-for-age, needing-attention, doses given, and case
  status counts — computed server-side, not by the frontend fetching
  every child individually.
- **Vaccination summary report** (`GET /api/v1/reports/vaccinations-summary`):
  doses given, grouped by antigen and delivery session type (fixed /
  outreach / mobile / community), over an optional date range.
- **Full admin user management**: `system_admin` can create a user with
  any role and an explicit password (`POST /api/v1/users`), and
  activate/deactivate accounts (`PATCH /api/v1/users/{id}`) — an admin
  cannot deactivate their own account through this endpoint (lockout
  guard).
- **Self-service account settings**: any logged-in user can update their
  own display name and change their own password
  (`PATCH /api/v1/users/me`, `POST /api/v1/users/me/change-password`).
- **Auth**: login issues a JWT; every route is protected; roles are
  enforced server-side (a CHW cannot close a case — tested).
- **Child registration**: with basic duplicate detection (name + DOB
  window), future-DOB rejection, auto-generated system IDs.
- **The tested schedule/defaulter engines are wired in for real**: register
  a child, ask for their profile, and you get back a fully evaluated
  schedule (not-yet-due / due-soon / due / overdue / defaulter /
  administered) computed from a real, database-stored, versioned schedule
  — nothing about the antigens/intervals is hard-coded in Python anymore,
  it's configurable via the `schedule_entries` table.
- **Vaccination recording** with idempotency-key handling: resubmitting
  the exact same transaction (simulating a retried offline sync) returns
  the existing record instead of creating a duplicate — tested directly.
- **Due list**: flattened, filterable, with transparent priority scoring
  on defaulters (same weighted-factor approach as the standalone frontend
  and the domain engine — no black box).
- **Full defaulter workflow**: assign → trace → auto-flag "return pending
  confirmation" on vaccination → controlled closure with a reason, with
  full tracing-attempt history returned alongside each case. Tested as one
  continuous flow, the same way a health worker would actually use it
  (mirrors design doc §52 Scenarios C–E).
- **Real geography and facility data**: 108 actual health facilities
  across 14 real chiefdoms in Kono District, sourced from a Ministry of
  Health HMIS/CHIS training roster provided directly by the user. The
  immunization *schedule* itself remains a synthetic, unverified
  placeholder — real facility names do not imply a verified clinical
  schedule; those are two separate open items.
- **"Add new CHW" on the fly** (`POST /api/v1/users/chw`): since no CHW
  roster exists yet for Kono District, a Facility In-Charge (or
  supervisor/admin) can add a new CHW by name at the point of assigning a
  defaulter case. Tested: duplicate names get distinct auto-generated
  usernames, only facility-management roles can do this, and no password
  hash is ever exposed.
- **Auto-provisioning on startup**: the app creates any missing database
  tables and seeds demo data automatically if the database is empty — no
  manual `python -m app.seed` step required after a real deploy. Verified
  by starting the server against a completely fresh, untouched database
  and confirming it seeds and serves logins with zero manual intervention.
  Controlled by the `IDTS_AUTO_SEED` env var (default `true`).
- **Standalone frontend exists and is verified against this API** — see
  `../idts_frontend` and its README. Not a Claude artifact anymore; a real
  Vite/React app driven end-to-end by an actual headless-browser test
  against this actual backend.
- **Deployable today** — see `../DEPLOYMENT.md` and `../render.yaml` at
  the outputs root for the full hosting walkthrough (Milestone 8).

## Running it yourself

```bash
pip install -r requirements.txt
cp .env.example .env   # then edit — at minimum set IDTS_SECRET_KEY

# Run the tests:
PYTHONPATH=. pytest tests/ -v

# Run the server (auto-creates tables + seeds demo data on first startup):
PYTHONPATH=. uvicorn app.main:app --reload
# Then open http://127.0.0.1:8000/docs for interactive API docs
```

Seeded login (local dev only — **change this password before any real
deployment**): username `admin` or `focal`, password `dev-only-change-me`.
No CHW users are seeded — add one through the frontend's "Add new CHW"
input, or `POST /api/v1/users/chw` directly.

You can also still run `PYTHONPATH=. python3 -m app.seed` manually if you
want to seed without starting the server (e.g. for inspecting the DB
directly) — it's idempotent and safe to run more than once.

## Deliberate scope decisions (so nothing here is accidental)

- **Caregiver info is inline on the Child record**, not a separate table.
  The full ERD (design doc §28) calls for a proper Caregiver entity
  supporting multiple caregivers per child — that's real, deferred scope,
  not an oversight, matching the frontend's simpler model.
- **Schedule versioning exists in the data model** (an `ImmunizationSchedule`
  can have historical versions) but the "pick the version active on a given
  historical date" logic isn't implemented yet — only "use the current
  active schedule" is. Flagged in code (`schedule_service.py`) rather than
  silently assumed.
- **No offline sync layer yet.** The idempotency-key mechanism vaccination
  recording uses is the building block for it, and it's tested, but the
  actual client-side queue / conflict-resolution logic from the design
  doc's §9 isn't built.
- **Geographic risk area flag** (`is_high_risk_area` in the risk scorer)
  is hard-wired to `False` — no geographic risk classification has been
  configured. Flagged explicitly in `schedule_service.py`, not silently
  guessed at.
- **CHWs have no login of their own yet** — "Add new CHW" creates a real
  user record with a system-generated placeholder password nobody has.
  Tracing attempts are currently recorded by whoever's logged in (the
  Facility In-Charge), on the CHW's behalf.
- **`Base.metadata.create_all()` instead of real migrations** — fine for
  getting a fresh database (including a freshly hosted one) up and running
  automatically, but it is not how you safely evolve a schema that already
  has real data in it. Alembic is the documented next step for that.

## Not yet built

- Alembic migrations
- Offline sync queue on the client side
- Data-quality module, transfers, reporting exports, DHIS2/FHIR
  integration — all explicitly Phase 2/3 per the original design doc,
  not needed for a first real pilot
- Testing on a real Android device over a real network (Milestone 9)

## Before any real child's data goes anywhere near this

See `IDTS-design-package.md` §14 and the conversation this was built in:
the immunization schedule needs verification against the actual Sierra
Leone Ministry of Health & Sanitation CH/EPI schedule, and a
data-protection/consent review needs to happen, before this is authorized
for real patient data — not just a code-readiness question. Real facility
data does not change this requirement.
