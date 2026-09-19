import uuid
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.session import get_db
from app.domain.schedule_engine import DoseStatus
from app.models.child import Child, VaccinationEvent
from app.models.defaulter import DefaulterCase
from app.models.user import User
from app.schemas.dashboard import DashboardStatsOut
from app.services.schedule_service import evaluate_child

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])

NEEDS_ATTENTION = {DoseStatus.DUE_SOON, DoseStatus.DUE, DoseStatus.OVERDUE, DoseStatus.DEFAULTER}


@router.get("", response_model=DashboardStatsOut)
def get_dashboard_stats(
    facility_id: Optional[uuid.UUID] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Server-side aggregate so the frontend doesn't need to fetch every
    child's full evaluated schedule and recompute this client-side —
    flagged as worth building in the frontend README; this is that.

    "Fully immunized (for age)" here means: this child currently has
    nothing in due_soon/due/overdue/defaulter status — i.e. everything
    they're old enough to need has been given. It does NOT mean every
    dose in the whole schedule has been given (a 2-month-old can be
    "fully immunized for age" while doses due at 9 months are correctly
    not_yet_due). This mirrors standard EPI M&E usage of the term, but is
    a computed convenience, not a stored/authoritative status — it will
    change automatically as the child ages into new due doses.
    """
    query = db.query(Child).filter(Child.status == "active", Child.deleted_at.is_(None))
    if facility_id:
        query = query.filter(Child.facility_id == facility_id)
    children = query.all()

    registered = len(children)
    fully_immunized = 0
    needs_attention_children = 0
    status_counts = {"not_yet_due": 0, "due_soon": 0, "due": 0, "overdue": 0, "defaulter": 0, "administered": 0, "not_applicable": 0}

    for child in children:
        evaluations = evaluate_child(db, child)
        outstanding = False
        for e in evaluations:
            status_counts[e.status.value] = status_counts.get(e.status.value, 0) + 1
            if e.status in NEEDS_ATTENTION:
                outstanding = True
        if outstanding:
            needs_attention_children += 1
        else:
            fully_immunized += 1

    given_total_query = db.query(VaccinationEvent).join(Child, VaccinationEvent.child_id == Child.id).filter(
        Child.deleted_at.is_(None)
    )
    if facility_id:
        given_total_query = given_total_query.filter(Child.facility_id == facility_id)
    given_total = given_total_query.count()

    active_cases_query = db.query(DefaulterCase).join(Child, DefaulterCase.child_id == Child.id).filter(
        Child.deleted_at.is_(None), DefaulterCase.status != "closed"
    )
    closed_cases_query = db.query(DefaulterCase).join(Child, DefaulterCase.child_id == Child.id).filter(
        Child.deleted_at.is_(None), DefaulterCase.status == "closed"
    )
    if facility_id:
        active_cases_query = active_cases_query.filter(Child.facility_id == facility_id)
        closed_cases_query = closed_cases_query.filter(Child.facility_id == facility_id)

    active_cases = active_cases_query.all()
    closed_cases = closed_cases_query.all()
    in_tracing = sum(1 for c in active_cases if c.status in ("assigned", "in_tracing"))
    pending_confirmation = sum(1 for c in active_cases if c.status == "return_pending_confirmation")
    returned = sum(1 for c in closed_cases if c.closure_reason in ("vaccinated_returned", "vaccinated_elsewhere"))

    return DashboardStatsOut(
        registered=registered,
        fully_immunized=fully_immunized,
        needs_attention_children=needs_attention_children,
        given_total=given_total,
        dose_status_counts=status_counts,
        cases_in_tracing=in_tracing,
        cases_pending_confirmation=pending_confirmation,
        cases_returned_to_service=returned,
    )
