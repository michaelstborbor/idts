"""
Access-scope tests: facility users see only their facility, a district
manager sees every facility in their district (and nothing outside it),
national users and admins see everything.

Shares the in-memory test database/engine from test_api_integration.py so
both files can run together (`PYTHONPATH=. pytest tests/ -v`).
"""

import uuid
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.core.security import hash_password
from app.db.base import Base
from app.main import app
from app.models.child import Child, ImmunizationSchedule, ScheduleEntry, VaccinationEvent
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
    """Two districts. District A has two chiefdoms and facilities F1 (chiefdom A1)
    and F2 (chiefdom A2); district B has facility F3. One child at each facility;
    the F1 child has one recorded BCG dose."""
    db = TestSessionLocal()
    country = GeographicArea(id=uuid.uuid4(), name="Testland", level="country")
    dist_a = GeographicArea(id=uuid.uuid4(), name="District A", level="district", parent=country)
    dist_b = GeographicArea(id=uuid.uuid4(), name="District B", level="district", parent=country)
    chief_a1 = GeographicArea(id=uuid.uuid4(), name="Chiefdom A1", level="chiefdom", parent=dist_a)
    chief_a2 = GeographicArea(id=uuid.uuid4(), name="Chiefdom A2", level="chiefdom", parent=dist_a)
    chief_b1 = GeographicArea(id=uuid.uuid4(), name="Chiefdom B1", level="chiefdom", parent=dist_b)
    db.add_all([country, dist_a, dist_b, chief_a1, chief_a2, chief_b1])
    db.flush()

    f1 = Facility(id=uuid.uuid4(), name="F1", facility_type="chc", geographic_area_id=chief_a1.id)
    f2 = Facility(id=uuid.uuid4(), name="F2", facility_type="chc", geographic_area_id=chief_a2.id)
    f3 = Facility(id=uuid.uuid4(), name="F3", facility_type="chc", geographic_area_id=chief_b1.id)
    db.add_all([f1, f2, f3])
    db.flush()

    users = [
        _user("f1focal", "facility_focal_person", facility_id=f1.id),
        _user("f2focal", "facility_focal_person", facility_id=f2.id),
        _user("f3focal", "facility_focal_person", facility_id=f3.id),
        _user("nofacility", "facility_focal_person"),
        _user("districta", "district_manager", area_id=dist_a.id),
        _user("nodistrict", "district_manager"),
        _user("national", "national_user"),
        _user("admin", "system_admin"),
    ]
    db.add_all(users)

    schedule = ImmunizationSchedule(id=uuid.uuid4(), name="Test", is_active=True)
    db.add(schedule)
    db.flush()
    bcg = ScheduleEntry(
        id=uuid.uuid4(), schedule_id=schedule.id, antigen="BCG", dose_number=1,
        recommended_age_days=0, minimum_age_days=0, due_soon_window_days=3,
        overdue_window_days=11, defaulter_threshold_days=30, display_order=1,
    )
    db.add(bcg)

    dob = date.today() - timedelta(days=200)
    children = {}
    for i, fac in enumerate([f1, f2, f3], start=1):
        c = Child(id=uuid.uuid4(), system_id=f"T-{i}", full_name=f"Child {i}", sex="F", dob=dob, facility_id=fac.id, status="active")
        db.add(c)
        children[f"c{i}"] = c
    db.flush()
    db.add(VaccinationEvent(
        id=uuid.uuid4(), child_id=children["c1"].id, schedule_entry_id=bcg.id,
        event_date=date.today() - timedelta(days=100), facility_id=f1.id, session_type="fixed",
    ))
    db.commit()
    out = {
        "f1": str(f1.id), "f2": str(f2.id), "f3": str(f3.id),
        "c1": str(children["c1"].id), "c2": str(children["c2"].id), "c3": str(children["c3"].id),
        "dist_a": str(dist_a.id),
    }
    db.close()
    return out


def _headers(client, username):
    resp = client.post("/api/v1/auth/login", data={"username": username, "password": PASSWORD})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _registered(client, username):
    return client.get("/api/v1/dashboard", headers=_headers(client, username)).json()["registered"]


# ---------- Dashboard ----------

def test_facility_user_dashboard_only_counts_own_facility(client, world):
    assert _registered(client, "f1focal") == 1
    assert _registered(client, "f2focal") == 1


def test_district_manager_dashboard_covers_whole_district_only(client, world):
    assert _registered(client, "districta") == 2  # F1 + F2, not F3


def test_national_and_admin_dashboards_see_everything(client, world):
    assert _registered(client, "national") == 3
    assert _registered(client, "admin") == 3


def test_users_without_a_facility_or_district_see_nothing(client, world):
    assert _registered(client, "nofacility") == 0
    assert _registered(client, "nodistrict") == 0


def test_facility_user_cannot_request_another_facilitys_dashboard(client, world):
    resp = client.get("/api/v1/dashboard", params={"facility_id": world["f2"]}, headers=_headers(client, "f1focal"))
    assert resp.status_code == 403


# ---------- Children and other records ----------

def test_children_list_and_profile_are_scoped(client, world):
    headers = _headers(client, "f1focal")
    listing = client.get("/api/v1/children", headers=headers).json()
    assert [c["id"] for c in listing] == [world["c1"]]
    assert client.get(f"/api/v1/children/{world['c1']}", headers=headers).status_code == 200
    assert client.get(f"/api/v1/children/{world['c2']}", headers=headers).status_code == 404


def test_facility_user_cannot_register_child_at_another_facility(client, world):
    resp = client.post(
        "/api/v1/children",
        json={"full_name": "Sneaky", "sex": "F", "dob": str(date.today() - timedelta(days=30)), "facility_id": world["f2"]},
        headers=_headers(client, "f1focal"),
    )
    assert resp.status_code == 403


def test_facilities_dropdown_is_scoped(client, world):
    ids = [f["id"] for f in client.get("/api/v1/facilities", headers=_headers(client, "f1focal")).json()]
    assert ids == [world["f1"]]
    district_ids = {f["id"] for f in client.get("/api/v1/facilities", headers=_headers(client, "districta")).json()}
    assert district_ids == {world["f1"], world["f2"]}


def test_due_list_is_scoped(client, world):
    rows = client.get("/api/v1/due-list", headers=_headers(client, "f2focal")).json()
    assert all(r["child"]["id"] == world["c2"] for r in rows)


# ---------- Reports ----------

def test_vaccination_summary_is_scoped(client, world):
    assert client.get("/api/v1/reports/vaccinations-summary", headers=_headers(client, "f1focal")).json()["total_doses"] == 1
    assert client.get("/api/v1/reports/vaccinations-summary", headers=_headers(client, "f2focal")).json()["total_doses"] == 0
    assert client.get("/api/v1/reports/vaccinations-summary", headers=_headers(client, "national")).json()["total_doses"] == 1


def test_scope_info_reports_level_and_allowed_breakdowns(client, world):
    facility_scope = client.get("/api/v1/reports/scope", headers=_headers(client, "f1focal")).json()
    assert facility_scope["level"] == "facility" and facility_scope["scope_label"] == "F1"
    assert "chiefdom" not in facility_scope["allowed_group_by"]
    district_scope = client.get("/api/v1/reports/scope", headers=_headers(client, "districta")).json()
    assert district_scope["level"] == "district" and district_scope["scope_label"] == "District A"
    assert "chiefdom" in district_scope["allowed_group_by"] and "district" not in district_scope["allowed_group_by"]
    assert "district" in client.get("/api/v1/reports/scope", headers=_headers(client, "national")).json()["allowed_group_by"]
    assert "country" in client.get("/api/v1/reports/scope", headers=_headers(client, "admin")).json()["allowed_group_by"]


def test_district_aggregate_by_facility_and_chiefdom(client, world):
    headers = _headers(client, "districta")
    by_facility = client.get("/api/v1/reports/aggregate", params={"group_by": "facility"}, headers=headers).json()
    assert {r["label"] for r in by_facility["rows"]} == {"F1", "F2"}
    assert by_facility["totals"]["registered"] == 2
    by_chiefdom = client.get("/api/v1/reports/aggregate", params={"group_by": "chiefdom"}, headers=headers).json()
    assert {r["label"] for r in by_chiefdom["rows"]} == {"Chiefdom A1", "Chiefdom A2"}
    assert by_chiefdom["totals"]["doses_given"] == 1


def test_national_aggregate_by_district(client, world):
    data = client.get("/api/v1/reports/aggregate", params={"group_by": "district"}, headers=_headers(client, "national")).json()
    by_label = {r["label"]: r for r in data["rows"]}
    assert set(by_label) == {"District A", "District B"}
    assert by_label["District A"]["registered"] == 2 and by_label["District B"]["registered"] == 1


def test_admin_aggregate_by_country(client, world):
    data = client.get("/api/v1/reports/aggregate", params={"group_by": "country"}, headers=_headers(client, "admin")).json()
    assert [r["label"] for r in data["rows"]] == ["Testland"]
    assert data["rows"][0]["registered"] == 3


def test_breakdown_not_allowed_for_the_account_level_is_rejected(client, world):
    assert client.get("/api/v1/reports/aggregate", params={"group_by": "district"}, headers=_headers(client, "districta")).status_code == 403
    assert client.get("/api/v1/reports/aggregate", params={"group_by": "chiefdom"}, headers=_headers(client, "f1focal")).status_code == 403
    assert client.get("/api/v1/reports/aggregate", params={"group_by": "country"}, headers=_headers(client, "national")).status_code == 403


def test_facility_user_aggregate_only_shows_own_facility(client, world):
    data = client.get("/api/v1/reports/aggregate", params={"group_by": "facility"}, headers=_headers(client, "f1focal")).json()
    assert [r["label"] for r in data["rows"]] == ["F1"]


def test_aggregate_by_user_runs_for_each_level(client, world):
    for username in ("f1focal", "districta", "national", "admin"):
        resp = client.get("/api/v1/reports/aggregate", params={"group_by": "user"}, headers=_headers(client, username))
        assert resp.status_code == 200, (username, resp.text)
