"""
Admin features: activity log, sign-in lockout, security and system
settings. Reuses the isolated in-memory DB and client fixtures from
test_api_integration.
"""

import uuid

from app.core.security import hash_password
from app.models.child import ImmunizationSchedule, ScheduleEntry
from app.models.user import Facility, User
from tests.test_api_integration import TestSessionLocal, client, setup_db  # noqa: F401


def _seed_users():
    db = TestSessionLocal()
    facility = Facility(id=uuid.uuid4(), name="Admin Test Facility", facility_type="chc")
    db.add(facility)
    db.add(User(id=uuid.uuid4(), full_name="Admin Person", username="admin",
                hashed_password=hash_password("adminpass123"), role="system_admin"))
    db.add(User(id=uuid.uuid4(), full_name="Focal Person", username="focal",
                hashed_password=hash_password("focalpass123"), role="facility_focal_person", facility_id=facility.id))
    schedule = ImmunizationSchedule(id=uuid.uuid4(), name="Test", is_active=True)
    db.add(schedule)
    db.add(ScheduleEntry(id=uuid.uuid4(), schedule_id=schedule.id, antigen="BCG", dose_number=1,
                         recommended_age_days=0, minimum_age_days=0))
    db.commit()
    db.close()


def _login(client, username, password):
    return client.post("/api/v1/auth/login", data={"username": username, "password": password})


def _admin_headers(client):
    token = _login(client, "admin", "adminpass123").json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_sign_ins_are_logged_and_admin_only(client):
    _seed_users()
    assert _login(client, "focal", "wrong-password").status_code == 401
    assert _login(client, "nobody", "whatever").status_code == 401
    headers = _admin_headers(client)

    logs = client.get("/api/v1/admin/audit-logs", headers=headers).json()
    actions = [(i["action"], i["actor_username"]) for i in logs["items"]]
    assert ("login", "admin") in actions
    assert ("login_failed", "focal") in actions
    assert ("login_failed", "nobody") in actions

    focal_token = _login(client, "focal", "focalpass123").json()["access_token"]
    resp = client.get("/api/v1/admin/audit-logs", headers={"Authorization": f"Bearer {focal_token}"})
    assert resp.status_code == 403

    me = client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {focal_token}"}).json()
    assert me["last_login_at"] is not None


def test_lockout_after_repeated_failures_and_admin_unlock(client):
    _seed_users()
    headers = _admin_headers(client)
    resp = client.put("/api/v1/admin/settings/security", headers=headers,
                      json={"max_failed_logins": 3, "lockout_minutes": 10})
    assert resp.status_code == 200 and resp.json()["max_failed_logins"] == 3

    for _ in range(3):
        assert _login(client, "focal", "bad-password").status_code == 401
    # Locked now, even with the right password.
    assert _login(client, "focal", "focalpass123").status_code == 423

    focal = next(u for u in client.get("/api/v1/users?include_inactive=true", headers=headers).json() if u["username"] == "focal")
    assert focal["locked_until"] is not None
    assert client.post(f"/api/v1/users/{focal['id']}/unlock", headers=headers).status_code == 200
    assert _login(client, "focal", "focalpass123").status_code == 200


def test_security_settings_validate_ranges_and_password_length(client):
    _seed_users()
    headers = _admin_headers(client)
    assert client.put("/api/v1/admin/settings/security", headers=headers,
                      json={"password_min_length": 4}).status_code == 400
    assert client.put("/api/v1/admin/settings/security", headers=headers,
                      json={"password_min_length": 12}).status_code == 200

    resp = client.post("/api/v1/users", headers=headers, json={
        "full_name": "Short Pass", "username": "shortpass", "password": "tenchars10", "role": "vaccinator",
    })
    assert resp.status_code == 400 and "12" in resp.json()["detail"]
    resp = client.post("/api/v1/users", headers=headers, json={
        "full_name": "Long Pass", "username": "longpass", "password": "twelve-chars-ok", "role": "vaccinator",
    })
    assert resp.status_code == 201

    entities = {i["entity"] for i in client.get("/api/v1/admin/audit-logs", headers=headers).json()["items"]}
    assert {"security_settings", "user", "auth"} <= entities


def test_schedule_thresholds_are_per_dose_and_validated(client):
    _seed_users()
    headers = _admin_headers(client)
    rows = client.get("/api/v1/admin/schedule-thresholds", headers=headers).json()
    assert len(rows) == 1 and rows[0]["defaulter_threshold_days"] == 30
    entry_id = rows[0]["id"]

    # Defaulter threshold must exceed due-soon + overdue windows.
    bad = client.put("/api/v1/admin/schedule-thresholds", headers=headers, json=[
        {"id": entry_id, "due_soon_window_days": 10, "overdue_window_days": 20, "defaulter_threshold_days": 25},
    ])
    assert bad.status_code == 400

    ok = client.put("/api/v1/admin/schedule-thresholds", headers=headers, json=[
        {"id": entry_id, "due_soon_window_days": 7, "overdue_window_days": 14, "defaulter_threshold_days": 45},
    ])
    assert ok.status_code == 200 and ok.json()[0]["defaulter_threshold_days"] == 45
    logs = client.get("/api/v1/admin/audit-logs?entity=system_settings", headers=headers).json()
    assert logs["items"][0]["after"]["defaulter_threshold_days"] == 45


def test_system_settings_and_public_branding(client):
    _seed_users()
    headers = _admin_headers(client)
    ok = client.put("/api/v1/admin/settings/system", headers=headers, json={"programme_name": "EPI Karene"})
    assert ok.status_code == 200 and ok.json()["programme_name"] == "EPI Karene"
    assert client.get("/api/v1/settings/public").json()["programme_name"] == "EPI Karene"
    focal_token = _login(client, "focal", "focalpass123").json()["access_token"]
    assert client.put("/api/v1/admin/settings/system", json={"programme_name": "x"},
                      headers={"Authorization": f"Bearer {focal_token}"}).status_code == 403


def test_activity_log_filters_and_export(client):
    _seed_users()
    headers = _admin_headers(client)
    _login(client, "focal", "wrong")
    failed = client.get("/api/v1/admin/audit-logs?action=login_failed", headers=headers).json()
    assert failed["total"] == 1 and failed["items"][0]["actor_username"] == "focal"
    searched = client.get("/api/v1/admin/audit-logs?q=focal", headers=headers).json()
    assert searched["total"] >= 1

    resp = client.get("/api/v1/admin/audit-logs/export", headers=headers)
    assert resp.status_code == 200
    assert resp.text.splitlines()[0].startswith("timestamp_utc,username")
    info = client.get("/api/v1/admin/system-info", headers=headers).json()
    assert info["users_active"] == 2 and info["schedule_entries"] == 1
