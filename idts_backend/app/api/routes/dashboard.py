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
from app.services.schedule_service import evaluate_child, is_fully_immunized_child

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
    child's full evaluated schedule and recompute this client-side.

    Two DIFFERENT stats are reported and must not be conflated:
    - "needs_attention_children": age-relative — does this child have
      anything currently due_soon/due/overdue/defaulter right now. Useful
      operationally (this is what the due-list is built from) but does
      NOT mean the child has completed their full immunization course.
    - "fully_immunized": the real "Fully Immunized Child" (FIC) measure
      per Ministry protocol — has this child actually RECEIVED every dose
      up to and including MR2, regardless of their current age. See
      is_fully_immunized_child()'s docstring for the exact cutoff rule.
      A young infant will almost always be "not needing attention" (age
      -relative) while also NOT being "fully immunized" (FIC) yet — both
      of those are correct and expected at the same time, not a
      contradiction.

    fully_immunized_child_ids is returned so the frontend can badge
    individual children in list views without a second full evaluation
    pass per child — this endpoint already evaluates every active child
    once; reusing that here is free, a second pass in list_children would
    not be.
    """
    query = db.query(Child).filter(Child.status == "active", Child.deleted_at.is_(None))
    if facility_id:
        query = query.filter(Child.facility_id == facility_id)
    children = query.all()

    registered = len(children)
    fully_immunized = 0
    fully_immunized_child_ids: list[uuid.UUID] = []
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

        if is_fully_immunized_child(db, child, evaluations=evaluations):
            fully_immunized += 1
            fully_immunized_child_ids.append(child.id)

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
        fully_immunized_child_ids=fully_immunized_child_ids,
        needs_attention_children=needs_attention_children,
        given_total=given_total,
        dose_status_counts=status_counts,
        cases_in_tracing=in_tracing,
        cases_pending_confirmation=pending_confirmation,
        cases_returned_to_service=returned,
    )
