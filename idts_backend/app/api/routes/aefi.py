"""
Adverse Events Following Immunization (AEFI) — record, review and report.

Access follows the same scope as everything else that hangs off a child
(app/core/scope.py): a user only sees and records AEFIs for children they can
already see. Recording/editing is limited to AEFI_WRITE_ROLES; national
supervisors can view within their country but not edit.
"""

import uuid
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_role
from app.core.scope import accessible_facility_ids, ensure_child_in_scope, restrict
from app.db.base import utcnow
from app.db.session import get_db
from app.domain import aefi_catalog as cat
from app.models.aefi import AefiEvent, AefiVaccination
from app.models.child import Child, ScheduleEntry, VaccinationEvent
from app.models.defaulter import AuditLog
from app.models.user import Facility, User
from app.schemas.aefi import (
    AefiCreate,
    AefiOut,
    AefiSuggestionOut,
    AefiUpdate,
    AefiVaccinationOut,
    EligibleVaccinationOut,
)

router = APIRouter(prefix="/api/v1/aefi", tags=["aefi"])

# Who may record/edit an AEFI. National supervisors are view-only (oversight).
AEFI_WRITE_ROLES = (
    "system_admin",
    "facility_focal_person",
    "vaccinator",
    "chw",
    "facility_supervisor",
    "district_manager",
)


def _split(value: Optional[str]) -> list:
    return [v for v in (value or "").split(",") if v]


def _join(values: list) -> Optional[str]:
    return ",".join(values) if values else None


def _hours_since(created_at: datetime) -> float:
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - created_at).total_seconds() / 3600


def _task_status(is_serious: bool, done_date: Optional[date], created_at: datetime, limit_hours: int) -> str:
    if not is_serious:
        return "not_required"
    if done_date is not None:
        return "done"
    return "overdue" if _hours_since(created_at) > limit_hours else "pending"


def _build_outs(db: Session, aefis: list) -> list:
    """Turns AefiEvent rows into AefiOut with child/facility/vaccine names,
    using a handful of batched queries instead of one per record."""
    if not aefis:
        return []
    aefi_ids = [a.id for a in aefis]
    child_ids = {a.child_id for a in aefis}
    children = {c.id: c for c in db.query(Child).filter(Child.id.in_(child_ids)).all()}
    facility_ids = {c.facility_id for c in children.values()}
    facilities = {f.id: f.name for f in db.query(Facility).filter(Facility.id.in_(facility_ids)).all()} if facility_ids else {}
    user_ids = {a.recorded_by_id for a in aefis if a.recorded_by_id}
    users = {u.id: u.full_name for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}

    link_rows = (
        db.query(AefiVaccination.aefi_id, VaccinationEvent, ScheduleEntry)
        .join(VaccinationEvent, AefiVaccination.vaccination_event_id == VaccinationEvent.id)
        .join(ScheduleEntry, VaccinationEvent.schedule_entry_id == ScheduleEntry.id)
        .filter(AefiVaccination.aefi_id.in_(aefi_ids))
        .all()
    )
    vaccinations_by_aefi: dict = {}
    for aefi_id, event, entry in link_rows:
        vaccinations_by_aefi.setdefault(aefi_id, []).append(AefiVaccinationOut(
            vaccination_event_id=event.id, antigen=entry.antigen, dose_number=entry.dose_number,
            event_date=event.event_date, batch_lot_number=event.batch_lot_number,
        ))

    outs = []
    for a in aefis:
        child = children.get(a.child_id)
        outs.append(AefiOut(
            id=a.id,
            aefi_number=a.aefi_number,
            child_id=a.child_id,
            child_name=child.full_name if child else "Unknown child",
            child_system_id=child.system_id if child else "",
            facility_name=facilities.get(child.facility_id) if child else None,
            onset_date=a.onset_date,
            event_type=a.event_type,
            event_type_label=cat.EVENT_TYPE_LABELS.get(a.event_type, a.event_type),
            event_description=a.event_description,
            severity=a.severity,
            serious_criteria=_split(a.serious_criteria),
            is_serious=a.is_serious,
            part_of_cluster=a.part_of_cluster,
            cause_category=a.cause_category,
            outcome=a.outcome,
            management_actions=_split(a.management_actions),
            management_notes=a.management_notes,
            reported_date=a.reported_date,
            investigation_date=a.investigation_date,
            report_status=_task_status(a.is_serious, a.reported_date, a.created_at, cat.REPORT_WITHIN_HOURS),
            investigation_status=_task_status(a.is_serious, a.investigation_date, a.created_at, cat.INVESTIGATE_WITHIN_HOURS),
            vaccinations=sorted(vaccinations_by_aefi.get(a.id, []), key=lambda v: (v.event_date, v.antigen)),
            recorded_by_name=users.get(a.recorded_by_id),
            created_at=a.created_at,
        ))
    return outs


def _load_child_vaccinations(db: Session, child_id: uuid.UUID, ids: list) -> list:
    wanted = list(dict.fromkeys(ids))
    events = (
        db.query(VaccinationEvent)
        .filter(VaccinationEvent.id.in_(wanted), VaccinationEvent.child_id == child_id)
        .all()
    )
    if len(events) != len(wanted):
        raise HTTPException(status_code=400, detail="One or more selected vaccinations don't belong to this child.")
    return events


def _validate_dates(onset: date, events: list, reported: Optional[date], investigated: Optional[date]) -> None:
    today = date.today()
    if onset > today:
        raise HTTPException(status_code=400, detail="Onset date cannot be in the future.")
    first_dose = min(e.event_date for e in events)
    if onset < first_dose:
        raise HTTPException(
            status_code=400,
            detail=f"Onset date cannot be before the vaccination date ({first_dose.isoformat()}).",
        )
    for label, d in (("Report", reported), ("Investigation", investigated)):
        if d is not None:
            if d > today:
                raise HTTPException(status_code=400, detail=f"{label} date cannot be in the future.")
            if d < onset:
                raise HTTPException(status_code=400, detail=f"{label} date cannot be before the onset date.")


def _next_number(db: Session) -> str:
    # Same simple count-based scheme (and the same documented limitation) as
    # child system IDs — fine at pilot volume; move to a DB sequence under load.
    return f"AEFI-{db.query(AefiEvent).count() + 1:06d}"


def _audit(db: Session, user: User, action: str, aefi: AefiEvent, before=None) -> None:
    after = {
        "aefi_number": aefi.aefi_number,
        "child_id": str(aefi.child_id),
        "event_type": aefi.event_type,
        "severity": aefi.severity,
        "is_serious": aefi.is_serious,
        "outcome": aefi.outcome,
        "reported_date": aefi.reported_date,
        "investigation_date": aefi.investigation_date,
    }
    db.add(AuditLog(
        id=uuid.uuid4(), user_id=user.id, action=action, entity="aefi_event", entity_id=str(aefi.id),
        before=jsonable_encoder(before) if before else None, after=jsonable_encoder(after), timestamp=utcnow(),
        actor_username=user.username, actor_name=user.full_name,
        summary=f"{'Reported' if action == 'aefi.create' else 'Updated'} AEFI {aefi.aefi_number} ({aefi.severity}{', serious' if aefi.is_serious else ''})",
    ))


def _snapshot(a: AefiEvent) -> dict:
    return {
        "event_type": a.event_type, "severity": a.severity, "is_serious": a.is_serious,
        "outcome": a.outcome, "reported_date": a.reported_date, "investigation_date": a.investigation_date,
    }


# ---------------------------------------------------------------------------
# Reference data + helpers for the form
# ---------------------------------------------------------------------------

@router.get("/catalog")
def get_catalog(current_user: User = Depends(get_current_user)):
    """Every dropdown/checklist the AEFI form needs (see app/domain/aefi_catalog.py)."""
    return cat.catalog()


@router.get("/suggest", response_model=AefiSuggestionOut)
def suggest(
    event_type: str,
    severity: str,
    serious_criteria: list[str] = Query(default=[]),
    part_of_cluster: bool = False,
    current_user: User = Depends(get_current_user),
):
    """Suggested management for the form to pre-tick. A starting point, not an order."""
    if event_type not in cat.EVENT_TYPE_KEYS:
        raise HTTPException(status_code=400, detail="Unknown event type.")
    if severity not in cat.SEVERITY_KEYS:
        raise HTTPException(status_code=400, detail="Severity must be mild, moderate or severe.")
    criteria = [c for c in serious_criteria if c in cat.SERIOUS_CRITERIA_KEYS]
    return cat.suggest_management(event_type, severity, criteria, part_of_cluster)


@router.get("/children/{child_id}/vaccinations", response_model=list[EligibleVaccinationOut])
def child_vaccinations(
    child_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The child's recorded doses — the options for 'which vaccine(s) is this AEFI linked to?'."""
    child = db.query(Child).filter(Child.id == child_id, Child.deleted_at.is_(None)).first()
    if child is None:
        raise HTTPException(status_code=404, detail="Child not found")
    ensure_child_in_scope(db, current_user, child)
    rows = (
        db.query(VaccinationEvent, ScheduleEntry)
        .join(ScheduleEntry, VaccinationEvent.schedule_entry_id == ScheduleEntry.id)
        .filter(VaccinationEvent.child_id == child_id)
        .order_by(VaccinationEvent.event_date.desc(), ScheduleEntry.display_order)
        .all()
    )
    return [
        EligibleVaccinationOut(
            vaccination_event_id=e.id, antigen=s.antigen, dose_number=s.dose_number,
            event_date=e.event_date, batch_lot_number=e.batch_lot_number,
        )
        for e, s in rows
    ]


# ---------------------------------------------------------------------------
# Records
# ---------------------------------------------------------------------------

@router.post("", response_model=AefiOut, status_code=status.HTTP_201_CREATED)
def create_aefi(
    payload: AefiCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*AEFI_WRITE_ROLES)),
):
    child = db.query(Child).filter(Child.id == payload.child_id, Child.deleted_at.is_(None)).first()
    if child is None:
        raise HTTPException(status_code=404, detail="Child not found")
    ensure_child_in_scope(db, current_user, child)

    events = _load_child_vaccinations(db, child.id, payload.vaccination_event_ids)
    _validate_dates(payload.onset_date, events, payload.reported_date, payload.investigation_date)

    aefi = AefiEvent(
        id=uuid.uuid4(),
        aefi_number=_next_number(db),
        child_id=child.id,
        onset_date=payload.onset_date,
        event_type=payload.event_type,
        event_description=(payload.event_description or "").strip() or None,
        severity=payload.severity,
        serious_criteria=_join(payload.serious_criteria),
        is_serious=bool(payload.serious_criteria),
        part_of_cluster=payload.part_of_cluster,
        cause_category=payload.cause_category,
        outcome=payload.outcome,
        management_actions=_join(payload.management_actions),
        management_notes=(payload.management_notes or "").strip() or None,
        reported_date=payload.reported_date,
        investigation_date=payload.investigation_date,
        recorded_by_id=current_user.id,
    )
    db.add(aefi)
    db.flush()
    for event in events:
        db.add(AefiVaccination(id=uuid.uuid4(), aefi_id=aefi.id, vaccination_event_id=event.id))
    _audit(db, current_user, "aefi.create", aefi)
    db.commit()
    db.refresh(aefi)
    return _build_outs(db, [aefi])[0]


@router.get("", response_model=list[AefiOut])
def list_aefi(
    severity: Optional[str] = None,
    serious_only: bool = False,
    child_id: Optional[uuid.UUID] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """AEFIs for children in the caller's access scope, newest first (max 500)."""
    query = (
        db.query(AefiEvent)
        .join(Child, AefiEvent.child_id == Child.id)
        .filter(Child.deleted_at.is_(None))
    )
    query = restrict(query, Child.facility_id, accessible_facility_ids(db, current_user))
    if severity:
        if severity not in cat.SEVERITY_KEYS:
            raise HTTPException(status_code=400, detail="Severity must be mild, moderate or severe.")
        query = query.filter(AefiEvent.severity == severity)
    if serious_only:
        query = query.filter(AefiEvent.is_serious.is_(True))
    if child_id:
        query = query.filter(AefiEvent.child_id == child_id)
    if start_date:
        query = query.filter(AefiEvent.onset_date >= start_date)
    if end_date:
        query = query.filter(AefiEvent.onset_date <= end_date)
    aefis = query.order_by(AefiEvent.onset_date.desc(), AefiEvent.created_at.desc()).limit(500).all()
    return _build_outs(db, aefis)


def _get_in_scope(db: Session, user: User, aefi_id: uuid.UUID) -> AefiEvent:
    aefi = db.query(AefiEvent).filter(AefiEvent.id == aefi_id).first()
    if aefi is None:
        raise HTTPException(status_code=404, detail="AEFI record not found")
    child = db.query(Child).filter(Child.id == aefi.child_id, Child.deleted_at.is_(None)).first()
    if child is None:
        raise HTTPException(status_code=404, detail="AEFI record not found")
    ensure_child_in_scope(db, user, child)  # out-of-scope looks like "not found"
    return aefi


@router.get("/{aefi_id}", response_model=AefiOut)
def get_aefi(
    aefi_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _build_outs(db, [_get_in_scope(db, current_user, aefi_id)])[0]


@router.patch("/{aefi_id}", response_model=AefiOut)
def update_aefi(
    aefi_id: uuid.UUID,
    payload: AefiUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*AEFI_WRITE_ROLES)),
):
    aefi = _get_in_scope(db, current_user, aefi_id)
    before = _snapshot(aefi)
    changes = payload.model_dump(exclude_unset=True)

    link_ids = changes.pop("vaccination_event_ids", None)
    if link_ids is not None:
        events = _load_child_vaccinations(db, aefi.child_id, link_ids)
    else:
        events = (
            db.query(VaccinationEvent)
            .join(AefiVaccination, AefiVaccination.vaccination_event_id == VaccinationEvent.id)
            .filter(AefiVaccination.aefi_id == aefi.id)
            .all()
        )

    if "serious_criteria" in changes:
        criteria = changes.pop("serious_criteria") or []
        aefi.serious_criteria = _join(criteria)
        aefi.is_serious = bool(criteria)
    if "management_actions" in changes:
        aefi.management_actions = _join(changes.pop("management_actions") or [])
    for text_field in ("event_description", "management_notes"):
        if text_field in changes:
            setattr(aefi, text_field, (changes.pop(text_field) or "").strip() or None)
    for field, value in changes.items():
        # NOT NULL columns can't be blanked out; the optional date fields can.
        if value is None and field in ("onset_date", "event_type", "severity", "cause_category", "outcome", "part_of_cluster"):
            continue
        setattr(aefi, field, value)

    if aefi.event_type == "other" and not (aefi.event_description or "").strip():
        raise HTTPException(status_code=400, detail="Describe the event when the type is 'Other'.")
    _validate_dates(aefi.onset_date, events, aefi.reported_date, aefi.investigation_date)

    if link_ids is not None:
        db.query(AefiVaccination).filter(AefiVaccination.aefi_id == aefi.id).delete()
        db.flush()
        for event in events:
            db.add(AefiVaccination(id=uuid.uuid4(), aefi_id=aefi.id, vaccination_event_id=event.id))

    _audit(db, current_user, "aefi.update", aefi, before=before)
    db.commit()
    db.refresh(aefi)
    return _build_outs(db, [aefi])[0]
