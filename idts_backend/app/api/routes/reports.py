import uuid
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.child import Child, ScheduleEntry, VaccinationEvent
from app.models.user import User
from app.schemas.reports import VaccinationSummaryOut, VaccinationSummaryRow

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
        query = query.filter(VaccinationEvent.facility_id == facility_id)

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
