"""
AEFI API tests: recording, validation, access scope, dashboard and report
integration, and the per-dose report rows.

Shares the in-memory test database/engine from test_api_integration.py.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.security import hash_password
from app.db.base import Base
from app.main import app
from app.models.aefi import AefiEvent
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
    """
    One country/district, two chiefdoms: F1 (chiefdom 1) and F2 (chiefdom 2).
    Child c1 at F1 has BCG dose 1 recorded; child c2 at F2 has BCG dose 1 too.
    The schedule also has OPV doses 1 and 2 (none given), so per-dose report
    rows with zero given can be checked.
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

    db.add_all([
        _user("vacc1", "vaccinator", facility_id=f1.id),
        _user("chw1", "chw", facility_id=f1.id),
        _user("fsup1", "facility_supervisor", area_id=chief1.id),
        _user("natl", "national_user", area_id=country.id),
        _user("admin", "system_admin"),
    ])

    schedule = ImmunizationSchedule(id=uuid.uuid4(), name="Test", is_active=True)
    db.add(schedule)
    db.flush()

    def entry(antigen, dose, order):
        e = ScheduleEntry(
            id=uuid.uuid4(), schedule_id=schedule.id, antigen=antigen, dose_number=dose,
            recommended_age_days=0, minimum_age_days=0, due_soon_window_days=3,
            overdue_window_days=11, defaulter_threshold_days=30, display_order=order,
        )
        db.add(e)
        return e

    bcg = entry("BCG", 1, 1)
    opv1 = entry("OPV", 1, 2)
    opv2 = entry("OPV", 2, 3)
    db.flush()

    dob = date.today() - timedelta(days=200)
    c1 = Child(id=uuid.uuid4(), system_id="T-1", full_name="Fatmata Kamara", sex="F", dob=dob, facility_id=f1.id, status="active")
    c2 = Child(id=uuid.uuid4(), system_id="T-2", full_name="Other Child", sex="M", dob=dob, facility_id=f2.id, status="active")
    db.add_all([c1, c2])
    db.flush()

    given = date.today() - timedelta(days=20)
    v1 = VaccinationEvent(id=uuid.uuid4(), child_id=c1.id, schedule_entry_id=bcg.id, event_date=given,
                          facility_id=f1.id, session_type="fixed", batch_lot_number="LOT-1")
    v1b = VaccinationEvent(id=uuid.uuid4(), child_id=c1.id, schedule_entry_id=opv1.id, event_date=given,
                           facility_id=f1.id, session_type="fixed")
    v2 = VaccinationEvent(id=uuid.uuid4(), child_id=c2.id, schedule_entry_id=bcg.id, event_date=given,
                          facility_id=f2.id, session_type="fixed")
    db.add_all([v1, v1b, v2])
    db.commit()
    out = {
        "c1": str(c1.id), "c2": str(c2.id), "v_bcg": str(v1.id), "v_opv1": str(v1b.id), "v_c2": str(v2.id),
        "f1": str(f1.id), "f2": str(f2.id), "given": given,
    }
    db.close()
    return out


def _h(client, username):
    resp = client.post("/api/v1/auth/login", data={"username": username, "password": PASSWORD})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _payload(w, **over):
    body = {
        "child_id": w["c1"],
        "vaccination_event_ids": [w["v_bcg"]],
        "onset_date": str(date.today() - timedelta(days=2)),
        "event_type": "fever",
        "severity": "mild",
    }
    body.update(over)
    return body


# ---------- recording ----------

def test_vaccinator_can_record_an_aefi(client, world):
    resp = client.post("/api/v1/aefi", json=_payload(world), headers=_h(client, "vacc1"))
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["aefi_number"] == "AEFI-000001"
    assert data["child_name"] == "Fatmata Kamara" and data["facility_name"] == "F1"
    assert data["vaccinations"][0]["antigen"] == "BCG" and data["vaccinations"][0]["batch_lot_number"] == "LOT-1"
    assert data["is_serious"] is False and data["report_status"] == "not_required"


def test_numbers_increase(client, world):
    h = _h(client, "vacc1")
    client.post("/api/v1/aefi", json=_payload(world), headers=h)
    second = client.post("/api/v1/aefi", json=_payload(world, event_type="rash"), headers=h)
    assert second.json()["aefi_number"] == "AEFI-000002"


def test_serious_criteria_make_it_serious_and_pending_a_report(client, world):
    resp = client.post(
        "/api/v1/aefi",
        json=_payload(world, event_type="anaphylaxis", severity="severe", serious_criteria=["hospitalization"]),
        headers=_h(client, "vacc1"),
    )
    data = resp.json()
    assert data["is_serious"] is True
    assert data["report_status"] == "pending" and data["investigation_status"] == "pending"


def test_serious_aefi_becomes_overdue_after_24_hours_then_done_when_reported(client, world):
    h = _h(client, "vacc1")
    created = client.post(
        "/api/v1/aefi", json=_payload(world, event_type="anaphylaxis", severity="severe", serious_criteria=["death"]), headers=h
    ).json()
    db = TestSessionLocal()
    row = db.query(AefiEvent).filter(AefiEvent.aefi_number == created["aefi_number"]).first()
    row.created_at = datetime.now(timezone.utc) - timedelta(days=3)
    db.commit()
    db.close()
    assert client.get(f"/api/v1/aefi/{created['id']}", headers=h).json()["report_status"] == "overdue"
    patched = client.patch(f"/api/v1/aefi/{created['id']}", json={"reported_date": str(date.today())}, headers=h)
    assert patched.status_code == 200, patched.text
    assert patched.json()["report_status"] == "done"


def test_clearing_seriousness_criteria_clears_the_serious_flag(client, world):
    h = _h(client, "vacc1")
    created = client.post("/api/v1/aefi", json=_payload(world, serious_criteria=["hospitalization"]), headers=h).json()
    updated = client.patch(f"/api/v1/aefi/{created['id']}", json={"serious_criteria": []}, headers=h).json()
    assert updated["is_serious"] is False and updated["report_status"] == "not_required"


# ---------- validation ----------

def test_at_least_one_vaccination_is_required(client, world):
    resp = client.post("/api/v1/aefi", json=_payload(world, vaccination_event_ids=[]), headers=_h(client, "vacc1"))
    assert resp.status_code == 422


def test_vaccination_of_a_different_child_is_rejected(client, world):
    resp = client.post("/api/v1/aefi", json=_payload(world, vaccination_event_ids=[world["v_c2"]]), headers=_h(client, "vacc1"))
    assert resp.status_code == 400


def test_onset_cannot_be_before_the_vaccination_or_in_the_future(client, world):
    h = _h(client, "vacc1")
    before = str(world["given"] - timedelta(days=1))
    assert client.post("/api/v1/aefi", json=_payload(world, onset_date=before), headers=h).status_code == 400
    future = str(date.today() + timedelta(days=1))
    assert client.post("/api/v1/aefi", json=_payload(world, onset_date=future), headers=h).status_code == 400


def test_other_event_type_needs_a_description(client, world):
    resp = client.post("/api/v1/aefi", json=_payload(world, event_type="other"), headers=_h(client, "vacc1"))
    assert resp.status_code == 422
    ok = client.post("/api/v1/aefi", json=_payload(world, event_type="other", event_description="Unusual swelling"), headers=_h(client, "vacc1"))
    assert ok.status_code == 201


def test_unknown_catalog_values_are_rejected(client, world):
    h = _h(client, "vacc1")
    assert client.post("/api/v1/aefi", json=_payload(world, severity="catastrophic"), headers=h).status_code == 422
    assert client.post("/api/v1/aefi", json=_payload(world, management_actions=["do_a_dance"]), headers=h).status_code == 422
    assert client.post("/api/v1/aefi", json=_payload(world, serious_criteria=["grumpy"]), headers=h).status_code == 422


# ---------- access ----------

def test_cannot_record_for_a_child_outside_your_scope(client, world):
    resp = client.post(
        "/api/v1/aefi", json=_payload(world, child_id=world["c2"], vaccination_event_ids=[world["v_c2"]]), headers=_h(client, "vacc1")
    )
    assert resp.status_code == 404  # looks exactly like a nonexistent child


def test_chw_can_record_but_national_supervisor_is_view_only(client, world):
    assert client.post("/api/v1/aefi", json=_payload(world), headers=_h(client, "chw1")).status_code == 201
    assert client.post("/api/v1/aefi", json=_payload(world), headers=_h(client, "natl")).status_code == 403


def test_list_and_get_follow_the_same_scope_as_children(client, world):
    client.post("/api/v1/aefi", json=_payload(world), headers=_h(client, "vacc1"))
    f2_rec = client.post(
        "/api/v1/aefi", json=_payload(world, child_id=world["c2"], vaccination_event_ids=[world["v_c2"]]), headers=_h(client, "admin")
    ).json()
    assert len(client.get("/api/v1/aefi", headers=_h(client, "vacc1")).json()) == 1       # own facility only
    assert len(client.get("/api/v1/aefi", headers=_h(client, "fsup1")).json()) == 1       # own chiefdom only
    assert len(client.get("/api/v1/aefi", headers=_h(client, "natl")).json()) == 2        # whole country
    assert client.get(f"/api/v1/aefi/{f2_rec['id']}", headers=_h(client, "vacc1")).status_code == 404


def test_filters(client, world):
    h = _h(client, "vacc1")
    client.post("/api/v1/aefi", json=_payload(world), headers=h)
    client.post("/api/v1/aefi", json=_payload(world, event_type="anaphylaxis", severity="severe", serious_criteria=["hospitalization"]), headers=h)
    assert len(client.get("/api/v1/aefi", params={"severity": "severe"}, headers=h).json()) == 1
    assert len(client.get("/api/v1/aefi", params={"serious_only": "true"}, headers=h).json()) == 1


def test_eligible_vaccinations_lists_the_childs_recorded_doses(client, world):
    resp = client.get(f"/api/v1/aefi/children/{world['c1']}/vaccinations", headers=_h(client, "vacc1"))
    assert {v["antigen"] for v in resp.json()} == {"BCG", "OPV"}
    assert client.get(f"/api/v1/aefi/children/{world['c2']}/vaccinations", headers=_h(client, "vacc1")).status_code == 404


def test_a_user_who_recorded_an_aefi_cannot_be_deleted(client, world):
    client.post("/api/v1/aefi", json=_payload(world), headers=_h(client, "vacc1"))
    admin = _h(client, "admin")
    users = client.get("/api/v1/users", params={"include_inactive": "true"}, headers=admin).json()
    vacc = next(u for u in users if u["username"] == "vacc1")
    assert client.delete(f"/api/v1/users/{vacc['id']}", headers=admin).status_code == 409


# ---------- catalog + suggestions ----------

def test_catalog_and_suggestions(client, world):
    h = _h(client, "vacc1")
    cat = client.get("/api/v1/aefi/catalog", headers=h).json()
    assert {s["key"] for s in cat["severities"]} == {"mild", "moderate", "severe"}
    sug = client.get("/api/v1/aefi/suggest", params={"event_type": "anaphylaxis", "severity": "severe"}, headers=h).json()
    assert "epinephrine_im" in sug["actions"] and sug["report_timeline"] == "24h"
    assert client.get("/api/v1/aefi/suggest", params={"event_type": "nope", "severity": "mild"}, headers=h).status_code == 400


# ---------- dashboard ----------

def test_dashboard_counts_aefi_within_scope(client, world):
    h = _h(client, "vacc1")
    client.post("/api/v1/aefi", json=_payload(world), headers=h)
    client.post("/api/v1/aefi", json=_payload(world, event_type="anaphylaxis", severity="severe", serious_criteria=["hospitalization"]), headers=h)
    client.post("/api/v1/aefi", json=_payload(world, child_id=world["c2"], vaccination_event_ids=[world["v_c2"]]), headers=_h(client, "admin"))
    mine = client.get("/api/v1/dashboard", headers=h).json()
    assert mine["aefi_total"] == 2 and mine["aefi_serious"] == 1 and mine["aefi_serious_awaiting_report"] == 1
    assert mine["aefi_by_severity"] == {"mild": 1, "moderate": 0, "severe": 1}
    assert client.get("/api/v1/dashboard", headers=_h(client, "natl")).json()["aefi_total"] == 3


# ---------- reports ----------

def test_generated_report_lists_every_dose_of_each_antigen_including_zero(client, world):
    report = client.get(
        "/api/v1/reports/generate", params={"level": "facility", "unit_id": world["f1"]}, headers=_h(client, "admin")
    ).json()
    rows = {(r["antigen"], r["dose_number"]): r["doses_given"] for r in report["doses_by_dose"]}
    assert rows == {("BCG", 1): 1, ("OPV", 1): 1, ("OPV", 2): 0}
    totals = {r["antigen"]: r["doses_given"] for r in report["doses_by_vaccine"]}
    assert totals == {"BCG": 1, "OPV": 1}
    assert report["doses_given_total"] == 2


def test_generated_report_antigen_filter_limits_the_per_dose_rows(client, world):
    report = client.get(
        "/api/v1/reports/generate", params={"level": "facility", "unit_id": world["f1"], "antigens": ["OPV"]}, headers=_h(client, "admin")
    ).json()
    assert {(r["antigen"], r["dose_number"]) for r in report["doses_by_dose"]} == {("OPV", 1), ("OPV", 2)}


def test_generated_report_includes_aefi_summary_filtered_by_vaccine(client, world):
    admin = _h(client, "admin")
    client.post("/api/v1/aefi", json=_payload(world, event_type="fever", severity="mild"), headers=admin)
    client.post(
        "/api/v1/aefi",
        json=_payload(world, event_type="anaphylaxis", severity="severe", serious_criteria=["hospitalization"], vaccination_event_ids=[world["v_bcg"], world["v_opv1"]]),
        headers=admin,
    )
    params = {"level": "facility", "unit_id": world["f1"]}
    everything = client.get("/api/v1/reports/generate", params=params, headers=admin).json()["aefi"]
    assert everything["total"] == 2 and everything["mild"] == 1 and everything["severe"] == 1
    assert everything["serious"] == 1 and everything["serious_awaiting_report"] == 1
    assert {r["event_type"] for r in everything["by_event_type"]} == {"fever", "anaphylaxis"}
    bcg_only = client.get("/api/v1/reports/generate", params={**params, "antigens": ["BCG"]}, headers=admin).json()["aefi"]
    assert bcg_only["total"] == 2
    opv_only = client.get("/api/v1/reports/generate", params={**params, "antigens": ["OPV"]}, headers=admin).json()["aefi"]
    assert opv_only["total"] == 1  # only the anaphylaxis event was linked to OPV
    assert {r["antigen"]: r["count"] for r in everything["by_antigen"]} == {"BCG": 2, "OPV": 1}


def test_aefi_period_filter_uses_onset_date(client, world):
    admin = _h(client, "admin")
    client.post("/api/v1/aefi", json=_payload(world, onset_date=str(date.today() - timedelta(days=2))), headers=admin)
    params = {"level": "facility", "unit_id": world["f1"]}
    later = client.get("/api/v1/reports/generate", params={**params, "start_date": str(date.today() - timedelta(days=1))}, headers=admin).json()
    assert later["aefi"]["total"] == 0
    inside = client.get("/api/v1/reports/generate", params={**params, "start_date": str(date.today() - timedelta(days=5))}, headers=admin).json()
    assert inside["aefi"]["total"] == 1


def test_aggregate_report_has_an_aefi_column(client, world):
    client.post("/api/v1/aefi", json=_payload(world), headers=_h(client, "admin"))
    data = client.get("/api/v1/reports/aggregate", params={"group_by": "facility"}, headers=_h(client, "admin")).json()
    by_label = {r["label"]: r for r in data["rows"]}
    assert by_label["F1"]["aefi_events"] == 1
    assert data["totals"]["aefi_events"] == 1


def test_vaccination_summary_splits_by_dose_number(client, world):
    data = client.get("/api/v1/reports/vaccinations-summary", headers=_h(client, "admin")).json()
    assert {(r["antigen"], r["dose_number"]) for r in data["rows"]} == {("BCG", 1), ("OPV", 1)}
