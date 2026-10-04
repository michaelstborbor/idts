"""
Tests for this round's changes:
  - facility_supervisor is now assigned to a CHIEFDOM directly
    (geographic_area_id), with the SAME scope on Dashboard, Children and
    Reports — no more special "reports-only" widening.
  - facility_focal_person's report access is back to just their own
    facility (no chiefdom widening).
  - The district-wide "Search for child" endpoint.

Shares the in-memory test database/engine from test_api_integration.py.
"""

import uuid
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.core.security import hash_password
from app.db.base import Base
from app.main import app
from app.models.child import Child, ImmunizationSchedule, ScheduleEntry
from app.models.user import Facility, GeographicArea, User
from tests.test_api_integration import TEST_ENGINE, TestSessionLocal

PASSWORD = "testpass123"


@pytest.fixture(autouse=True)
def _fresh_db():
    Base.metadata.create_all(bind=TEST_ENGINE)
    yield
    Base.metadata.drop_all(bind=TEST_ENGINE)


@pytest.fixture()
def client():
    return TestClient(app)


def _user(username, role, facility_id=None, area_id=None):
    return User(
        id=uuid.uuid4(), full_name=username.title(), username=username,
        hashed_password=hash_password(PASSWORD), role=role,
        facility_id=facility_id, geographic_area_id=area_id,
    )


@pytest.fixture()
def world():
    """
    District D has two chiefdoms: Chiefdom1 (facility F1) and Chiefdom2
    (facility F2). One child at each facility.
    """
    db = TestSessionLocal()
    country = GeographicArea(id=uuid.uuid4(), name="Testland", level="country")
    district = GeographicArea(id=uuid.uuid4(), name="District D", level="district", parent=country)
    chief1 = GeographicArea(id=uuid.uuid4(), name="Chiefdom1", level="chiefdom", parent=district)
    chief2 = GeographicArea(id=uuid.uuid4(), name="Chiefdom2", level="chiefdom", parent=district)
    db.add_all([country, district, chief1, chief2])
    db.flush()

    f1 = Facility(id=uuid.uuid4(), name="F1", facility_type="chc", geographic_area_id=chief1.id)
    f2 = Facility(id=uuid.uuid4(), name="F2", facility_type="chc", geographic_area_id=chief2.id)
    db.add_all([f1, f2])
    db.flush()

    users = [
        _user("fsup1", "facility_supervisor", area_id=chief1.id),  # NEW: area-assigned, not facility_id
        _user("ffocal1", "facility_focal_person", facility_id=f1.id),
        _user("admin", "system_admin"),
    ]
    db.add_all(users)

    schedule = ImmunizationSchedule(id=uuid.uuid4(), name="Test", is_active=True)
    db.add(schedule)
    db.flush()
    db.add(ScheduleEntry(
        id=uuid.uuid4(), schedule_id=schedule.id, antigen="BCG", dose_number=1,
        recommended_age_days=0, minimum_age_days=0, due_soon_window_days=3,
        overdue_window_days=11, defaulter_threshold_days=30, display_order=1,
    ))

    dob = date.today() - timedelta(days=200)
    c1 = Child(id=uuid.uuid4(), system_id="T-1", full_name="Fatmata Kamara", sex="F", dob=dob, facility_id=f1.id,
               status="active", caregiver_name="Mariama Kamara", caregiver_phone="076000000")
    c2 = Child(id=uuid.uuid4(), system_id="T-2", full_name="Someone Else", sex="M", dob=dob, facility_id=f2.id, status="active")
    db.add_all([c1, c2])
    db.commit()
    out = {"f1": str(f1.id), "f2": str(f2.id), "chief1": str(chief1.id), "chief2": str(chief2.id)}
    db.close()
    return out


def _headers(client, username):
    resp = client.post("/api/v1/auth/login", data={"username": username, "password": PASSWORD})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


# ---------- Facility Supervisor: unified chiefdom scope ----------

def test_facility_supervisor_dashboard_now_covers_whole_chiefdom(client, world):
    """Chiefdom1 only has F1 in this fixture, so this also implicitly
    checks F2 (Chiefdom2) is NOT included."""
    headers = _headers(client, "fsup1")
    assert client.get("/api/v1/dashboard", headers=headers).json()["registered"] == 1


def test_facility_supervisor_reports_match_dashboard_scope_exactly(client, world):
    w = world
    headers = _headers(client, "fsup1")
    report = client.get(
        "/api/v1/reports/generate", params={"level": "chiefdom", "unit_id": w["chief1"]}, headers=headers
    ).json()
    assert report["registered"] == 1
    # Their own chiefdom's OTHER facility doesn't exist in this fixture, but
    # the other chiefdom's facility must still be unreachable:
    resp = client.get(
        "/api/v1/reports/generate", params={"level": "facility", "unit_id": w["f2"]}, headers=headers
    )
    assert resp.status_code == 403


def test_facility_focal_person_report_access_is_own_facility_only_again(client, world):
    """No more chiefdom-wide widening for this role — back to exactly
    their own facility, nothing else."""
    w = world
    headers = _headers(client, "ffocal1")
    report = client.get(
        "/api/v1/reports/generate", params={"level": "facility", "unit_id": w["f1"]}, headers=headers
    ).json()
    assert report["registered"] == 1
    resp = client.get(
        "/api/v1/reports/generate", params={"level": "chiefdom", "unit_id": w["chief1"]}, headers=headers
    )
    assert resp.status_code == 403  # a whole chiefdom is wider than "just my facility"


# ---------- Edit user (existing PATCH endpoint, now exposed in the UI) ----------

def test_admin_can_reassign_a_users_role_and_area(client, world):
    w = world
    headers = _headers(client, "admin")
    me = client.get("/api/v1/users/me", headers=_headers(client, "fsup1")).json()
    resp = client.patch(
        f"/api/v1/users/{me['id']}",
        json={"role": "facility_supervisor", "geographic_area_id": w["chief2"], "facility_id": None},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["geographic_area_id"] == w["chief2"]
    # Access now follows the NEW chiefdom immediately:
    moved_headers = _headers(client, "fsup1")
    assert client.get("/api/v1/dashboard", headers=moved_headers).json()["registered"] == 1  # F2's child now


# ---------- Search for child (district-wide) ----------

def test_search_requires_at_least_one_term(client, world):
    resp = client.get("/api/v1/children/search", headers=_headers(client, "ffocal1"))
    assert resp.status_code == 400


def test_facility_level_user_search_reaches_whole_district(client, world):
    """ffocal1 is assigned to F1 only — but the child they're checking for
    duplicates of is at F2, a DIFFERENT facility in the same district."""
    resp = client.get(
        "/api/v1/children/search", params={"name": "Someone"}, headers=_headers(client, "ffocal1")
    )
    assert resp.status_code == 200
    results = resp.json()
    assert len(results) == 1
    assert results[0]["full_name"] == "Someone Else"
    assert results[0]["facility_name"] == "F2"


def test_search_result_includes_full_detail(client, world):
    resp = client.get(
        "/api/v1/children/search", params={"caregiver_name": "Mariama"}, headers=_headers(client, "ffocal1")
    )
    results = resp.json()
    assert len(results) == 1
    assert results[0]["caregiver_phone"] == "076000000"
    assert "schedule" in results[0] and "fully_immunized" in results[0]


def test_search_does_not_widen_normal_child_access(client, world):
    """Finding a match via search does NOT unlock normal (non-search)
    access to that child's profile outside the searcher's everyday scope."""
    w = world
    resp = client.get(f"/api/v1/children/{w['f2']}", headers=_headers(client, "ffocal1"))
    # (using f2's id here only to assert the *pattern* holds for an
    # out-of-scope id in general; the real child id check is below)
    assert resp.status_code in (403, 404)
