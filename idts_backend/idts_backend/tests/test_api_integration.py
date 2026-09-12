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
