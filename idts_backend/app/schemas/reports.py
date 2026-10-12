from datetime import date
from typing import Optional

from pydantic import BaseModel


class VaccinationSummaryRow(BaseModel):
    antigen: str
    dose_number: int
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
    aefi_events: Optional[int] = None
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


class VaccineOut(BaseModel):
    antigen: str


class DoseByVaccine(BaseModel):
    antigen: str
    doses_given: int


class DoseByAntigenDose(BaseModel):
    """Doses given for ONE dose of ONE antigen (e.g. OPV dose 2). Listed for
    every dose of every selected antigen, including those with zero given."""
    antigen: str
    dose_number: int
    doses_given: int


class AefiCountByType(BaseModel):
    event_type: str
    label: str
    count: int


class AefiCountByAntigen(BaseModel):
    antigen: str
    count: int


class AefiSummary(BaseModel):
    """Adverse events following immunization (onset date within the report
    period) for the chosen unit. If vaccines were selected, only AEFIs linked
    to at least one of them are counted. An AEFI linked to two antigens counts
    once in the totals and once under each antigen."""
    total: int = 0
    mild: int = 0
    moderate: int = 0
    severe: int = 0
    serious: int = 0
    serious_awaiting_report: int = 0
    by_event_type: list[AefiCountByType] = []
    by_antigen: list[AefiCountByAntigen] = []


class GeneratedReportOut(BaseModel):
    """The new 3-step report: Organizational Unit + Data (vaccines) + Period.
    A separate, simpler report from the Aggregate report above — this one
    is a single set of totals for ONE chosen unit, not a breakdown table."""
    unit_level: str  # country / district / chiefdom / facility
    unit_name: str
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    vaccines_included: list[str]
    registered: int
    fully_immunized: int
    needs_attention: int
    doses_given_total: int
    doses_by_vaccine: list[DoseByVaccine]
    doses_by_dose: list[DoseByAntigenDose] = []
    aefi: AefiSummary = AefiSummary()
    cases_open: int
    cases_returned: int
