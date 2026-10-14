"""
Offline data entry: entries made on a device without a connection are
replayed later with client-chosen ids, so a resend must never create a
second record, and the device needs a pack of records to work from.
"""

import uuid
from datetime import date, timedelta

from tests.test_api_integration import auth_headers, client, seeded, setup_db  # noqa: F401


def test_child_registration_with_client_id_is_idempotent(client, seeded):
    headers = auth_headers(client)
    child_id = str(uuid.uuid4())
    body = {"id": child_id, "full_name": "Offline Child", "sex": "F",
            "dob": (date.today() - timedelta(days=10)).isoformat(), "facility_id": seeded["facility_id"]}

    first = client.post("/api/v1/children", json=body, headers=headers)
    assert first.status_code == 201, first.text
    assert first.json()["id"] == child_id

    again = client.post("/api/v1/children", json=body, headers=headers)
    assert again.status_code == 201
    assert again.json()["system_id"] == first.json()["system_id"]

    names = [c["full_name"] for c in client.get("/api/v1/children", headers=headers).json()]
    assert names.count("Offline Child") == 1

    # A dose recorded offline against the device-chosen id lands on that child.
    vacc = client.post(f"/api/v1/children/{child_id}/vaccinations", headers=headers, json={
        "schedule_entry_id": seeded["bcg1_id"], "event_date": date.today().isoformat(),
        "facility_id": seeded["facility_id"], "idempotency_key": "device-1-op-2",
    })
    assert vacc.status_code == 201, vacc.text


def test_tracing_attempt_keeps_offline_date_and_is_idempotent(client, seeded):
    headers = auth_headers(client)
    child = client.post("/api/v1/children", headers=headers, json={
        "full_name": "Traced Child", "sex": "M",
        "dob": (date.today() - timedelta(days=100)).isoformat(), "facility_id": seeded["facility_id"],
    }).json()
    case = client.post("/api/v1/defaulters/assign", headers=headers, json={
        "child_id": child["id"], "schedule_entry_id": seeded["bcg1_id"], "assigned_to_id": seeded["chw_id"],
    }).json()

    attempt_id = str(uuid.uuid4())
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    body = {"id": attempt_id, "attempt_date": yesterday, "method": "home_visit", "outcome": "no_answer"}
    first = client.post(f"/api/v1/defaulters/{case['id']}/trace", json=body, headers=headers)
    assert first.status_code == 201, first.text
    assert first.json()["attempt_date"] == yesterday
    assert client.post(f"/api/v1/defaulters/{case['id']}/trace", json=body, headers=headers).status_code == 201

    this_case = next(c for c in client.get("/api/v1/defaulters", headers=headers).json() if c["id"] == case["id"])
    assert len(this_case["tracing_attempts"]) == 1

    future = {"method": "phone_call", "outcome": "no_answer",
              "attempt_date": (date.today() + timedelta(days=1)).isoformat()}
    assert client.post(f"/api/v1/defaulters/{case['id']}/trace", json=future, headers=headers).status_code == 400


def test_offline_pack_has_schedule_children_and_dose_history(client, seeded):
    headers = auth_headers(client)
    child = client.post("/api/v1/children", headers=headers, json={
        "full_name": "Packed Child", "sex": "F",
        "dob": (date.today() - timedelta(days=5)).isoformat(), "facility_id": seeded["facility_id"],
    }).json()
    client.post(f"/api/v1/children/{child['id']}/vaccinations", headers=headers, json={
        "schedule_entry_id": seeded["bcg1_id"], "event_date": date.today().isoformat(),
        "facility_id": seeded["facility_id"],
    })

    pack = client.get("/api/v1/children/offline-pack", headers=headers)
    assert pack.status_code == 200, pack.text
    data = pack.json()
    assert {e["antigen"] for e in data["schedule"]} == {"BCG", "Pentavalent"}
    assert data["truncated"] is False
    packed = next(c for c in data["children"] if c["id"] == child["id"])
    assert len(packed["vaccination_history"]) == 1
    statuses = {d["antigen"]: d["status"] for d in packed["schedule"]}
    assert statuses["BCG"] == "administered"
