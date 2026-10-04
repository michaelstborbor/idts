import uuid
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_role
from app.core.scope import (
    accessible_facility_ids,
    district_search_scope_facility_ids,
    ensure_child_in_scope,
    ensure_facility_in_scope,
    resolve_facility_scope,
    restrict,
)
from app.db.session import get_db
from app.models.child import Child
from app.models.user import Facility
from app.models.user import User
from app.schemas.child import (
    ChildCreate,
    ChildDetailOut,
    ChildOut,
    ChildSearchResult,
    ChildUpdate,
    DoseEvaluationOut,
    DuplicateCandidate,
)
from app.services.schedule_service import evaluate_child, is_fully_immunized_child

router = APIRouter(prefix="/api/v1/children", tags=["children"])


def _generate_system_id(db: Session) -> str:
    """
    [CONFIG] prefix — a real deployment would set this per facility/country
    (design doc §7's system_id example: "SL-000123"). Count-based suffixes
    are fine for a pilot's data volume; a high-concurrency deployment should
    move this to a DB sequence to avoid a (rare) race on the count.
    """
    count = db.query(Child).count()
    return f"IDTS-{count + 1:06d}"


def _dose_evaluation_out(e) -> DoseEvaluationOut:
    return DoseEvaluationOut(
        schedule_entry_id=uuid.UUID(e.schedule_entry.id),
        antigen=e.schedule_entry.antigen,
        dose_number=e.schedule_entry.dose_number,
        status=e.status.value,
        days_overdue=e.days_overdue,
        reason=e.reason,
        eligible_date=e.eligible_date,
        dosage=e.schedule_entry.dosage,
        route=e.schedule_entry.route,
        site=e.schedule_entry.site,
    )


@router.get("/duplicates", response_model=list[DuplicateCandidate])
def find_duplicates(
    full_name: str,
    dob: date,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Simple duplicate check (design doc §7): same name (case-insensitive)
    within a small date-of-birth window. A production system would add
    caregiver-phone and community matching too — flagged as a known gap,
    not silently skipped.
    """
    from datetime import timedelta

    window_start = dob - timedelta(days=3)
    window_end = dob + timedelta(days=3)
    candidate_query = db.query(Child).filter(
        Child.full_name.ilike(full_name.strip()),
        Child.dob.between(window_start, window_end),
        Child.deleted_at.is_(None),
    )
    # Only children within the user's own access scope are shown as possible
    # duplicates (showing children from other facilities would leak records).
    candidates = restrict(candidate_query, Child.facility_id, accessible_facility_ids(db, current_user)).all()
    return [
        DuplicateCandidate(child=ChildOut.model_validate(c), match_reason="Matching name and date of birth")
        for c in candidates
    ]


@router.get("/search", response_model=list[ChildSearchResult])
def search_children(
    name: Optional[str] = None,
    system_id: Optional[str] = None,
    dob: Optional[date] = None,
    caregiver_name: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Powers the "Search for child" pane next to Register child — the
    trained first step before registering, to catch a child who already
    has a record at a different facility before a duplicate gets created.

    Scoped to the searcher's whole DISTRICT (district_search_scope_facility_ids,
    app/core/scope.py) — wider than their everyday facility/chiefdom access
    for facility_supervisor and the facility-only roles, so a child who
    moved facilities within the district is still found. Returns FULL
    detail (including vaccination history), so the searcher can actually
    judge whether it's the same child — the one deliberate, narrow
    exception to normal scope anywhere in this system. It does not change
    what the searcher can edit, record doses against, or see anywhere
    else: this is read-only, and only for records this search itself
    surfaces.
    """
    if not any([name, system_id, dob, caregiver_name]):
        raise HTTPException(status_code=400, detail="Enter at least one search term.")

    scope_ids = district_search_scope_facility_ids(db, current_user)
    query = db.query(Child).filter(Child.deleted_at.is_(None))
    query = restrict(query, Child.facility_id, scope_ids)
    if name:
        query = query.filter(Child.full_name.ilike(f"%{name.strip()}%"))
    if system_id:
        query = query.filter(Child.system_id.ilike(f"%{system_id.strip()}%"))
    if dob:
        query = query.filter(Child.dob == dob)
    if caregiver_name:
        query = query.filter(Child.caregiver_name.ilike(f"%{caregiver_name.strip()}%"))

    results = query.order_by(Child.full_name).limit(25).all()
    facility_names = {f.id: f.name for f in db.query(Facility).all()}
    out = []
    for child in results:
        evaluations = evaluate_child(db, child)
        detail = ChildSearchResult.model_validate(child)
        detail.schedule = [_dose_evaluation_out(e) for e in evaluations]
        detail.fully_immunized = is_fully_immunized_child(db, child, evaluations=evaluations)
        detail.facility_name = facility_names.get(child.facility_id)
        out.append(detail)
    return out


@router.post("", response_model=ChildOut, status_code=status.HTTP_201_CREATED)
def register_child(
    payload: ChildCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role("system_admin", "facility_focal_person", "vaccinator")
    ),
):
    if payload.dob > date.today():
        raise HTTPException(status_code=400, detail="Date of birth cannot be in the future.")
    ensure_facility_in_scope(db, current_user, payload.facility_id)

    child = Child(
        id=uuid.uuid4(),
        system_id=_generate_system_id(db),
        full_name=payload.full_name.strip(),
        sex=payload.sex,
        dob=payload.dob,
        dob_estimated=payload.dob_estimated,
        facility_id=payload.facility_id,
        community_id=payload.community_id,
        address=payload.address,
        caregiver_name=payload.caregiver_name,
        caregiver_phone=payload.caregiver_phone,
        caregiver_relationship=payload.caregiver_relationship,
        status="active",
    )
    db.add(child)
    db.commit()
    db.refresh(child)
    return child


@router.get("", response_model=list[ChildOut])
def list_children(
    facility_id: Optional[uuid.UUID] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Child).filter(Child.status == "active", Child.deleted_at.is_(None))
    query = restrict(query, Child.facility_id, resolve_facility_scope(db, current_user, facility_id))
    return query.order_by(Child.created_at.desc()).all()


@router.get("/{child_id}", response_model=ChildDetailOut)
def get_child(
    child_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    child = db.query(Child).filter(Child.id == child_id, Child.deleted_at.is_(None)).first()
    if child is None:
        raise HTTPException(status_code=404, detail="Child not found")
    ensure_child_in_scope(db, current_user, child)

    evaluations = evaluate_child(db, child)
    schedule_out = [_dose_evaluation_out(e) for e in evaluations]

    detail = ChildDetailOut.model_validate(child)
    detail.schedule = schedule_out
    detail.fully_immunized = is_fully_immunized_child(db, child, evaluations=evaluations)
    return detail


@router.patch("/{child_id}", response_model=ChildDetailOut)
def update_child(
    child_id: uuid.UUID,
    payload: ChildUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role("system_admin", "facility_focal_person", "vaccinator")
    ),
):
    """
    Edits a subset of the child's own fields (name, sex, DOB, address,
    caregiver contact). Does not touch facility assignment (that's a
    transfer, a separate documented workflow per design doc §19, not a
    plain field edit) or vaccination/case history. Every change is visible
    via updated_at; a full field-level audit log is real future scope
    (design doc §33) not yet built — flagged, not silently skipped.
    """
    child = db.query(Child).filter(Child.id == child_id, Child.deleted_at.is_(None)).first()
    if child is None:
        raise HTTPException(status_code=404, detail="Child not found")
    ensure_child_in_scope(db, current_user, child)

    if payload.dob is not None and payload.dob > date.today():
        raise HTTPException(status_code=400, detail="Date of birth cannot be in the future.")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if field == "full_name" and isinstance(value, str):
            value = value.strip()
        setattr(child, field, value)

    db.commit()
    db.refresh(child)

    evaluations = evaluate_child(db, child)
    detail = ChildDetailOut.model_validate(child)
    detail.schedule = [_dose_evaluation_out(e) for e in evaluations]
    detail.fully_immunized = is_fully_immunized_child(db, child, evaluations=evaluations)
    return detail


@router.delete("/{child_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_child(
    child_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("system_admin", "facility_focal_person")),
):
    """
    Soft delete, not a hard SQL DELETE: sets deleted_at and excludes the
    record from every normal query (list, get, due-list, duplicate check),
    but keeps the row — including its vaccination and case history — in
    the database. This is a deliberate choice, not the literal behavior
    "delete" might imply: immunization records are exactly the kind of
    data where an accidental or malicious hard delete is unrecoverable and
    where a later audit may need to know a record existed. The original
    design doc's own principles (§21 audit logging, §33 tamper-resistant
    trails) argue against ever truly erasing a child's history. If a true
    hard-delete (e.g. for a data-protection erasure request) is ever
    needed, that should be a separate, explicitly authorized operation —
    not this endpoint.
    """
    child = db.query(Child).filter(Child.id == child_id, Child.deleted_at.is_(None)).first()
    if child is None:
        raise HTTPException(status_code=404, detail="Child not found")
    ensure_child_in_scope(db, current_user, child)

    child.deleted_at = datetime.now(timezone.utc)
    child.status = "deleted"
    db.commit()
    return None
