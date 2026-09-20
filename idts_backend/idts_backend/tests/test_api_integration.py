"""
Integration tests — exercise the real FastAPI app + SQLAlchemy models
end-to-end (register -> vaccinate -> due/defaulter -> assign -> trace ->
close), per design doc §46's "integration tests: database, APIs,
authentication" and §57's acceptance-criteria workflow.

Uses an isolated in-memory SQLite DB per test session (not the dev file
DB) so tests never depend on or mutate idts_dev.db.
"""

import os
import uuid
from datetime import date, timedelta

import pytest

os.environ.setdefault("IDTS_AUTO_SEED", "false")  # tests seed their own isolated DB explicitly (see `seeded` fixture below); the app's lifespan auto-seed is for real deployments only and must not also fire against a stray default DB file during test runs

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.security import hash_password
from app.db.base import Base
from app.db.session import get_db
import app.models  # noqa: F401
from app.main import app
from app.models.child import ImmunizationSchedule, ScheduleEntry
from app.models.user import Facility, User

TEST_ENGINE = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=TEST_ENGINE)


def override_get_db():
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(scope="function", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=TEST_ENGINE)
    yield
    Base.metadata.drop_all(bind=TEST_ENGINE)


@pytest.fixture()
def client():
    return TestClient(app)


@pytest.fixture()
def seeded(client):
    """Seeds one facility, one short schedule (BCG + 3-dose Penta), and two users."""
    db = TestSessionLocal()
    facility = Facility(id=uuid.uuid4(), name="Test Facility", facility_type="chc")
    focal = User(
        id=uuid.uuid4(), full_name="Focal Person", username="focal",
        hashed_password=hash_password("testpass123"), role="facility_focal_person",
        facility_id=facility.id,
    )
    chw = User(
        id=uuid.uuid4(), full_name="CHW", username="chw1",
        hashed_password=hash_password("testpass123"), role="chw", facility_id=facility.id,
    )
    db.add_all([facility, focal, chw])
    db.flush()

    schedule = ImmunizationSchedule(id=uuid.uuid4(), name="Test schedule", is_active=True)
    db.add(schedule)
    db.flush()

    bcg1 = ScheduleEntry(
        id=uuid.uuid4(), schedule_id=schedule.id, antigen="BCG", dose_number=1,
        recommended_age_days=0, minimum_age_days=0, due_soon_window_days=3,
        overdue_window_days=11, defaulter_threshold_days=30, display_order=1,
    )
    penta1 = ScheduleEntry(
        id=uuid.uuid4(), schedule_id=schedule.id, antigen="Pentavalent", dose_number=1,
        recommended_age_days=42, minimum_age_days=42, due_soon_window_days=7,
        overdue_window_days=14, defaulter_threshold_days=30, display_order=2,
    )
    db.add_all([bcg1, penta1])
    db.commit()

    result = {
        "facility_id": str(facility.id),
        "bcg1_id": str(bcg1.id),
        "penta1_id": str(penta1.id),
        "chw_id": str(chw.id),
    }
    db.close()
    return result


def auth_headers(client, username="focal", password="testpass123"):
    resp = client.post("/api/v1/auth/login", data={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_login_rejects_wrong_password(client, seeded):
    resp = client.post("/api/v1/auth/login", data={"username": "focal", "password": "wrong"})
    assert resp.status_code == 401


def test_register_child_and_fetch_evaluated_schedule(client, seeded):
    headers = auth_headers(client)
    dob = (date.today() - timedelta(days=100)).isoformat()

    resp = client.post(
        "/api/v1/children",
        json={"full_name": "Test Child", "sex": "F", "dob": dob, "facility_id": seeded["facility_id"]},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    child = resp.json()
    assert child["system_id"].startswith("IDTS-")

    detail = client.get(f"/api/v1/children/{child['id']}", headers=headers)
    assert detail.status_code == 200
    schedule = detail.json()["schedule"]
    statuses = {row["antigen"]: row["status"] for row in schedule}
    # Child is 100 days old: BCG (due at birth, threshold 30d overdue) should
    # be a defaulter; Pentavalent dose 1 (due at 42 days, 58 days overdue > 30d
    # threshold) should also be a defaulter.
    assert statuses["BCG"] == "defaulter"
    assert statuses["Pentavalent"] == "defaulter"


def test_registration_rejects_future_dob(client, seeded):
    headers = auth_headers(client)
    future_dob = (date.today() + timedelta(days=5)).isoformat()
    resp = client.post(
        "/api/v1/children",
        json={"full_name": "Future Child", "sex": "M", "dob": future_dob, "facility_id": seeded["facility_id"]},
        headers=headers,
    )
    assert resp.status_code == 400


def test_vaccination_recording_updates_status_and_is_idempotent(client, seeded):
    headers = auth_headers(client)
    dob = (date.today() - timedelta(days=10)).isoformat()
    child = client.post(
        "/api/v1/children",
        json={"full_name": "Newborn", "sex": "M", "dob": dob, "facility_id": seeded["facility_id"]},
        headers=headers,
    ).json()

    idem_key = "test-idem-key-001"
    vacc_payload = {
        "schedule_entry_id": seeded["bcg1_id"],
        "event_date": date.today().isoformat(),
        "facility_id": seeded["facility_id"],
        "session_type": "fixed",
        "idempotency_key": idem_key,
    }
    resp1 = client.post(f"/api/v1/children/{child['id']}/vaccinations", json=vacc_payload, headers=headers)
    assert resp1.status_code == 201, resp1.text
    first_id = resp1.json()["id"]

    # Resubmit the exact same transaction (simulating a retried offline sync) —
    # must return the SAME record, not create a duplicate (design doc §29/§45).
    resp2 = client.post(f"/api/v1/children/{child['id']}/vaccinations", json=vacc_payload, headers=headers)
    assert resp2.status_code == 201
    assert resp2.json()["id"] == first_id

    history = client.get(f"/api/v1/children/{child['id']}/vaccinations", headers=headers)
    assert len(history.json()) == 1, "Idempotent resubmission must not create a duplicate vaccination event."

    detail = client.get(f"/api/v1/children/{child['id']}", headers=headers)
    bcg_status = next(row for row in detail.json()["schedule"] if row["antigen"] == "BCG")["status"]
    assert bcg_status == "administered"


def test_vaccination_rejects_future_date(client, seeded):
    headers = auth_headers(client)
    dob = (date.today() - timedelta(days=10)).isoformat()
    child = client.post(
        "/api/v1/children",
        json={"full_name": "Test", "sex": "F", "dob": dob, "facility_id": seeded["facility_id"]},
        headers=headers,
    ).json()
    resp = client.post(
        f"/api/v1/children/{child['id']}/vaccinations",
        json={
            "schedule_entry_id": seeded["bcg1_id"],
            "event_date": (date.today() + timedelta(days=1)).isoformat(),
            "facility_id": seeded["facility_id"],
        },
        headers=headers,
    )
    assert resp.status_code == 400


def test_full_defaulter_workflow_assign_trace_and_close(client, seeded):
    """
    End-to-end: register a defaulter-aged child -> appears on due-list as
    defaulter -> assign case -> record a tracing attempt -> vaccinate ->
    case auto-flags return_pending_confirmation -> close with reason.
    Mirrors the design doc's Scenario C-E (§52) and acceptance criteria (§57).
    """
    headers = auth_headers(client)
    dob = (date.today() - timedelta(days=100)).isoformat()  # BCG will be a defaulter
    child = client.post(
        "/api/v1/children",
        json={"full_name": "Defaulter Child", "sex": "F", "dob": dob, "facility_id": seeded["facility_id"]},
        headers=headers,
    ).json()

    due_list = client.get("/api/v1/due-list", headers=headers).json()
    defaulter_row = next(
        r for r in due_list if r["child"]["id"] == child["id"] and r["dose"]["antigen"] == "BCG"
    )
    assert defaulter_row["dose"]["status"] == "defaulter"
    assert defaulter_row["priority"] in ("low", "medium", "high")

    assign_resp = client.post(
        "/api/v1/defaulters/assign",
        json={"child_id": child["id"], "schedule_entry_id": seeded["bcg1_id"], "assigned_to_id": seeded["chw_id"]},
        headers=headers,
    )
    assert assign_resp.status_code == 201, assign_resp.text
    case = assign_resp.json()
    assert case["status"] == "assigned"

    # Duplicate assignment on the same dose should be rejected
    dup = client.post(
        "/api/v1/defaulters/assign",
        json={"child_id": child["id"], "schedule_entry_id": seeded["bcg1_id"], "assigned_to_id": seeded["chw_id"]},
        headers=headers,
    )
    assert dup.status_code == 409

    trace_resp = client.post(
        f"/api/v1/defaulters/{case['id']}/trace",
        json={"method": "home_visit", "outcome": "scheduled_to_return", "notes": "Caregiver will bring child Friday."},
        headers=headers,
    )
    assert trace_resp.status_code == 201, trace_resp.text

    case_after_trace = client.get("/api/v1/defaulters", headers=headers).json()
    this_case = next(c for c in case_after_trace if c["id"] == case["id"])
    assert this_case["status"] == "in_tracing"
    assert len(this_case["tracing_attempts"]) == 1, "Case response must include tracing attempt history."
    assert this_case["tracing_attempts"][0]["outcome"] == "scheduled_to_return"

    # Child returns and is vaccinated
    vacc_resp = client.post(
        f"/api/v1/children/{child['id']}/vaccinations",
        json={
            "schedule_entry_id": seeded["bcg1_id"],
            "event_date": date.today().isoformat(),
            "facility_id": seeded["facility_id"],
        },
        headers=headers,
    )
    assert vacc_resp.status_code == 201

    cases_after_vacc = client.get("/api/v1/defaulters", headers=headers).json()
    this_case = next(c for c in cases_after_vacc if c["id"] == case["id"])
    assert this_case["status"] == "return_pending_confirmation", (
        "Vaccination must flag the case for confirmation, not close it automatically "
        "(design doc §16 controlled-closure requirement)."
    )

    close_resp = client.post(
        f"/api/v1/defaulters/{case['id']}/close",
        json={"closure_reason": "vaccinated_returned"},
        headers=headers,
    )
    assert close_resp.status_code == 200, close_resp.text
    closed_case = close_resp.json()
    assert closed_case["status"] == "closed"
    assert closed_case["closure_reason"] == "vaccinated_returned"

    # Closed cases should no longer show up in the default (open-only) list
    open_cases = client.get("/api/v1/defaulters", headers=headers).json()
    assert all(c["id"] != case["id"] for c in open_cases)


def test_chw_cannot_close_a_case(client, seeded):
    """
    Role enforcement (design doc §4/§31): a CHW can trace but cannot
    unilaterally close a case — that requires focal-person-or-above.
    """
    headers_focal = auth_headers(client)
    dob = (date.today() - timedelta(days=100)).isoformat()
    child = client.post(
        "/api/v1/children",
        json={"full_name": "Role Test Child", "sex": "M", "dob": dob, "facility_id": seeded["facility_id"]},
        headers=headers_focal,
    ).json()
    case = client.post(
        "/api/v1/defaulters/assign",
        json={"child_id": child["id"], "schedule_entry_id": seeded["bcg1_id"], "assigned_to_id": seeded["chw_id"]},
        headers=headers_focal,
    ).json()

    headers_chw = auth_headers(client, username="chw1", password="testpass123")
    resp = client.post(
        f"/api/v1/defaulters/{case['id']}/close",
        json={"closure_reason": "vaccinated_returned"},
        headers=headers_chw,
    )
    assert resp.status_code == 403


def test_duplicate_detection_finds_same_name_and_dob(client, seeded):
    headers = auth_headers(client)
    dob = (date.today() - timedelta(days=50)).isoformat()
    client.post(
        "/api/v1/children",
        json={"full_name": "Fatmata Kamara", "sex": "F", "dob": dob, "facility_id": seeded["facility_id"]},
        headers=headers,
    )
    resp = client.get(
        "/api/v1/children/duplicates",
        params={"full_name": "Fatmata Kamara", "dob": dob},
        headers=headers,
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_list_facilities(client, seeded):
    headers = auth_headers(client)
    resp = client.get("/api/v1/facilities", headers=headers)
    assert resp.status_code == 200
    names = [f["name"] for f in resp.json()]
    assert "Test Facility" in names


def test_list_users_filtered_by_role_excludes_password_fields(client, seeded):
    headers = auth_headers(client)
    resp = client.get("/api/v1/users", params={"role": "chw"}, headers=headers)
    assert resp.status_code == 200
    users = resp.json()
    assert len(users) == 1
    assert users[0]["role"] == "chw"
    assert "hashed_password" not in users[0]


def test_get_me_returns_current_user(client, seeded):
    headers = auth_headers(client)
    resp = client.get("/api/v1/users/me", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["username"] == "focal"


def test_facility_focal_can_add_new_chw_on_the_fly(client, seeded):
    """
    No CHW roster exists yet for a real deployment — a Facility In-Charge
    must be able to add a new CHW inline rather than picking from a
    pre-populated list. Covers the "Add new CHW" placeholder feature.
    """
    headers = auth_headers(client)
    resp = client.post(
        "/api/v1/users/chw",
        json={"full_name": "Aminata Sesay", "facility_id": seeded["facility_id"]},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    chw = resp.json()
    assert chw["full_name"] == "Aminata Sesay"
    assert chw["role"] == "chw"
    assert "hashed_password" not in chw
    assert chw["username"]  # auto-generated, non-empty

    # The new CHW should now be assignable — appears in the role-filtered list
    chw_list = client.get("/api/v1/users", params={"role": "chw"}, headers=headers).json()
    assert any(u["id"] == chw["id"] for u in chw_list)


def test_two_chws_with_same_name_get_distinct_usernames(client, seeded):
    headers = auth_headers(client)
    resp1 = client.post("/api/v1/users/chw", json={"full_name": "Mohamed Kamara"}, headers=headers)
    resp2 = client.post("/api/v1/users/chw", json={"full_name": "Mohamed Kamara"}, headers=headers)
    assert resp1.json()["username"] != resp2.json()["username"]


def test_chw_cannot_add_another_chw(client, seeded):
    """Only facility-management roles (not CHWs themselves) can add CHWs."""
    client.post(
        "/api/v1/users/chw",
        json={"full_name": "Seed CHW"},
        headers=auth_headers(client),
    )
    headers_chw = auth_headers(client, username="chw1", password="testpass123")
    resp = client.post("/api/v1/users/chw", json={"full_name": "Another CHW"}, headers=headers_chw)
    assert resp.status_code == 403


# ============================================================
# Ministry schedule, address, edit/delete — added for the
# real MoHS schedule + registration/edit/delete feature request
# ============================================================

@pytest.fixture()
def seeded_with_real_schedule(client):
    """Runs the actual seed() against the test DB (not the default one) to
    verify the real 27-entry Ministry schedule behaves correctly
    end-to-end, not just the minimal fixture schedule used by other tests."""
    from app.seed import seed as run_seed
    db = TestSessionLocal()
    try:
        run_seed(db=db)
    finally:
        db.close()
    db2 = TestSessionLocal()
    facility = db2.query(Facility).first()
    result = {"facility_id": str(facility.id)}
    db2.close()
    return result


def test_real_schedule_seeds_27_entries_matching_ministry_chart(client, seeded_with_real_schedule):
    headers = auth_headers(client, username="admin", password="dev-only-change-me")
    dob = date.today().isoformat()
    child = client.post(
        "/api/v1/children",
        json={"full_name": "Newborn Schedule Check", "sex": "F", "dob": dob, "facility_id": seeded_with_real_schedule["facility_id"]},
        headers=headers,
    ).json()
    detail = client.get(f"/api/v1/children/{child['id']}", headers=headers).json()
    assert len(detail["schedule"]) == 27

    bcg = next(d for d in detail["schedule"] if d["antigen"] == "BCG")
    assert bcg["dosage"] == "0.05 mls"
    assert bcg["route"] == "Intradermal"
    assert bcg["site"] == "Right Upper arm"

    malaria4 = next(d for d in detail["schedule"] if d["antigen"] == "Malaria vaccine" and d["dose_number"] == 4)
    assert malaria4["status"] == "not_yet_due"  # newborn, dose due at 450 days


def test_real_schedule_penta_interval_derived_correctly(client, seeded_with_real_schedule):
    """A child whose Penta1 was given LATE should have Penta2's eligible
    date pushed out by the derived 28-day interval, not just by age."""
    headers = auth_headers(client, username="admin", password="dev-only-change-me")
    dob = (date.today() - timedelta(days=100)).isoformat()
    child = client.post(
        "/api/v1/children",
        json={"full_name": "Late Penta1 Child", "sex": "M", "dob": dob, "facility_id": seeded_with_real_schedule["facility_id"]},
        headers=headers,
    ).json()
    detail = client.get(f"/api/v1/children/{child['id']}", headers=headers).json()
    penta1 = next(d for d in detail["schedule"] if d["antigen"] == "Pentavalent" and d["dose_number"] == 1)

    late_date = (date.today() - timedelta(days=10)).isoformat()  # given very late
    client.post(
        f"/api/v1/children/{child['id']}/vaccinations",
        json={"schedule_entry_id": penta1["schedule_entry_id"], "event_date": late_date, "facility_id": seeded_with_real_schedule["facility_id"]},
        headers=headers,
    )
    detail2 = client.get(f"/api/v1/children/{child['id']}", headers=headers).json()
    penta2 = next(d for d in detail2["schedule"] if d["antigen"] == "Pentavalent" and d["dose_number"] == 2)
    assert penta2["status"] == "not_yet_due", (
        "Penta2's eligible date must be pushed to late_date+28 days, not just recommended age — "
        "otherwise a late Penta1 would incorrectly make Penta2 look immediately overdue."
    )


def test_registration_and_profile_include_address(client, seeded):
    headers = auth_headers(client)
    dob = (date.today() - timedelta(days=30)).isoformat()
    child = client.post(
        "/api/v1/children",
        json={
            "full_name": "Address Test Child", "sex": "F", "dob": dob,
            "facility_id": seeded["facility_id"], "address": "12 Sandor Road, Koidu Town",
        },
        headers=headers,
    ).json()
    assert child["address"] == "12 Sandor Road, Koidu Town"

    detail = client.get(f"/api/v1/children/{child['id']}", headers=headers).json()
    assert detail["address"] == "12 Sandor Road, Koidu Town"


def test_edit_child_record(client, seeded):
    headers = auth_headers(client)
    dob = (date.today() - timedelta(days=30)).isoformat()
    child = client.post(
        "/api/v1/children",
        json={"full_name": "Original Name", "sex": "F", "dob": dob, "facility_id": seeded["facility_id"]},
        headers=headers,
    ).json()

    resp = client.patch(
        f"/api/v1/children/{child['id']}",
        json={"full_name": "Corrected Name", "address": "New address here", "caregiver_phone": "076111222"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert updated["full_name"] == "Corrected Name"
    assert updated["address"] == "New address here"
    assert updated["caregiver_phone"] == "076111222"
    assert updated["system_id"] == child["system_id"], "Editing must not change the system_id."


def test_edit_child_rejects_future_dob(client, seeded):
    headers = auth_headers(client)
    dob = (date.today() - timedelta(days=30)).isoformat()
    child = client.post(
        "/api/v1/children",
        json={"full_name": "Test", "sex": "F", "dob": dob, "facility_id": seeded["facility_id"]},
        headers=headers,
    ).json()
    resp = client.patch(
        f"/api/v1/children/{child['id']}",
        json={"dob": (date.today() + timedelta(days=5)).isoformat()},
        headers=headers,
    )
    assert resp.status_code == 400


def test_delete_child_is_soft_delete_and_excluded_from_list(client, seeded):
    headers = auth_headers(client)
    dob = (date.today() - timedelta(days=30)).isoformat()
    child = client.post(
        "/api/v1/children",
        json={"full_name": "To Be Deleted", "sex": "M", "dob": dob, "facility_id": seeded["facility_id"]},
        headers=headers,
    ).json()

    resp = client.delete(f"/api/v1/children/{child['id']}", headers=headers)
    assert resp.status_code == 204

    # No longer in the list
    remaining = client.get("/api/v1/children", headers=headers).json()
    assert all(c["id"] != child["id"] for c in remaining)

    # No longer fetchable directly
    detail_resp = client.get(f"/api/v1/children/{child['id']}", headers=headers)
    assert detail_resp.status_code == 404

    # But the row still exists in the DB (soft delete, not hard delete) —
    # verify via direct DB query, since the API correctly hides it.
    db = TestSessionLocal()
    from app.models.child import Child as ChildModel
    row = db.query(ChildModel).filter(ChildModel.id == uuid.UUID(child["id"])).first()
    assert row is not None, "Soft delete must keep the row in the database."
    assert row.deleted_at is not None
    assert row.status == "deleted"
    db.close()


def test_deleted_child_excluded_from_due_list(client, seeded):
    headers = auth_headers(client)
    dob = (date.today() - timedelta(days=100)).isoformat()  # will be a defaulter
    child = client.post(
        "/api/v1/children",
        json={"full_name": "Defaulter Then Deleted", "sex": "F", "dob": dob, "facility_id": seeded["facility_id"]},
        headers=headers,
    ).json()
    before = client.get("/api/v1/due-list", headers=headers).json()
    assert any(r["child"]["id"] == child["id"] for r in before)

    client.delete(f"/api/v1/children/{child['id']}", headers=headers)

    after = client.get("/api/v1/due-list", headers=headers).json()
    assert all(r["child"]["id"] != child["id"] for r in after)


# ============================================================
# Dashboard, reports, and admin user management — added for
# items 4-8 of the feature request
# ============================================================

def test_dashboard_stats_given_total_and_needs_attention(client, seeded):
    """
    The minimal test fixture's schedule has no MR2 entry, so "fully
    immunized" (FIC) is correctly always 0 here regardless of what's
    given — see test_fully_immunized_* below (using the real 27-entry
    schedule, which does have MR2) for the actual FIC behavior tests.
    This test just checks given_total and needs_attention still work.
    """
    headers = auth_headers(client)

    child_a = client.post(
        "/api/v1/children",
        json={"full_name": "Newborn A", "sex": "F", "dob": date.today().isoformat(), "facility_id": seeded["facility_id"]},
        headers=headers,
    ).json()
    client.post(
        "/api/v1/children",
        json={"full_name": "Overdue B", "sex": "M", "dob": (date.today() - timedelta(days=100)).isoformat(), "facility_id": seeded["facility_id"]},
        headers=headers,
    )

    detail_a = client.get(f"/api/v1/children/{child_a['id']}", headers=headers).json()
    bcg = next(d for d in detail_a["schedule"] if d["antigen"] == "BCG")
    client.post(
        f"/api/v1/children/{child_a['id']}/vaccinations",
        json={"schedule_entry_id": bcg["schedule_entry_id"], "event_date": date.today().isoformat(), "facility_id": seeded["facility_id"]},
        headers=headers,
    )

    stats = client.get("/api/v1/dashboard", headers=headers).json()
    assert stats["registered"] == 2
    assert stats["given_total"] == 1
    assert stats["fully_immunized"] == 0  # no MR2 in this minimal fixture schedule
    assert stats["needs_attention_children"] == 1  # child B: overdue


def test_vaccinations_summary_report_groups_by_antigen_and_session_type(client, seeded):
    headers = auth_headers(client)
    child = client.post(
        "/api/v1/children",
        json={"full_name": "Report Test Child", "sex": "F", "dob": (date.today() - timedelta(days=10)).isoformat(), "facility_id": seeded["facility_id"]},
        headers=headers,
    ).json()

    client.post(
        f"/api/v1/children/{child['id']}/vaccinations",
        json={"schedule_entry_id": seeded["bcg1_id"], "event_date": date.today().isoformat(), "facility_id": seeded["facility_id"], "session_type": "outreach"},
        headers=headers,
    )

    report = client.get("/api/v1/reports/vaccinations-summary", headers=headers).json()
    assert report["total_doses"] == 1
    row = report["rows"][0]
    assert row["antigen"] == "BCG"
    assert row["session_type"] == "outreach"
    assert row["count"] == 1


def test_vaccinations_summary_report_respects_date_range(client, seeded):
    headers = auth_headers(client)
    child = client.post(
        "/api/v1/children",
        json={"full_name": "Date Range Child", "sex": "M", "dob": (date.today() - timedelta(days=10)).isoformat(), "facility_id": seeded["facility_id"]},
        headers=headers,
    ).json()
    client.post(
        f"/api/v1/children/{child['id']}/vaccinations",
        json={"schedule_entry_id": seeded["bcg1_id"], "event_date": date.today().isoformat(), "facility_id": seeded["facility_id"]},
        headers=headers,
    )

    future_range = client.get(
        "/api/v1/reports/vaccinations-summary",
        params={"start_date": (date.today() + timedelta(days=1)).isoformat()},
        headers=headers,
    ).json()
    assert future_range["total_doses"] == 0

    valid_range = client.get(
        "/api/v1/reports/vaccinations-summary",
        params={"start_date": (date.today() - timedelta(days=1)).isoformat(), "end_date": date.today().isoformat()},
        headers=headers,
    ).json()
    assert valid_range["total_doses"] == 1


def test_non_admin_cannot_create_users(client, seeded):
    headers = auth_headers(client)  # focal is NOT admin — should be rejected
    resp = client.post(
        "/api/v1/users",
        json={"full_name": "New Supervisor", "username": "newsup1", "password": "supervisorpass123", "role": "facility_supervisor"},
        headers=headers,
    )
    assert resp.status_code == 403


def test_admin_full_user_lifecycle(client, seeded):
    """Create an admin, then use that admin to create/list/deactivate a
    second user, then confirm a self-deactivation attempt is blocked."""
    db = TestSessionLocal()
    admin = User(
        id=uuid.uuid4(), full_name="Test Admin", username="testadmin",
        hashed_password=hash_password("adminpass123"), role="system_admin",
    )
    db.add(admin)
    db.commit()
    admin_id = admin.id  # capture before closing the session to avoid a detached-instance error later
    db.close()

    admin_headers = auth_headers(client, username="testadmin", password="adminpass123")

    create_resp = client.post(
        "/api/v1/users",
        json={"full_name": "New Supervisor", "username": "newsup1", "password": "supervisorpass123", "role": "facility_supervisor"},
        headers=admin_headers,
    )
    assert create_resp.status_code == 201, create_resp.text
    new_user = create_resp.json()
    assert new_user["role"] == "facility_supervisor"
    assert "hashed_password" not in new_user

    # Duplicate username rejected
    dup_resp = client.post(
        "/api/v1/users",
        json={"full_name": "Someone Else", "username": "newsup1", "password": "anotherpass123", "role": "chw"},
        headers=admin_headers,
    )
    assert dup_resp.status_code == 409

    # Invalid role rejected
    bad_role_resp = client.post(
        "/api/v1/users",
        json={"full_name": "Bad Role", "username": "badrole1", "password": "somepassword123", "role": "not_a_real_role"},
        headers=admin_headers,
    )
    assert bad_role_resp.status_code == 400

    # Admin lists including inactive
    listing = client.get("/api/v1/users", params={"include_inactive": True}, headers=admin_headers).json()
    assert any(u["id"] == new_user["id"] for u in listing)

    # Deactivate the new user
    deactivate_resp = client.patch(f"/api/v1/users/{new_user['id']}", json={"is_active": False}, headers=admin_headers)
    assert deactivate_resp.status_code == 200
    assert deactivate_resp.json()["is_active"] is False

    # Deactivated user no longer shows in default active-only listing
    active_listing = client.get("/api/v1/users", headers=admin_headers).json()
    assert all(u["id"] != new_user["id"] for u in active_listing)

    # Admin cannot deactivate themselves through this endpoint
    self_deactivate_resp = client.patch(f"/api/v1/users/{admin_id}", json={"is_active": False}, headers=admin_headers)
    assert self_deactivate_resp.status_code == 400


def test_non_admin_cannot_deactivate_users(client, seeded):
    headers = auth_headers(client)  # focal person, not admin
    resp = client.patch(f"/api/v1/users/{seeded['chw_id']}", json={"is_active": False}, headers=headers)
    assert resp.status_code == 403


def test_self_service_profile_update(client, seeded):
    headers = auth_headers(client)
    resp = client.patch("/api/v1/users/me", json={"full_name": "  Updated Name  "}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["full_name"] == "Updated Name"


def test_self_service_password_change(client, seeded):
    headers = auth_headers(client)
    resp = client.post(
        "/api/v1/users/me/change-password",
        json={"current_password": "testpass123", "new_password": "brandnewpassword456"},
        headers=headers,
    )
    assert resp.status_code == 204

    # Old password no longer works
    old_login = client.post("/api/v1/auth/login", data={"username": "focal", "password": "testpass123"})
    assert old_login.status_code == 401

    # New password works
    new_login = client.post("/api/v1/auth/login", data={"username": "focal", "password": "brandnewpassword456"})
    assert new_login.status_code == 200


def test_password_change_rejects_wrong_current_password(client, seeded):
    headers = auth_headers(client)
    resp = client.post(
        "/api/v1/users/me/change-password",
        json={"current_password": "wrongpassword", "new_password": "brandnewpassword456"},
        headers=headers,
    )
    assert resp.status_code == 401


# ============================================================
# "Fully Immunized Child" (FIC) redefinition — a child must have
# actually RECEIVED every dose through MR2, not merely have
# nothing currently outstanding for their age.
# ============================================================

# Recommended ages (days) for every entry, mirroring app/seed.py exactly —
# duplicated here deliberately so a future accidental change to seed.py's
# ages would make this test fail loudly (drift detector), rather than the
# test silently reading whatever seed.py currently says.
SEED_AGES_DAYS = {
    ("BCG", 1): 0, ("OPV (birth dose)", 0): 0,
    ("OPV", 1): 42, ("Pentavalent", 1): 42, ("PCV", 1): 42, ("Rota", 1): 42,
    ("OPV", 2): 70, ("Pentavalent", 2): 70, ("PCV", 2): 70, ("Rota", 2): 70, ("IPTi", 1): 70,
    ("OPV", 3): 98, ("Pentavalent", 3): 98, ("PCV", 3): 98, ("IPV", 1): 98, ("IPTi", 2): 98,
    ("Vitamin A Supplement", 1): 180, ("Malaria vaccine", 1): 180,
    ("Malaria vaccine", 2): 210,
    ("Malaria vaccine", 3): 240,
    ("Measles-Rubella (MR)", 1): 270, ("Yellow Fever", 1): 270, ("IPV", 2): 270, ("IPTi", 3): 270,
    ("Vitamin A Supplement & Albendazole", 1): 360,
    ("Measles-Rubella (MR)", 2): 450, ("Malaria vaccine", 4): 450,
}


def _give_every_dose_through_mr2(client, headers, child_id, facility_id, schedule_rows, event_date, skip=None):
    skip = skip or set()
    for row in schedule_rows:
        key = (row["antigen"], row["dose_number"])
        age = SEED_AGES_DAYS.get(key)
        assert age is not None, f"Test's age map is missing {key} — keep SEED_AGES_DAYS in sync with seed.py"
        if age <= 450 and key not in skip:
            resp = client.post(
                f"/api/v1/children/{child_id}/vaccinations",
                json={"schedule_entry_id": row["schedule_entry_id"], "event_date": event_date, "facility_id": facility_id},
                headers=headers,
            )
            assert resp.status_code == 201, resp.text


def test_young_child_is_never_fully_immunized_even_with_nothing_overdue(client, seeded_with_real_schedule):
    """
    The key behavior change: a newborn with nothing currently due is NOT
    a "Fully Immunized Child" under the real FIC definition, even though
    under the old "nothing outstanding for age" measure it would have
    counted. This is intentional, not a bug — see is_fully_immunized_child.
    """
    headers = auth_headers(client, username="admin", password="dev-only-change-me")
    child = client.post(
        "/api/v1/children",
        json={"full_name": "Brand New Baby", "sex": "F", "dob": date.today().isoformat(), "facility_id": seeded_with_real_schedule["facility_id"]},
        headers=headers,
    ).json()

    detail = client.get(f"/api/v1/children/{child['id']}", headers=headers).json()
    assert detail["fully_immunized"] is False

    stats = client.get("/api/v1/dashboard", headers=headers).json()
    assert child["id"] not in stats["fully_immunized_child_ids"]


def test_child_who_received_every_dose_through_mr2_is_fully_immunized(client, seeded_with_real_schedule):
    headers = auth_headers(client, username="admin", password="dev-only-change-me")
    dob = (date.today() - timedelta(days=500)).isoformat()  # old enough for every dose through MR2
    child = client.post(
        "/api/v1/children",
        json={"full_name": "Fully Vaccinated Child", "sex": "M", "dob": dob, "facility_id": seeded_with_real_schedule["facility_id"]},
        headers=headers,
    ).json()

    detail = client.get(f"/api/v1/children/{child['id']}", headers=headers).json()
    assert detail["fully_immunized"] is False  # nothing given yet

    _give_every_dose_through_mr2(
        client, headers, child["id"], seeded_with_real_schedule["facility_id"],
        detail["schedule"], date.today().isoformat(),
    )

    detail_after = client.get(f"/api/v1/children/{child['id']}", headers=headers).json()
    assert detail_after["fully_immunized"] is True, (
        "Child received every dose through MR2 (age 450 days) and should now be a Fully Immunized Child."
    )

    stats = client.get("/api/v1/dashboard", headers=headers).json()
    assert child["id"] in stats["fully_immunized_child_ids"]
    assert stats["fully_immunized"] >= 1


def test_missing_a_single_dose_through_mr2_prevents_fully_immunized(client, seeded_with_real_schedule):
    """Every dose through MR2 must be given — missing even one (here,
    Yellow Fever, which falls at the same age as MR1) must keep the child
    out of the Fully Immunized count."""
    headers = auth_headers(client, username="admin", password="dev-only-change-me")
    dob = (date.today() - timedelta(days=500)).isoformat()
    child = client.post(
        "/api/v1/children",
        json={"full_name": "Missing One Dose Child", "sex": "F", "dob": dob, "facility_id": seeded_with_real_schedule["facility_id"]},
        headers=headers,
    ).json()
    detail = client.get(f"/api/v1/children/{child['id']}", headers=headers).json()

    _give_every_dose_through_mr2(
        client, headers, child["id"], seeded_with_real_schedule["facility_id"],
        detail["schedule"], date.today().isoformat(),
        skip={("Yellow Fever", 1)},
    )

    detail_after = client.get(f"/api/v1/children/{child['id']}", headers=headers).json()
    assert detail_after["fully_immunized"] is False, (
        "Missing Yellow Fever (due at the same age as MR1, well before the MR2 cutoff) "
        "must prevent Fully Immunized status even though every other dose was given."
    )


def test_dose_after_mr2_does_not_gate_fully_immunized_status(client, seeded_with_real_schedule):
    """A dose that falls exactly ON the MR2 milestone (Malaria vaccine
    dose 4, also at 450 days in the seeded schedule) IS required — this
    documents the explicit interpretation flagged to the user: 'up to
    MR2' is inclusive of same-age doses, not just MR2 itself."""
    headers = auth_headers(client, username="admin", password="dev-only-change-me")
    dob = (date.today() - timedelta(days=500)).isoformat()
    child = client.post(
        "/api/v1/children",
        json={"full_name": "Missing Same-Age Dose Child", "sex": "M", "dob": dob, "facility_id": seeded_with_real_schedule["facility_id"]},
        headers=headers,
    ).json()
    detail = client.get(f"/api/v1/children/{child['id']}", headers=headers).json()

    _give_every_dose_through_mr2(
        client, headers, child["id"], seeded_with_real_schedule["facility_id"],
        detail["schedule"], date.today().isoformat(),
        skip={("Malaria vaccine", 4)},  # same age (450 days) as MR2 itself
    )

    detail_after = client.get(f"/api/v1/children/{child['id']}", headers=headers).json()
    assert detail_after["fully_immunized"] is False, (
        "Malaria vaccine dose 4 falls at the same recommended age as MR2 (450 days) and is "
        "included in the 'up to and including MR2' cutoff by this system's explicit design choice."
    )
