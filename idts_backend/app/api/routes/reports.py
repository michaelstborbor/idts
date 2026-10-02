import uuid
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.core.scope import (
    LEVEL_GROUPINGS,
    access_level,
    accessible_facility_ids,
    resolve_facility_scope,
    restrict,
    scope_label,
)
from app.db.session import get_db
from app.domain.schedule_engine import DoseStatus
from app.models.child import Child, ScheduleEntry, VaccinationEvent
from app.models.defaulter import DefaulterCase, TracingAttempt
from app.models.user import Facility, GeographicArea, User
from app.schemas.reports import (
    AggregateReportOut,
    AggregateRow,
    ScopeInfoOut,
    VaccinationSummaryOut,
    VaccinationSummaryRow,
)
from app.services.schedule_service import evaluate_child, is_fully_immunized_child

router = APIRouter(prefix="/api/v1/reports", tags=["reports"])


@router.get("/vaccinations-summary", response_model=VaccinationSummaryOut)
def vaccinations_summary(
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    facility_id: Optional[uuid.UUID] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Doses given, grouped by antigen and session type (fixed / outreach /
    mobile / community), within an optional date range — design doc §26's
    "vaccine utilization report" / "monthly immunization report" concept,
    scoped to what a facility pilot actually needs first: how many of each
    antigen were given, broken down by delivery strategy.

    Returned as structured JSON rather than a server-rendered CSV — the
    frontend builds a CSV client-side from this same data for the
    "Download CSV" action, so there is one source of truth for the numbers
    shown on screen and the numbers in the download, not two code paths
    that could silently drift apart.
    """
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=400, detail="start_date must not be after end_date.")

    query = (
        db.query(
            ScheduleEntry.antigen,
            VaccinationEvent.session_type,
            func.count(VaccinationEvent.id).label("count"),
        )
        .join(ScheduleEntry, VaccinationEvent.schedule_entry_id == ScheduleEntry.id)
        .join(Child, VaccinationEvent.child_id == Child.id)
        .filter(Child.deleted_at.is_(None))
    )
    if start_date:
        query = query.filter(VaccinationEvent.event_date >= start_date)
    if end_date:
        query = query.filter(VaccinationEvent.event_date <= end_date)
    if facility_id:
        resolve_facility_scope(db, current_user, facility_id)  # 403 if this user can't see that facility
        query = query.filter(VaccinationEvent.facility_id == facility_id)
    # Access scope: only children (and their doses) within this user's scope
    query = restrict(query, Child.facility_id, accessible_facility_ids(db, current_user))

    query = query.group_by(ScheduleEntry.antigen, VaccinationEvent.session_type)
    query = query.order_by(ScheduleEntry.antigen, VaccinationEvent.session_type)

    rows = [
        VaccinationSummaryRow(antigen=antigen, session_type=session_type, count=count)
        for antigen, session_type, count in query.all()
    ]
    total = sum(r.count for r in rows)

    return VaccinationSummaryOut(
        start_date=start_date,
        end_date=end_date,
        rows=rows,
        total_doses=total,
    )


# ---------------------------------------------------------------------------
# Access scope + aggregate reports (by facility / user / chiefdom / district /
# country). What each account can request is decided in app/core/scope.py.
# ---------------------------------------------------------------------------

NEEDS_ATTENTION = {DoseStatus.DUE_SOON, DoseStatus.DUE, DoseStatus.OVERDUE, DoseStatus.DEFAULTER}
RETURNED_REASONS = {"vaccinated_returned", "vaccinated_elsewhere"}
NUMERIC_FIELDS = ["registered", "fully_immunized", "needs_attention", "cases_open", "cases_returned", "doses_given"]


@router.get("/scope", response_model=ScopeInfoOut)
def my_access_scope(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Tells the frontend what this account can see and which report
    breakdowns it may request."""
    level = access_level(current_user)
    return ScopeInfoOut(level=level, scope_label=scope_label(db, current_user), allowed_group_by=LEVEL_GROUPINGS[level])


def _ancestor_of_level(areas: dict, area_id, level: str):
    current = areas.get(area_id) if area_id else None
    hops = 0
    while current is not None and hops < 10:
        if current.level == level:
            return current
        current = areas.get(current.parent_id) if current.parent_id else None
        hops += 1
    return None


def _facility_metrics(db: Session, scope, start_date, end_date) -> dict:
    """Per-facility numbers. Child counts are a snapshot as of today; doses
    given are limited to the date range."""
    metrics: dict = {}

    def bucket(facility_id):
        return metrics.setdefault(
            facility_id,
            {"registered": 0, "fully_immunized": 0, "needs_attention": 0, "cases_open": 0, "cases_returned": 0, "doses_given": 0},
        )

    children_query = db.query(Child).filter(Child.status == "active", Child.deleted_at.is_(None))
    for child in restrict(children_query, Child.facility_id, scope).all():
        row = bucket(child.facility_id)
        row["registered"] += 1
        evaluations = evaluate_child(db, child)
        if any(e.status in NEEDS_ATTENTION for e in evaluations):
            row["needs_attention"] += 1
        if is_fully_immunized_child(db, child, evaluations=evaluations):
            row["fully_immunized"] += 1

    dose_query = (
        db.query(Child.facility_id, func.count(VaccinationEvent.id))
        .join(Child, VaccinationEvent.child_id == Child.id)
        .filter(Child.deleted_at.is_(None))
    )
    if start_date:
        dose_query = dose_query.filter(VaccinationEvent.event_date >= start_date)
    if end_date:
        dose_query = dose_query.filter(VaccinationEvent.event_date <= end_date)
    dose_query = restrict(dose_query, Child.facility_id, scope).group_by(Child.facility_id)
    for facility_id, count in dose_query.all():
        bucket(facility_id)["doses_given"] += count

    case_query = (
        db.query(Child.facility_id, DefaulterCase.status, DefaulterCase.closure_reason, func.count(DefaulterCase.id))
        .join(Child, DefaulterCase.child_id == Child.id)
        .filter(Child.deleted_at.is_(None))
    )
    case_query = restrict(case_query, Child.facility_id, scope).group_by(
        Child.facility_id, DefaulterCase.status, DefaulterCase.closure_reason
    )
    for facility_id, case_status, closure_reason, count in case_query.all():
        row = bucket(facility_id)
        if case_status != "closed":
            row["cases_open"] += count
        elif closure_reason in RETURNED_REASONS:
            row["cases_returned"] += count

    return metrics


def _sum_rows(rows: list, fields: list) -> AggregateRow:
    values = {f: sum((getattr(r, f) or 0) for r in rows) for f in fields}
    return AggregateRow(key="total", label="Total", **values)


@router.get("/aggregate", response_model=AggregateReportOut)
def aggregate_report(
    group_by: str = "facility",
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Aggregate report, always limited to the caller's access scope:
      - facility accounts: their own facility / its users
      - district accounts: their district, by facility, user or chiefdom
      - national accounts: all facilities, by facility, user, chiefdom or district
      - system admins: everything, including by country
    Child counts are today's snapshot; doses/tracing activity respect the
    optional date range.
    """
    level = access_level(current_user)
    allowed = LEVEL_GROUPINGS[level]
    if group_by not in allowed:
        raise HTTPException(status_code=403, detail=f"Your account can't view this breakdown. Allowed: {', '.join(allowed)}.")
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=400, detail="start_date must not be after end_date.")

    scope = accessible_facility_ids(db, current_user)
    label = scope_label(db, current_user)

    if group_by == "user":
        return _user_breakdown(db, scope, start_date, end_date, label)

    metrics = _facility_metrics(db, scope, start_date, end_date)
    facilities = {f.id: f for f in db.query(Facility).all()}
    areas = {a.id: a for a in db.query(GeographicArea).all()}

    grouped: dict = {}
    for facility_id, values in metrics.items():
        facility = facilities.get(facility_id)
        if group_by == "facility":
            key = str(facility_id)
            group_label = facility.name if facility else "Unknown facility"
            area = areas.get(facility.geographic_area_id) if facility and facility.geographic_area_id else None
            sublabel = area.name if area else None
        else:
            area = _ancestor_of_level(areas, facility.geographic_area_id if facility else None, group_by)
            key = str(area.id) if area else "unassigned"
            group_label = area.name if area else "Unassigned area"
            parent = areas.get(area.parent_id) if area and area.parent_id else None
            sublabel = parent.name if parent else None
        entry = grouped.setdefault(key, {"label": group_label, "sublabel": sublabel, **{f: 0 for f in NUMERIC_FIELDS}})
        for f in NUMERIC_FIELDS:
            entry[f] += values[f]

    rows = [AggregateRow(key=k, **v) for k, v in grouped.items()]
    rows.sort(key=lambda r: r.label.lower())
    return AggregateReportOut(
        group_by=group_by,
        scope_label=label,
        start_date=start_date,
        end_date=end_date,
        rows=rows,
        totals=_sum_rows(rows, NUMERIC_FIELDS),
    )


def _user_breakdown(db: Session, scope, start_date, end_date, label: str) -> AggregateReportOut:
    per_user: dict = {}

    def bucket(user_id):
        return per_user.setdefault(user_id, {"doses_given": 0, "tracing_attempts": 0, "cases_assigned": 0})

    dose_query = (
        db.query(VaccinationEvent.vaccinator_id, func.count(VaccinationEvent.id))
        .join(Child, VaccinationEvent.child_id == Child.id)
        .filter(Child.deleted_at.is_(None), VaccinationEvent.vaccinator_id.isnot(None))
    )
    if start_date:
        dose_query = dose_query.filter(VaccinationEvent.event_date >= start_date)
    if end_date:
        dose_query = dose_query.filter(VaccinationEvent.event_date <= end_date)
    for user_id, count in restrict(dose_query, Child.facility_id, scope).group_by(VaccinationEvent.vaccinator_id).all():
        bucket(user_id)["doses_given"] += count

    tracing_query = (
        db.query(TracingAttempt.tracer_id, func.count(TracingAttempt.id))
        .join(DefaulterCase, TracingAttempt.defaulter_case_id == DefaulterCase.id)
        .join(Child, DefaulterCase.child_id == Child.id)
        .filter(Child.deleted_at.is_(None), TracingAttempt.tracer_id.isnot(None))
    )
    if start_date:
        tracing_query = tracing_query.filter(TracingAttempt.attempt_date >= start_date)
    if end_date:
        tracing_query = tracing_query.filter(TracingAttempt.attempt_date <= end_date)
    for user_id, count in restrict(tracing_query, Child.facility_id, scope).group_by(TracingAttempt.tracer_id).all():
        bucket(user_id)["tracing_attempts"] += count

    assigned_query = (
        db.query(DefaulterCase.assigned_to_id, func.count(DefaulterCase.id))
        .join(Child, DefaulterCase.child_id == Child.id)
        .filter(Child.deleted_at.is_(None), DefaulterCase.assigned_to_id.isnot(None))
    )
    if start_date:
        assigned_query = assigned_query.filter(DefaulterCase.date_identified >= start_date)
    if end_date:
        assigned_query = assigned_query.filter(DefaulterCase.date_identified <= end_date)
    for user_id, count in restrict(assigned_query, Child.facility_id, scope).group_by(DefaulterCase.assigned_to_id).all():
        bucket(user_id)["cases_assigned"] += count

    users = {u.id: u for u in db.query(User).filter(User.id.in_(list(per_user.keys()))).all()} if per_user else {}
    facilities = {f.id: f.name for f in db.query(Facility).all()}

    rows = []
    for user_id, values in per_user.items():
        u = users.get(user_id)
        if u is None:
            continue
        parts = [u.role.replace("_", " ")]
        if u.facility_id and facilities.get(u.facility_id):
            parts.append(facilities[u.facility_id])
        rows.append(AggregateRow(key=str(user_id), label=u.full_name, sublabel=" · ".join(parts), **values))
    rows.sort(key=lambda r: (-r.doses_given, r.label.lower()))

    return AggregateReportOut(
        group_by="user",
        scope_label=label,
        start_date=start_date,
        end_date=end_date,
        rows=rows,
        totals=_sum_rows(rows, ["doses_given", "tracing_attempts", "cases_assigned"]),
    )
