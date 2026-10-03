"""
Tests for: national_user scoped to one assigned COUNTRY (not every country),
facility_supervisor/facility_focal_person getting their whole CHIEFDOM for
reports specifically (but still just their own facility on Dashboard),
vaccinator/chw blocked from every report endpoint, the cascading geography
endpoints (countries/districts/chiefdoms), and the new /reports/generate
3-step report.

Shares the in-memory test database/engine from test_api_integration.py.
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
def two_countries_world():
    """
    Country A: District A1 -> Chiefdom A1a -> Facility fA1 (+ Chiefdom A1b -> fA2).
    Country B: District B1 -> Chiefdom B1a -> Facility fB1.
    One child at each facility. fA1's child has one recorded BCG dose.
    """
    db = TestSessionLocal()
    country_a = GeographicArea(id=uuid.uuid4(), name="Country A", level="country")
    country_b = GeographicArea(id=uuid.uuid4(), name="Country B", level="country")
    district_a1 = GeographicArea(id=uuid.uuid4(), name="District A1", level="district", parent=country_a)
    district_b1 = GeographicArea(id=uuid.uuid4(), name="District B1", level="district", parent=country_b)
    chief_a1a = GeographicArea(id=uuid.uuid4(), name="Chiefdom A1a", level="chiefdom", parent=district_a1)
    chief_a1b = GeographicArea(id=uuid.uuid4(), name="Chiefdom A1b", level="chiefdom", parent=district_a1)
    chief_b1a = GeographicArea(id=uuid.uuid4(), name="Chiefdom B1a", level="chiefdom", parent=district_b1)
    db.add_all([country_a, country_b, district_a1, district_b1, chief_a1a, chief_a1b, chief_b1a])
    db.flush()

    fA1 = Facility(id=uuid.uuid4(), name="fA1", facility_type="chc", geographic_area_id=chief_a1a.id)
    fA2 = Facility(id=uuid.uuid4(), name="fA2", facility_type="chc", geographic_area_id=chief_a1b.id)
    fB1 = Facility(id=uuid.uuid4(), name="fB1", facility_type="chc", geographic_area_id=chief_b1a.id)
    db.add_all([fA1, fA2, fB1])
    db.flush()

    users = [
        _user("nat_a", "national_user", area_id=country_a.id),
        _user("no_country", "national_user"),
        _user("fsup_a1", "facility_supervisor", facility_id=fA1.id),
        _user("ffocal_a1", "facility_focal_person", facility_id=fA1.id),
        _user("vacc_a1", "vaccinator", facility_id=fA1.id),
        _user("chw_a1", "chw", facility_id=fA1.id),
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
    for key, fac in [("cA1", fA1), ("cA2", fA2), ("cB1", fB1)]:
        c = Child(id=uuid.uuid4(), system_id=key, full_name=key, sex="F", dob=dob, facility_id=fac.id, status="active")
        db.add(c)
        children[key] = c
    db.flush()
    db.add(VaccinationEvent(
        id=uuid.uuid4(), child_id=children["cA1"].id, schedule_entry_id=bcg.id,
        event_date=date.today() - timedelta(days=100), facility_id=fA1.id, session_type="fixed",
    ))
    db.commit()
    out = {
        "country_a": str(country_a.id), "country_b": str(country_b.id),
        "district_a1": str(district_a1.id),
        "chief_a1a": str(chief_a1a.id), "chief_a1b": str(chief_a1b.id),
        "fA1": str(fA1.id), "fA2": str(fA2.id), "fB1": str(fB1.id),
    }
    db.close()
    return out


def _headers(client, username):
    resp = client.post("/api/v1/auth/login", data={"username": username, "password": PASSWORD})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


# ---------- National Supervisor is now bounded by their assigned country ----------

def test_national_user_sees_only_their_assigned_country(client, two_countries_world):
    headers = _headers(client, "nat_a")
    dash = client.get("/api/v1/dashboard", headers=headers).json()
    assert dash["registered"] == 2  # fA1 + fA2, NOT fB1 in Country B


def test_national_user_with_no_country_sees_nothing(client, two_countries_world):
    headers = _headers(client, "no_country")
    assert client.get("/api/v1/dashboard", headers=headers).json()["registered"] == 0


def test_national_user_countries_endpoint_returns_only_their_own(client, two_countries_world):
    data = client.get("/api/v1/facilities/countries", headers=_headers(client, "nat_a")).json()
    assert [c["name"] for c in data] == ["Country A"]


def test_admin_countries_endpoint_returns_every_country(client, two_countries_world):
    data = client.get("/api/v1/facilities/countries", headers=_headers(client, "admin")).json()
    assert {c["name"] for c in data} == {"Country A", "Country B"}


def test_chiefdoms_endpoint_scoped_by_country_for_national_user(client, two_countries_world):
    data = client.get("/api/v1/facilities/chiefdoms", headers=_headers(client, "nat_a")).json()
    assert {c["name"] for c in data} == {"Chiefdom A1a", "Chiefdom A1b"}


# ---------- Reports: facility_supervisor / facility_focal_person get their CHIEFDOM ----------

def test_facility_supervisor_report_scope_is_whole_chiefdom(client, two_countries_world):
    """fA1 and fA2 are both in Chiefdom A1a / A1b under District A1 — wait,
    they're in different chiefdoms (A1a vs A1b), so a Chiefdom-wide report
    for fsup_a1 (assigned to fA1, in A1a) should cover fA1 only, NOT fA2."""
    w = two_countries_world
    headers = _headers(client, "fsup_a1")
    report = client.get(
        "/api/v1/reports/generate",
        params={"level": "chiefdom", "unit_id": w["chief_a1a"]},
        headers=headers,
    ).json()
    assert report["registered"] == 1  # only fA1's child


def test_facility_supervisor_cannot_report_on_a_different_chiefdom(client, two_countries_world):
    w = two_countries_world
    resp = client.get(
        "/api/v1/reports/generate",
        params={"level": "chiefdom", "unit_id": w["chief_a1b"]},  # fA2's chiefdom, not theirs
        headers=_headers(client, "fsup_a1"),
    )
    assert resp.status_code == 403


def test_facility_supervisor_dashboard_stays_own_facility_only(client, two_countries_world):
    """The widened chiefdom scope is for REPORTS only — Dashboard stays
    locked to just their own facility, same as before this update."""
    headers = _headers(client, "fsup_a1")
    assert client.get("/api/v1/dashboard", headers=headers).json()["registered"] == 1


# ---------- vaccinator / chw: no report access at all, enforced server-side ----------

@pytest.mark.parametrize("username", ["vacc_a1", "chw_a1"])
def test_vaccinator_and_chw_blocked_from_every_report_endpoint(client, two_countries_world, username):
    headers = _headers(client, username)
    assert client.get("/api/v1/reports/scope", headers=headers).status_code == 403
    assert client.get("/api/v1/reports/vaccines", headers=headers).status_code == 403
    assert client.get("/api/v1/reports/aggregate", headers=headers).status_code == 403
    assert client.get(
        "/api/v1/reports/generate", params={"level": "facility", "unit_id": "00000000-0000-0000-0000-000000000000"},
        headers=headers,
    ).status_code == 403


# ---------- /reports/generate: totals, vaccine filter, and access checks ----------

def test_generate_report_for_a_single_facility(client, two_countries_world):
    w = two_countries_world
    report = client.get(
        "/api/v1/reports/generate",
        params={"level": "facility", "unit_id": w["fA1"]},
        headers=_headers(client, "admin"),
    ).json()
    assert report["registered"] == 1
    assert report["doses_given_total"] == 1
    assert report["doses_by_vaccine"] == [{"antigen": "BCG", "doses_given": 1}]


def test_generate_report_filters_to_selected_vaccines(client, two_countries_world):
    w = two_countries_world
    report = client.get(
        "/api/v1/reports/generate",
        params={"level": "facility", "unit_id": w["fA1"], "antigens": ["OPV"]},  # BCG was given, not OPV
        headers=_headers(client, "admin"),
    ).json()
    assert report["doses_given_total"] == 0
    assert report["vaccines_included"] == ["OPV"]


def test_generate_report_rejects_out_of_scope_unit(client, two_countries_world):
    w = two_countries_world
    resp = client.get(
        "/api/v1/reports/generate",
        params={"level": "country", "unit_id": w["country_b"]},  # national_user nat_a is Country A only
        headers=_headers(client, "nat_a"),
    )
    assert resp.status_code == 403


def test_generate_report_country_level_aggregates_its_whole_country(client, two_countries_world):
    w = two_countries_world
    report = client.get(
        "/api/v1/reports/generate",
        params={"level": "country", "unit_id": w["country_a"]},
        headers=_headers(client, "nat_a"),
    ).json()
    assert report["registered"] == 2  # fA1 + fA2
