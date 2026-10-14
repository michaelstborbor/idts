"""
DHIS2 interoperability: sends monthly immunization counts from IDTS to a
DHIS2 instance (the national HMIS) as an aggregate data value set.

How it fits together:
  - Connection: DHIS2 address plus a personal access token (preferred) or
    a username and password. The secret is encrypted at rest with a key
    derived from IDTS_SECRET_KEY and never returned by the API.
  - Mapping: each IDTS facility -> a DHIS2 organisation unit, and each
    schedule dose -> a DHIS2 data element and category option combo
    (optionally a second combo for children vaccinated at 12 months or
    older, the usual "<1y / 1y+" EPI disaggregation).
  - Export: doses given in a month are counted per facility and dose,
    turned into dataValues, and posted to /api/dataValueSets. Every send
    is kept in dhis2_exports with the import summary DHIS2 returns.
"""

import base64
import hashlib
import re
from calendar import monthrange
from datetime import date
from typing import Any, Optional

import httpx
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.orm import Session

from app.core.security import SECRET_KEY
from app.models.child import Child, ScheduleEntry, VaccinationEvent
from app.models.user import Facility, User
from app.services.settings_service import _get, _set

CONNECTION_KEY = "dhis2_connection"
MAPPING_KEY = "dhis2_mapping"
UID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9]{10}$")
PERIOD_RE = re.compile(r"^(\d{4})(0[1-9]|1[0-2])$")
TIMEOUT = httpx.Timeout(30.0, connect=10.0)

# Tests swap this for an httpx.MockTransport; None means real network.
TRANSPORT: Optional[httpx.BaseTransport] = None


class Dhis2Error(Exception):
    """A problem talking to DHIS2, worded for an administrator."""


# ---------------------------------------------------------------- secrets

def _fernet() -> Fernet:
    key = hashlib.sha256(f"idts-dhis2:{SECRET_KEY}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def _encrypt(secret: str) -> str:
    return _fernet().encrypt(secret.encode()).decode()


def _decrypt(token: Optional[str]) -> Optional[str]:
    if not token:
        return None
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        # IDTS_SECRET_KEY changed since the secret was saved.
        return None


# ---------------------------------------------------------------- settings

def normalize_base_url(url: str) -> str:
    url = (url or "").strip().rstrip("/")
    if url.endswith("/api"):
        url = url[: -len("/api")]
    if not re.match(r"^https?://[^\s/]+", url):
        raise ValueError("Enter the DHIS2 address starting with https://")
    return url


def get_connection(db: Session) -> dict[str, Any]:
    return dict(_get(db, CONNECTION_KEY, {}))


def public_connection(db: Session) -> dict[str, Any]:
    conn = get_connection(db)
    return {
        "base_url": conn.get("base_url", ""),
        "auth_type": conn.get("auth_type", "token"),
        "username": conn.get("username", ""),
        "data_set_uid": conn.get("data_set_uid", ""),
        "data_set_name": conn.get("data_set_name", ""),
        "has_secret": bool(conn.get("secret_enc")) and _decrypt(conn.get("secret_enc")) is not None,
        "secret_unreadable": bool(conn.get("secret_enc")) and _decrypt(conn.get("secret_enc")) is None,
    }


def set_connection(db: Session, values: dict[str, Any], user: User) -> dict[str, Any]:
    conn = get_connection(db)
    conn["base_url"] = normalize_base_url(values["base_url"])
    conn["auth_type"] = values.get("auth_type") or "token"
    conn["username"] = (values.get("username") or "").strip()
    conn["data_set_uid"] = (values.get("data_set_uid") or "").strip()
    conn["data_set_name"] = (values.get("data_set_name") or "").strip()
    if conn["data_set_uid"] and not UID_RE.match(conn["data_set_uid"]):
        raise ValueError("The data set id doesn't look like a DHIS2 id (11 letters and digits).")
    if values.get("secret"):
        conn["secret_enc"] = _encrypt(values["secret"])
    if conn["auth_type"] == "basic" and not conn["username"]:
        raise ValueError("Enter the DHIS2 username.")
    _set(db, CONNECTION_KEY, conn, user)
    db.flush()
    return conn


def get_mapping(db: Session) -> dict[str, Any]:
    mapping = dict(_get(db, MAPPING_KEY, {}))
    mapping.setdefault("org_units", {})
    mapping.setdefault("doses", {})
    return mapping


def set_org_unit_mapping(db: Session, items: dict[str, Optional[dict]], user: User) -> dict[str, Any]:
    mapping = get_mapping(db)
    org_units = dict(mapping["org_units"])
    for facility_id, target in items.items():
        if not target or not target.get("id"):
            org_units.pop(facility_id, None)
            continue
        if not UID_RE.match(target["id"]):
            raise ValueError(f"'{target['id']}' isn't a valid DHIS2 organisation unit id.")
        org_units[facility_id] = {"id": target["id"], "name": target.get("name") or ""}
    mapping["org_units"] = org_units
    _set(db, MAPPING_KEY, mapping, user)
    db.flush()
    return mapping


def set_dose_mapping(db: Session, items: dict[str, Optional[dict]], user: User) -> dict[str, Any]:
    mapping = get_mapping(db)
    doses = dict(mapping["doses"])
    for entry_id, target in items.items():
        if not target or not target.get("data_element"):
            doses.pop(entry_id, None)
            continue
        clean = {}
        for key in ("data_element", "coc", "coc_over1"):
            value = (target.get(key) or "").strip()
            if value and not UID_RE.match(value):
                raise ValueError(f"'{value}' isn't a valid DHIS2 id.")
            clean[key] = value or None
            clean[f"{key}_name"] = target.get(f"{key}_name") or ""
        doses[entry_id] = clean
    mapping["doses"] = doses
    _set(db, MAPPING_KEY, mapping, user)
    db.flush()
    return mapping


# ---------------------------------------------------------------- HTTP

def _client(db: Session) -> httpx.Client:
    conn = get_connection(db)
    if not conn.get("base_url"):
        raise Dhis2Error("Add the DHIS2 address and credentials first.")
    secret = _decrypt(conn.get("secret_enc"))
    if not secret:
        raise Dhis2Error("The saved DHIS2 password or token can't be read. Enter it again.")
    headers = {"Accept": "application/json"}
    auth = None
    if conn.get("auth_type") == "basic":
        auth = (conn.get("username", ""), secret)
    else:
        headers["Authorization"] = f"ApiToken {secret}"
    return httpx.Client(
        base_url=f"{conn['base_url']}/api", headers=headers, auth=auth,
        timeout=TIMEOUT, transport=TRANSPORT, follow_redirects=False,
    )


def _call(db: Session, method: str, path: str, *, ok_statuses=(200,), **kwargs) -> Any:
    try:
        with _client(db) as client:
            resp = client.request(method, path, **kwargs)
    except httpx.TimeoutException:
        raise Dhis2Error("DHIS2 didn't answer in time. Check the address, or try again later.")
    except httpx.HTTPError as exc:
        raise Dhis2Error(f"Couldn't reach DHIS2 at that address ({exc.__class__.__name__}).")
    if resp.status_code in (401, 403):
        raise Dhis2Error("DHIS2 refused the sign-in. Check the username and password, or the access token and its permissions.")
    if resp.status_code in (301, 302, 303, 307, 308):
        raise Dhis2Error("DHIS2 redirected the request. Use the full address, including https:// and any path such as /dhis.")
    if resp.status_code == 404:
        raise Dhis2Error("Not found on DHIS2. Check the address, and that the id exists on that server.")
    try:
        body = resp.json()
    except ValueError:
        raise Dhis2Error("The address answered, but not like a DHIS2 server.")
    if resp.status_code not in ok_statuses:
        message = body.get("message") if isinstance(body, dict) else None
        raise Dhis2Error(f"DHIS2 returned an error ({resp.status_code}){': ' + message if message else ''}.")
    return body


def test_connection(db: Session) -> dict[str, Any]:
    info = _call(db, "GET", "/system/info")
    me = _call(db, "GET", "/me", params={"fields": "username,displayName,authorities"})
    authorities = set(me.get("authorities") or [])
    can_write = "ALL" in authorities or "F_DATAVALUE_ADD" in authorities
    return {
        "version": info.get("version"),
        "server_name": info.get("systemName") or info.get("serverName") or "",
        "username": me.get("username"),
        "display_name": me.get("displayName"),
        "can_send_data": can_write,
    }


def search_org_units(db: Session, query: str) -> list[dict[str, Any]]:
    params = {"fields": "id,displayName,level,parent[displayName]", "pageSize": 25, "order": "displayName:asc"}
    if UID_RE.match(query or ""):
        params["filter"] = f"id:eq:{query}"
    else:
        params["filter"] = f"displayName:ilike:{query}"
    body = _call(db, "GET", "/organisationUnits", params=params)
    return [
        {"id": ou["id"], "name": ou.get("displayName", ""), "level": ou.get("level"),
         "parent": (ou.get("parent") or {}).get("displayName", "")}
        for ou in body.get("organisationUnits", [])
    ]


def _norm(name: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).split())


def suggest_org_units(db: Session, facilities: list[Facility]) -> list[dict[str, Any]]:
    """
    Proposes a DHIS2 organisation unit for each facility whose name matches
    exactly one unit's name (ignoring case and punctuation). One request
    for the whole hierarchy instead of a search per facility.
    """
    body = _call(db, "GET", "/organisationUnits", params={
        "fields": "id,displayName,level,parent[displayName]", "paging": "false",
    })
    by_name: dict[str, list[dict]] = {}
    for ou in body.get("organisationUnits", []):
        by_name.setdefault(_norm(ou.get("displayName", "")), []).append(ou)
    out = []
    for facility in facilities:
        matches = by_name.get(_norm(facility.name), [])
        if len(matches) == 1:
            ou = matches[0]
            out.append({
                "facility_id": str(facility.id), "facility": facility.name,
                "id": ou["id"], "name": ou.get("displayName", ""),
                "parent": (ou.get("parent") or {}).get("displayName", ""),
            })
    return out


def list_data_sets(db: Session) -> list[dict[str, Any]]:
    body = _call(db, "GET", "/dataSets", params={"fields": "id,displayName,periodType", "paging": "false"})
    return [{"id": d["id"], "name": d.get("displayName", ""), "period_type": d.get("periodType")}
            for d in body.get("dataSets", [])]


def data_set_elements(db: Session, data_set_uid: str) -> list[dict[str, Any]]:
    if not UID_RE.match(data_set_uid or ""):
        raise Dhis2Error("Choose a data set first.")
    body = _call(db, "GET", f"/dataSets/{data_set_uid}", params={
        "fields": "dataSetElements[dataElement[id,displayName,categoryCombo[categoryOptionCombos[id,displayName]]]]",
    })
    out = []
    for dse in body.get("dataSetElements", []):
        de = dse.get("dataElement") or {}
        combos = ((de.get("categoryCombo") or {}).get("categoryOptionCombos")) or []
        out.append({
            "id": de.get("id"), "name": de.get("displayName", ""),
            "category_option_combos": [{"id": c["id"], "name": c.get("displayName", "")} for c in combos],
        })
    return sorted(out, key=lambda d: d["name"].lower())


# ---------------------------------------------------------------- export

def parse_period(period: str) -> tuple[date, date]:
    match = PERIOD_RE.match(period or "")
    if not match:
        raise ValueError("Choose a month (period format YYYYMM).")
    year, month = int(match.group(1)), int(match.group(2))
    start = date(year, month, 1)
    end = date(year, month, monthrange(year, month)[1])
    if start > date.today():
        raise ValueError("That month hasn't started yet.")
    return start, end


def build_export(db: Session, period: str) -> dict[str, Any]:
    """
    Counts doses given in the month at each facility, split by the age of
    the child on the day (under 12 months / 12 months and older), and turns
    them into DHIS2 dataValues using the saved mapping. Doses that can't be
    mapped are reported, not silently dropped.
    """
    start, end = parse_period(period)
    mapping = get_mapping(db)
    conn = get_connection(db)
    facilities = {str(f.id): f.name for f in db.query(Facility).all()}
    entries = {str(e.id): e for e in db.query(ScheduleEntry).all()}

    events = (
        db.query(VaccinationEvent.facility_id, VaccinationEvent.schedule_entry_id, VaccinationEvent.event_date, Child.dob)
        .join(Child, Child.id == VaccinationEvent.child_id)
        .filter(VaccinationEvent.event_date >= start, VaccinationEvent.event_date <= end, Child.deleted_at.is_(None))
        .all()
    )

    counts: dict[tuple[str, str, bool], int] = {}
    for facility_id, entry_id, event_date, dob in events:
        over1 = (event_date - dob).days >= 365
        key = (str(facility_id), str(entry_id), over1)
        counts[key] = counts.get(key, 0) + 1

    values: dict[tuple[str, str, str], int] = {}
    rows = []
    unmapped_facilities: dict[str, int] = {}
    unmapped_doses: dict[str, int] = {}
    for (facility_id, entry_id, over1), count in sorted(counts.items()):
        entry = entries.get(entry_id)
        dose_label = f"{entry.antigen} dose {entry.dose_number}" if entry else "Unknown dose"
        org_unit = mapping["org_units"].get(facility_id)
        dose_map = mapping["doses"].get(entry_id)
        row = {
            "facility_id": facility_id, "facility": facilities.get(facility_id, "Unknown facility"),
            "schedule_entry_id": entry_id, "dose": dose_label, "age_group": "12 months+" if over1 else "Under 12 months",
            "count": count, "org_unit": org_unit["id"] if org_unit else None,
            "data_element": None, "category_option_combo": None, "status": "ok",
        }
        if not org_unit:
            row["status"] = "facility_not_mapped"
            unmapped_facilities[row["facility"]] = unmapped_facilities.get(row["facility"], 0) + count
        elif not dose_map or not dose_map.get("data_element"):
            row["status"] = "dose_not_mapped"
            unmapped_doses[dose_label] = unmapped_doses.get(dose_label, 0) + count
        else:
            coc = (dose_map.get("coc_over1") if over1 and dose_map.get("coc_over1") else dose_map.get("coc")) or ""
            row["data_element"] = dose_map["data_element"]
            row["data_element_name"] = dose_map.get("data_element_name") or ""
            row["category_option_combo"] = coc or None
            key = (dose_map["data_element"], coc, org_unit["id"])
            values[key] = values.get(key, 0) + count
        rows.append(row)

    data_values = []
    for (data_element, coc, org_unit), value in sorted(values.items()):
        dv = {"dataElement": data_element, "period": period, "orgUnit": org_unit, "value": str(value)}
        if coc:
            dv["categoryOptionCombo"] = coc
        data_values.append(dv)

    payload: dict[str, Any] = {"dataValues": data_values}
    if conn.get("data_set_uid"):
        payload["dataSet"] = conn["data_set_uid"]

    return {
        "period": period,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "doses_counted": sum(counts.values()),
        "doses_mappable": sum(values.values()),
        "rows": rows,
        "unmapped_facilities": [{"name": k, "doses": v} for k, v in sorted(unmapped_facilities.items())],
        "unmapped_doses": [{"name": k, "doses": v} for k, v in sorted(unmapped_doses.items())],
        "payload": payload,
    }


def _summary(body: Any) -> dict[str, Any]:
    """Reads an import summary from DHIS2 2.36 and older (top level) or
    2.38+ (wrapped in "response")."""
    summary = body.get("response") if isinstance(body, dict) and isinstance(body.get("response"), dict) else body
    summary = summary if isinstance(summary, dict) else {}
    counts = summary.get("importCount") or {}
    status = (summary.get("status") or body.get("status") or "").upper()
    conflicts = [
        {"object": c.get("object"), "value": c.get("value")}
        for c in (summary.get("conflicts") or [])
    ][:50]
    return {
        "status": "success" if status in ("SUCCESS", "OK") and not conflicts else ("error" if status == "ERROR" else "warning"),
        "imported": int(counts.get("imported", 0)),
        "updated": int(counts.get("updated", 0)),
        "ignored": int(counts.get("ignored", 0)),
        "message": summary.get("description") or body.get("message") or "",
        "conflicts": conflicts,
    }


def push_export(db: Session, period: str, dry_run: bool) -> dict[str, Any]:
    export = build_export(db, period)
    if not export["payload"]["dataValues"]:
        raise Dhis2Error("Nothing to send for that month: no mapped doses were given.")
    body = _call(
        db, "POST", "/dataValueSets",
        params={"dryRun": "true" if dry_run else "false", "importStrategy": "CREATE_AND_UPDATE"},
        json=export["payload"],
        ok_statuses=(200, 201, 409),  # 2.38+ answers 409 with an import summary when some values conflict
    )
    result = _summary(body)
    result["values_sent"] = len(export["payload"]["dataValues"])
    result["export"] = export
    return result
