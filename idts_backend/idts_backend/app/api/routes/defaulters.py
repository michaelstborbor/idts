import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_role
from app.db.session import get_db
from app.domain.schedule_engine import DoseStatus
from app.models.child import Child
from app.models.defaulter import DefaulterCase, TracingAttempt
from app.models.user import User
from app.schemas.child import ChildOut, DoseEvaluationOut
from app.schemas.defaulter import (
    CaseCloseRequest,
    DefaulterAssignRequest,
    DefaulterCaseOut,
    DueListRow,
    TracingAttemptCreate,
    TracingAttemptOut,
)
from app.services.schedule_service import evaluate_child, score_case_for_child

router = APIRouter(prefix="/api/v1", tags=["due-list-and-defaulters"])

NEEDS_ATTENTION_STATUSES = {DoseStatus.DUE_SOON, DoseStatus.DUE, DoseStatus.OVERDUE, DoseStatus.DEFAULTER}


@router.get("/due-list", response_model=list[DueListRow])
def get_due_list(
    facility_id: uuid.UUID | None = None,
    status_filter: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Flattened due/overdue/defaulter list across children (design doc §13).
    Filtering happens in Python here rather than SQL because the underlying
    status is computed by the domain engine, not stored — trading query
    performance for keeping the single source of truth for "what counts as
    overdue" in one tested module. Fine at pilot scale; worth revisiting
    (e.g. a scheduled job that materializes status onto the child row) if
    this becomes a bottleneck at national scale.
    """
    query = db.query(Child).filter(Child.status == "active", Child.deleted_at.is_(None))
    if facility_id:
        query = query.filter(Child.facility_id == facility_id)
    children = query.all()

    rows: list[DueListRow] = []
    for child in children:
        evaluations = evaluate_child(db, child)
        for e in evaluations:
            if e.status not in NEEDS_ATTENTION_STATUSES:
                continue
            if status_filter and e.status.value != status_filter:
                continue

            priority = None
            risk_score = None
            if e.status == DoseStatus.DEFAULTER:
                assessment = score_case_for_child(db, child, e)
                priority = assessment.priority.value
                risk_score = assessment.score

            rows.append(
                DueListRow(
                    child=ChildOut.model_validate(child),
                    dose=DoseEvaluationOut(
                        schedule_entry_id=uuid.UUID(e.schedule_entry.id),
                        antigen=e.schedule_entry.antigen,
                        dose_number=e.schedule_entry.dose_number,
                        status=e.status.value,
                        days_overdue=e.days_overdue,
                        reason=e.reason,
                        eligible_date=e.eligible_date,
                    ),
                    priority=priority,
                    risk_score=risk_score,
                )
            )

    status_order = {"defaulter": 0, "overdue": 1, "due": 2, "due_soon": 3}
    rows.sort(key=lambda r: (status_order.get(r.dose.status, 9), -r.dose.days_overdue))
    return rows


@router.post("/defaulters/assign", response_model=DefaulterCaseOut, status_code=status.HTTP_201_CREATED)
def assign_defaulter(
    payload: DefaulterAssignRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("system_admin", "facility_focal_person", "facility_supervisor")),
):
    child_id = payload.child_id
    child = db.query(Child).filter(Child.id == child_id, Child.deleted_at.is_(None)).first()
    if child is None:
        raise HTTPException(status_code=404, detail="Child not found")

    existing = (
        db.query(DefaulterCase)
        .filter(
            DefaulterCase.child_id == child_id,
            DefaulterCase.schedule_entry_id == payload.schedule_entry_id,
            DefaulterCase.status.in_(["open", "assigned", "in_tracing", "return_pending_confirmation"]),
        )
        .first()
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="An active case already exists for this dose.")

    evaluations = evaluate_child(db, child)
    triggering = next((e for e in evaluations if str(e.schedule_entry.id) == str(payload.schedule_entry_id)), None)
    if triggering is None or triggering.status != DoseStatus.DEFAULTER:
        raise HTTPException(status_code=400, detail="This dose is not currently classified as a defaulter.")

    assessment = score_case_for_child(db, child, triggering)

    case = DefaulterCase(
        id=uuid.uuid4(),
        child_id=child_id,
        schedule_entry_id=payload.schedule_entry_id,
        reason=triggering.reason,
        date_identified=date.today(),
        priority=assessment.priority.value,
        risk_score=assessment.score,
        risk_score_breakdown=assessment.breakdown.as_dict(),
        assigned_to_id=payload.assigned_to_id,
        status="assigned",
    )
    db.add(case)
    db.commit()
    db.refresh(case)
    return case


@router.get("/defaulters", response_model=list[DefaulterCaseOut])
def list_defaulter_cases(
    status_filter: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(DefaulterCase)
    if status_filter:
        query = query.filter(DefaulterCase.status == status_filter)
    else:
        query = query.filter(DefaulterCase.status != "closed")
    return query.order_by(DefaulterCase.date_identified.desc()).all()


@router.post("/defaulters/{case_id}/trace", response_model=TracingAttemptOut, status_code=status.HTTP_201_CREATED)
def record_tracing_attempt(
    case_id: uuid.UUID,
    payload: TracingAttemptCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("system_admin", "chw", "facility_focal_person")),
):
    case = db.query(DefaulterCase).filter(DefaulterCase.id == case_id).first()
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")
    if case.status == "closed":
        raise HTTPException(status_code=400, detail="Cannot record a tracing attempt on a closed case.")

    attempt = TracingAttempt(
        id=uuid.uuid4(),
        defaulter_case_id=case_id,
        tracer_id=current_user.id,
        attempt_date=date.today(),
        method=payload.method,
        outcome=payload.outcome,
        next_followup_date=payload.next_followup_date,
        notes=payload.notes,
    )
    db.add(attempt)
    if case.status == "assigned":
        case.status = "in_tracing"
    db.commit()
    db.refresh(attempt)
    return attempt


@router.post("/defaulters/{case_id}/close", response_model=DefaulterCaseOut)
def close_defaulter_case(
    case_id: uuid.UUID,
    payload: CaseCloseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role("system_admin", "facility_focal_person", "facility_supervisor")
    ),
):
    """
    Controlled closure (design doc §16): requires an explicit reason from
    the fixed enum, and only a focal-person-or-above role can confirm it —
    a CHW recording tracing attempts cannot unilaterally close a case.
    """
    case = db.query(DefaulterCase).filter(DefaulterCase.id == case_id).first()
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")
    if case.status == "closed":
        raise HTTPException(status_code=400, detail="Case is already closed.")

    valid_reasons = {
        "vaccinated_returned", "vaccinated_elsewhere", "transferred",
        "moved_out", "deceased", "unable_to_locate", "refused", "other",
    }
    if payload.closure_reason not in valid_reasons:
        raise HTTPException(status_code=400, detail=f"closure_reason must be one of {sorted(valid_reasons)}")

    case.status = "closed"
    case.closure_reason = payload.closure_reason
    case.closed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(case)
    return case
