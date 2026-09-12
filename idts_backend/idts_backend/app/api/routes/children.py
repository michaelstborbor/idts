import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_role
from app.db.session import get_db
from app.models.child import Child
from app.models.user import User
from app.schemas.child import (
    ChildCreate,
    ChildDetailOut,
    ChildOut,
    DoseEvaluationOut,
    DuplicateCandidate,
)
from app.services.schedule_service import evaluate_child

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
    window_start = dob - timedelta(days=3)
    window_end = dob + timedelta(days=3)
    candidates = (
        db.query(Child)
        .filter(
            Child.full_name.ilike(full_name.strip()),
            Child.dob.between(window_start, window_end),
        )
        .all()
    )
    return [
        DuplicateCandidate(child=ChildOut.model_validate(c), match_reason="Matching name and date of birth")
        for c in candidates
    ]


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

    child = Child(
        id=uuid.uuid4(),
        system_id=_generate_system_id(db),
        full_name=payload.full_name.strip(),
        sex=payload.sex,
        dob=payload.dob,
        dob_estimated=payload.dob_estimated,
        facility_id=payload.facility_id,
        community_id=payload.community_id,
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
    facility_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Child).filter(Child.status == "active")
    if facility_id:
        query = query.filter(Child.facility_id == facility_id)
    return query.order_by(Child.created_at.desc()).all()


@router.get("/{child_id}", response_model=ChildDetailOut)
def get_child(
    child_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    child = db.query(Child).filter(Child.id == child_id).first()
    if child is None:
        raise HTTPException(status_code=404, detail="Child not found")

    evaluations = evaluate_child(db, child)
    schedule_out = [
        DoseEvaluationOut(
            schedule_entry_id=uuid.UUID(e.schedule_entry.id),
            antigen=e.schedule_entry.antigen,
            dose_number=e.schedule_entry.dose_number,
            status=e.status.value,
            days_overdue=e.days_overdue,
            reason=e.reason,
            eligible_date=e.eligible_date,
        )
        for e in evaluations
    ]

    detail = ChildDetailOut.model_validate(child)
    detail.schedule = schedule_out
    return detail
