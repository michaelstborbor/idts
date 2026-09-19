import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_role
from app.db.session import get_db
from app.models.child import Child, VaccinationEvent
from app.models.defaulter import DefaulterCase
from app.models.user import User
from app.schemas.defaulter import VaccinationCreate, VaccinationOut
from app.services.schedule_service import evaluate_child

router = APIRouter(prefix="/api/v1/children", tags=["vaccinations"])


@router.post("/{child_id}/vaccinations", response_model=VaccinationOut, status_code=status.HTTP_201_CREATED)
def record_vaccination(
    child_id: uuid.UUID,
    payload: VaccinationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("system_admin", "facility_focal_person", "vaccinator")),
):
    child = db.query(Child).filter(Child.id == child_id, Child.deleted_at.is_(None)).first()
    if child is None:
        raise HTTPException(status_code=404, detail="Child not found")

    # Idempotency check FIRST (design doc §9/§29/§45): a resubmitted offline
    # transaction must return the existing result, never create a duplicate
    # vaccination record.
    if payload.idempotency_key:
        existing = (
            db.query(VaccinationEvent)
            .filter(VaccinationEvent.idempotency_key == payload.idempotency_key)
            .first()
        )
        if existing is not None:
            return existing

    if payload.event_date > date.today():
        raise HTTPException(status_code=400, detail="Vaccination date cannot be in the future.")
    if payload.event_date < child.dob:
        raise HTTPException(status_code=400, detail="Vaccination date cannot be before the child's date of birth.")

    already_given = (
        db.query(VaccinationEvent)
        .filter(
            VaccinationEvent.child_id == child_id,
            VaccinationEvent.schedule_entry_id == payload.schedule_entry_id,
        )
        .first()
    )
    if already_given is not None:
        raise HTTPException(status_code=409, detail="This dose has already been recorded for this child.")

    event = VaccinationEvent(
        id=uuid.uuid4(),
        child_id=child_id,
        schedule_entry_id=payload.schedule_entry_id,
        event_date=payload.event_date,
        facility_id=payload.facility_id,
        vaccinator_id=current_user.id,
        session_type=payload.session_type,
        batch_lot_number=payload.batch_lot_number,
        notes=payload.notes,
        idempotency_key=payload.idempotency_key,
    )
    db.add(event)

    # Auto-flag any open defaulter case for this exact dose as pending
    # confirmation, rather than silently closing it (design doc §5 Scenario
    # E / §16 "controlled closure" requirement — a person confirms closure).
    open_case = (
        db.query(DefaulterCase)
        .filter(
            DefaulterCase.child_id == child_id,
            DefaulterCase.schedule_entry_id == payload.schedule_entry_id,
            DefaulterCase.status.in_(["assigned", "in_tracing"]),
        )
        .first()
    )
    if open_case is not None:
        open_case.status = "return_pending_confirmation"

    db.commit()
    db.refresh(event)
    return event


@router.get("/{child_id}/vaccinations", response_model=list[VaccinationOut])
def list_vaccinations(
    child_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    child = db.query(Child).filter(Child.id == child_id, Child.deleted_at.is_(None)).first()
    if child is None:
        raise HTTPException(status_code=404, detail="Child not found")
    return (
        db.query(VaccinationEvent)
        .filter(VaccinationEvent.child_id == child_id)
        .order_by(VaccinationEvent.event_date.desc())
        .all()
    )
