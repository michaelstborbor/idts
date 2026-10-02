from datetime import date
from typing import Optional

from pydantic import BaseModel


class VaccinationSummaryRow(BaseModel):
    antigen: str
    session_type: str
    count: int


class VaccinationSummaryOut(BaseModel):
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    rows: list[VaccinationSummaryRow]
    total_doses: int


class ScopeInfoOut(BaseModel):
    level: str  # facility / district / national / admin
    scope_label: str
    allowed_group_by: list[str]


class AggregateRow(BaseModel):
    key: str
    label: str
    sublabel: Optional[str] = None
    # Point-in-time child counts (None when not meaningful for a "user" breakdown)
    registered: Optional[int] = None
    fully_immunized: Optional[int] = None
    needs_attention: Optional[int] = None
    cases_open: Optional[int] = None
    cases_returned: Optional[int] = None
    # Activity within the selected date range
    doses_given: int = 0
    # "user" breakdown only
    tracing_attempts: Optional[int] = None
    cases_assigned: Optional[int] = None


class AggregateReportOut(BaseModel):
    group_by: str
    scope_label: str
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    rows: list[AggregateRow]
    totals: AggregateRow
