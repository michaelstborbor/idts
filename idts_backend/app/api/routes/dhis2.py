"""
DHIS2 integration endpoints (system administrators only): connection,
facility and dose mapping, preview, download and sending of monthly
immunization data. See app/services/dhis2.py for how values are built.
"""

import json
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.deps import require_role
from app.db.session import get_db
from app.models.child import ScheduleEntry
from app.models.dhis2 import Dhis2Export
from app.models.user import Facility, User
from app.services import audit, dhis2
from app.services.dhis2 import Dhis2Error
from app.services.schedule_service import get_active_schedule_entries

router = APIRouter(prefix="/api/v1/admin/dhis2", tags=["dhis2"])
admin_only = require_role("system_admin")


def _bad_gateway(exc: Dhis2Error) -> HTTPException:
    return HTTPException(status_code=502, detail=str(exc))


class ConnectionIn(BaseModel):
    base_url: str = Field(max_length=300)
    auth_type: Literal["token", "basic"] = "token"
    username: Optional[str] = Field(default=None, max_length=100)
    secret: Optional[str] = Field(default=None, max_length=500)  # blank keeps the saved one
    data_set_uid: Optional[str] = Field(default=None, max_length=11)
    data_set_name: Optional[str] = Field(default=None, max_length=230)


class OrgUnitTarget(BaseModel):
    id: Optional[str] = None
    name: Optional[str] = None


class DoseTarget(BaseModel):
    data_element: Optional[str] = None
    data_element_name: Optional[str] = None
    coc: Optional[str] = None
    coc_name: Optional[str] = None
    coc_over1: Optional[str] = None
    coc_over1_name: Optional[str] = None


class PushIn(BaseModel):
    period: str
    dry_run: bool = False


def _export_out(row: Dhis2Export, users: dict) -> dict:
    return {
        "id": str(row.id), "created_at": row.created_at.isoformat(), "period": row.period,
        "dry_run": row.dry_run, "status": row.status, "values_sent": row.values_sent,
        "imported": row.imported, "updated": row.updated, "ignored": row.ignored,
        "message": row.message, "conflicts": row.conflicts or [],
        "by": users.get(row.user_id),
    }


@router.get("/config")
def get_config(db: Session = Depends(get_db), _: User = Depends(admin_only)):
    mapping = dhis2.get_mapping(db)
    facilities = db.query(Facility).filter(Facility.is_active.is_(True)).order_by(Facility.name).all()
    entries = get_active_schedule_entries(db)
    history = db.query(Dhis2Export).order_by(Dhis2Export.created_at.desc()).limit(20).all()
    users = {u.id: u.full_name for u in db.query(User).filter(User.id.in_([h.user_id for h in history if h.user_id])).all()} if history else {}
    return {
        "connection": dhis2.public_connection(db),
        "facilities": [
            {"id": str(f.id), "name": f.name, "org_unit": mapping["org_units"].get(str(f.id))}
            for f in facilities
        ],
        "doses": [
            {"id": str(e.id), "antigen": e.antigen, "dose_number": e.dose_number,
             "mapping": mapping["doses"].get(str(e.id))}
            for e in entries
        ],
        "history": [_export_out(h, users) for h in history],
    }


@router.put("/connection")
def save_connection(payload: ConnectionIn, request: Request, db: Session = Depends(get_db), user: User = Depends(admin_only)):
    before = dhis2.public_connection(db)
    if not payload.secret and not before["has_secret"]:
        raise HTTPException(status_code=400, detail="Enter the access token or password.")
    try:
        dhis2.set_connection(db, payload.model_dump(), user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    after = dhis2.public_connection(db)
    changed = {k for k in ("base_url", "auth_type", "username", "data_set_uid") if before.get(k) != after.get(k)}
    if payload.secret:
        changed.add("secret")
    audit.record(db, user, "update", "dhis2", None, "Updated DHIS2 connection",
                 before={k: before.get(k) for k in changed if k != "secret"},
                 after={**{k: after.get(k) for k in changed if k != "secret"}, **({"secret": "changed"} if "secret" in changed else {})},
                 request=request)
    db.commit()
    return after


@router.post("/test")
def test_connection(db: Session = Depends(get_db), _: User = Depends(admin_only)):
    try:
        return dhis2.test_connection(db)
    except Dhis2Error as exc:
        raise _bad_gateway(exc)


@router.get("/remote/org-units")
def remote_org_units(q: str = Query(min_length=2, max_length=100), db: Session = Depends(get_db), _: User = Depends(admin_only)):
    try:
        return dhis2.search_org_units(db, q.strip())
    except Dhis2Error as exc:
        raise _bad_gateway(exc)


@router.get("/mapping/org-units/suggestions")
def org_unit_suggestions(db: Session = Depends(get_db), _: User = Depends(admin_only)):
    linked = dhis2.get_mapping(db)["org_units"]
    facilities = [f for f in db.query(Facility).filter(Facility.is_active.is_(True)).order_by(Facility.name).all()
                  if str(f.id) not in linked]
    try:
        return dhis2.suggest_org_units(db, facilities)
    except Dhis2Error as exc:
        raise _bad_gateway(exc)


@router.get("/remote/data-sets")
def remote_data_sets(db: Session = Depends(get_db), _: User = Depends(admin_only)):
    try:
        return dhis2.list_data_sets(db)
    except Dhis2Error as exc:
        raise _bad_gateway(exc)


@router.get("/remote/data-elements")
def remote_data_elements(db: Session = Depends(get_db), _: User = Depends(admin_only)):
    uid = dhis2.get_connection(db).get("data_set_uid")
    try:
        return dhis2.data_set_elements(db, uid)
    except Dhis2Error as exc:
        raise _bad_gateway(exc)


@router.put("/mapping/org-units")
def save_org_units(items: dict[str, Optional[OrgUnitTarget]], request: Request,
                   db: Session = Depends(get_db), user: User = Depends(admin_only)):
    known = {str(f.id): f.name for f in db.query(Facility).all()}
    unknown = [k for k in items if k not in known]
    if unknown:
        raise HTTPException(status_code=400, detail="Unknown facility in mapping.")
    before = dhis2.get_mapping(db)["org_units"]
    try:
        mapping = dhis2.set_org_unit_mapping(db, {k: (v.model_dump() if v else None) for k, v in items.items()}, user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    after = mapping["org_units"]
    changed = [k for k in items if (before.get(k) or {}).get("id") != (after.get(k) or {}).get("id")]
    if changed:
        audit.record(db, user, "update", "dhis2", None, f"Mapped {len(changed)} facilit{'y' if len(changed) == 1 else 'ies'} to DHIS2",
                     before={known[k]: (before.get(k) or {}).get("id") for k in changed},
                     after={known[k]: (after.get(k) or {}).get("id") for k in changed}, request=request)
    db.commit()
    return mapping


@router.put("/mapping/doses")
def save_doses(items: dict[str, Optional[DoseTarget]], request: Request,
               db: Session = Depends(get_db), user: User = Depends(admin_only)):
    entries = {str(e.id): f"{e.antigen} dose {e.dose_number}" for e in db.query(ScheduleEntry).all()}
    if any(k not in entries for k in items):
        raise HTTPException(status_code=400, detail="Unknown dose in mapping.")
    before = dhis2.get_mapping(db)["doses"]
    try:
        mapping = dhis2.set_dose_mapping(db, {k: (v.model_dump() if v else None) for k, v in items.items()}, user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    after = mapping["doses"]

    def ids(m):
        return None if not m else f"{m.get('data_element')}/{m.get('coc') or '-'}/{m.get('coc_over1') or '-'}"

    changed = [k for k in items if ids(before.get(k)) != ids(after.get(k))]
    if changed:
        audit.record(db, user, "update", "dhis2", None, f"Mapped {len(changed)} dose{'' if len(changed) == 1 else 's'} to DHIS2 data elements",
                     before={entries[k]: ids(before.get(k)) for k in changed},
                     after={entries[k]: ids(after.get(k)) for k in changed}, request=request)
    db.commit()
    return mapping


@router.get("/export/preview")
def preview(period: str, db: Session = Depends(get_db), _: User = Depends(admin_only)):
    try:
        return dhis2.build_export(db, period)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/export/download")
def download(period: str, request: Request, db: Session = Depends(get_db), user: User = Depends(admin_only)):
    """The same data value set as a JSON file, for importing by hand in
    DHIS2 (Import/Export app) where IDTS can't reach DHIS2 directly."""
    try:
        export = dhis2.build_export(db, period)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    audit.record(db, user, "export", "dhis2", None, f"Downloaded DHIS2 data for {period}", request=request)
    db.commit()
    return Response(
        content=json.dumps(export["payload"], indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="idts-dhis2-{period}.json"'},
    )


@router.post("/export/push")
def push(payload: PushIn, request: Request, db: Session = Depends(get_db), user: User = Depends(admin_only)):
    try:
        result = dhis2.push_export(db, payload.period, payload.dry_run)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Dhis2Error as exc:
        db.add(Dhis2Export(user_id=user.id, period=payload.period, dry_run=payload.dry_run,
                           status="error", message=str(exc)[:500]))
        audit.record(db, user, "export", "dhis2", None,
                     f"{'Test send' if payload.dry_run else 'Send'} to DHIS2 for {payload.period} failed", request=request)
        db.commit()
        raise _bad_gateway(exc)

    row = Dhis2Export(
        user_id=user.id, period=payload.period, dry_run=payload.dry_run, status=result["status"],
        values_sent=result["values_sent"], imported=result["imported"], updated=result["updated"],
        ignored=result["ignored"], message=(result["message"] or "")[:500], conflicts=result["conflicts"],
    )
    db.add(row)
    audit.record(db, user, "export", "dhis2", None,
                 f"{'Test sent' if payload.dry_run else 'Sent'} {result['values_sent']} values to DHIS2 for {payload.period}: "
                 f"{result['imported']} new, {result['updated']} updated, {result['ignored']} ignored",
                 request=request)
    db.commit()
    db.refresh(row)
    out = _export_out(row, {user.id: user.full_name})
    out["export"] = {k: v for k, v in result["export"].items() if k != "payload"}
    return out
