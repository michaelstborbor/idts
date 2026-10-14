"""
DHIS2 integration. DHIS2 itself is replaced by an httpx.MockTransport that
answers like the real Web API (system/info, me, organisationUnits,
dataSets, dataValueSets), so these tests check what IDTS sends and how it
reads the replies, not a live server.
"""

import json
import uuid
from datetime import date, timedelta

import httpx
import pytest

from app.core.security import hash_password
from app.models.user import User
from app.services import dhis2
from tests.test_api_integration import TestSessionLocal, auth_headers, client, seeded, setup_db  # noqa: F401

OU_UID = "DiszpKrYNg8"
DE_BCG = "bTcRDVjC66S"
COC_UNDER1 = "Prlt0C1RF0s"
COC_OVER1 = "V6L425pT3A0"
DS_UID = "BfMAe6Itzgt"


class FakeDhis2:
    def __init__(self):
        self.requests = []
        self.import_status = 200

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        auth = request.headers.get("Authorization", "")
        if auth != "ApiToken d2pat_secret":
            return httpx.Response(401, json={"httpStatus": "Unauthorized"})
        path = request.url.path
        if path == "/dhis/api/system/info":
            return httpx.Response(200, json={"version": "2.40.4", "systemName": "Sierra Leone HMIS"})
        if path == "/dhis/api/me":
            return httpx.Response(200, json={"username": "idts", "displayName": "IDTS integration", "authorities": ["F_DATAVALUE_ADD"]})
        if path == "/dhis/api/organisationUnits":
            return httpx.Response(200, json={"organisationUnits": [
                {"id": OU_UID, "displayName": "Test Facility CHC", "level": 4, "parent": {"displayName": "Bo"}},
                {"id": "TwinUnit001", "displayName": "TEST facility", "level": 4, "parent": {"displayName": "Bo"}}]})
        if path == f"/dhis/api/dataSets/{DS_UID}":
            return httpx.Response(200, json={"dataSetElements": [{"dataElement": {
                "id": DE_BCG, "displayName": "BCG doses given",
                "categoryCombo": {"categoryOptionCombos": [
                    {"id": COC_UNDER1, "displayName": "<1y"}, {"id": COC_OVER1, "displayName": ">1y"}]}}}]})
        if path == "/dhis/api/dataValueSets":
            body = json.loads(request.content)
            n = len(body["dataValues"])
            if self.import_status == 409:
                return httpx.Response(409, json={"httpStatus": "Conflict", "status": "WARNING", "response": {
                    "responseType": "ImportSummary", "status": "WARNING",
                    "importCount": {"imported": n - 1, "updated": 0, "ignored": 1, "deleted": 0},
                    "conflicts": [{"object": COC_OVER1, "value": "Category option combo not in data set"}]}})
            return httpx.Response(200, json={"httpStatus": "OK", "status": "OK", "response": {
                "responseType": "ImportSummary", "status": "SUCCESS",
                "importCount": {"imported": n, "updated": 0, "ignored": 0, "deleted": 0}, "conflicts": []}})
        return httpx.Response(404, json={"httpStatus": "Not Found"})


@pytest.fixture()
def fake_dhis2(monkeypatch):
    fake = FakeDhis2()
    monkeypatch.setattr(dhis2, "TRANSPORT", httpx.MockTransport(fake))
    return fake


@pytest.fixture()
def admin(client, seeded):
    db = TestSessionLocal()
    db.add(User(id=uuid.uuid4(), full_name="Admin", username="admin",
                hashed_password=hash_password("adminpass123"), role="system_admin"))
    db.commit()
    db.close()
    return auth_headers(client, "admin", "adminpass123")


def _connect(client, admin):
    resp = client.put("/api/v1/admin/dhis2/connection", headers=admin, json={
        "base_url": "https://hmis.example.org/dhis/api/", "auth_type": "token",
        "secret": "d2pat_secret", "data_set_uid": DS_UID, "data_set_name": "EPI monthly",
    })
    assert resp.status_code == 200, resp.text
    return resp.json()


def _vaccinate(client, seeded, headers, age_days, event_date):
    child = client.post("/api/v1/children", headers=headers, json={
        "full_name": f"Child {uuid.uuid4().hex[:6]}", "sex": "F",
        "dob": (event_date - timedelta(days=age_days)).isoformat(), "facility_id": seeded["facility_id"],
    }).json()
    resp = client.post(f"/api/v1/children/{child['id']}/vaccinations", headers=headers, json={
        "schedule_entry_id": seeded["bcg1_id"], "event_date": event_date.isoformat(), "facility_id": seeded["facility_id"],
    })
    assert resp.status_code == 201, resp.text


def test_connection_is_saved_without_exposing_the_secret(client, admin, fake_dhis2):
    saved = _connect(client, admin)
    assert saved["base_url"] == "https://hmis.example.org/dhis"
    assert saved["has_secret"] is True
    assert "secret" not in json.dumps(client.get("/api/v1/admin/dhis2/config", headers=admin).json()).replace("has_secret", "").replace("secret_unreadable", "")

    info = client.post("/api/v1/admin/dhis2/test", headers=admin).json()
    assert info["version"] == "2.40.4" and info["can_send_data"] is True

    # Saving again without a secret keeps the stored one.
    client.put("/api/v1/admin/dhis2/connection", headers=admin, json={"base_url": "https://hmis.example.org/dhis", "data_set_uid": DS_UID})
    assert client.post("/api/v1/admin/dhis2/test", headers=admin).status_code == 200

    client.put("/api/v1/admin/dhis2/connection", headers=admin, json={"base_url": "https://hmis.example.org/dhis", "secret": "wrong"})
    bad = client.post("/api/v1/admin/dhis2/test", headers=admin)
    assert bad.status_code == 502 and "refused the sign-in" in bad.json()["detail"]

    logs = client.get("/api/v1/admin/audit-logs", headers=admin, params={"entity": "dhis2"}).json()["items"]
    assert logs and all("d2pat_secret" not in json.dumps(item) for item in logs)


def test_non_admins_cannot_use_dhis2(client, seeded):
    resp = client.get("/api/v1/admin/dhis2/config", headers=auth_headers(client))
    assert resp.status_code == 403


def test_monthly_export_maps_counts_by_age_group_and_sends(client, seeded, admin, fake_dhis2):
    _connect(client, admin)
    focal = auth_headers(client)
    day = date.today().replace(day=1)
    _vaccinate(client, seeded, focal, 5, day)
    _vaccinate(client, seeded, focal, 10, day)
    _vaccinate(client, seeded, focal, 400, day)  # 12 months or older
    period = day.strftime("%Y%m")

    preview = client.get("/api/v1/admin/dhis2/export/preview", headers=admin, params={"period": period}).json()
    assert preview["doses_counted"] == 3
    assert preview["payload"]["dataValues"] == []
    assert preview["unmapped_facilities"] == [{"name": "Test Facility", "doses": 3}]

    found = client.get("/api/v1/admin/dhis2/remote/org-units", headers=admin, params={"q": "Test"}).json()
    assert found[0]["id"] == OU_UID
    suggestions = client.get("/api/v1/admin/dhis2/mapping/org-units/suggestions", headers=admin).json()
    assert [(x["facility"], x["id"]) for x in suggestions] == [("Test Facility", "TwinUnit001")]
    assert client.put("/api/v1/admin/dhis2/mapping/org-units", headers=admin,
                      json={seeded["facility_id"]: {"id": OU_UID, "name": "Test Facility CHC"}}).status_code == 200
    elements = client.get("/api/v1/admin/dhis2/remote/data-elements", headers=admin).json()
    assert elements[0]["category_option_combos"][0]["id"] == COC_UNDER1
    assert client.put("/api/v1/admin/dhis2/mapping/doses", headers=admin, json={
        seeded["bcg1_id"]: {"data_element": DE_BCG, "coc": COC_UNDER1, "coc_over1": COC_OVER1}}).status_code == 200
    assert client.put("/api/v1/admin/dhis2/mapping/doses", headers=admin, json={
        seeded["bcg1_id"]: {"data_element": "not-a-uid"}}).status_code == 400

    preview = client.get("/api/v1/admin/dhis2/export/preview", headers=admin, params={"period": period}).json()
    values = {(v["categoryOptionCombo"], v["value"]) for v in preview["payload"]["dataValues"]}
    assert values == {(COC_UNDER1, "2"), (COC_OVER1, "1")}
    assert preview["payload"]["dataSet"] == DS_UID
    assert all(v["orgUnit"] == OU_UID and v["period"] == period for v in preview["payload"]["dataValues"])

    dry = client.post("/api/v1/admin/dhis2/export/push", headers=admin, json={"period": period, "dry_run": True}).json()
    assert dry["status"] == "success" and dry["dry_run"] is True and dry["imported"] == 2
    assert "dryRun=true" in str(fake_dhis2.requests[-1].url)

    fake_dhis2.import_status = 409
    sent = client.post("/api/v1/admin/dhis2/export/push", headers=admin, json={"period": period}).json()
    assert sent["status"] == "warning" and sent["ignored"] == 1 and sent["conflicts"]

    history = client.get("/api/v1/admin/dhis2/config", headers=admin).json()["history"]
    assert [h["dry_run"] for h in history] == [False, True]

    download = client.get("/api/v1/admin/dhis2/export/download", headers=admin, params={"period": period})
    assert download.status_code == 200 and len(download.json()["dataValues"]) == 2


def test_export_rejects_bad_or_future_periods(client, admin):
    assert client.get("/api/v1/admin/dhis2/export/preview", headers=admin, params={"period": "2026-01"}).status_code == 400
    future = (date.today().replace(day=1) + timedelta(days=40)).strftime("%Y%m")
    assert client.get("/api/v1/admin/dhis2/export/preview", headers=admin, params={"period": future}).status_code == 400
