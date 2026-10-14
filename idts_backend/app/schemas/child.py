import uuid
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    full_name: str
    username: str
    role: str
    facility_id: Optional[uuid.UUID] = None
    geographic_area_id: Optional[uuid.UUID] = None
    is_active: bool = True
    last_login_at: Optional[datetime] = None
    locked_until: Optional[datetime] = None


class ChildCreate(BaseModel):
    # Optional client-generated id. Devices that register a child offline
    # pick the id themselves so later offline entries (doses) can refer to
    # it, and so a resubmitted registration returns the same record.
    id: Optional[uuid.UUID] = None
    full_name: str = Field(min_length=1, max_length=200)
    sex: str = Field(pattern="^(M|F|unknown)$")
    dob: date
    dob_estimated: bool = False
    facility_id: uuid.UUID
    community_id: Optional[uuid.UUID] = None
    address: Optional[str] = Field(default=None, max_length=300)
    caregiver_name: Optional[str] = None
    caregiver_phone: Optional[str] = None
    caregiver_relationship: Optional[str] = None


class ChildUpdate(BaseModel):
    """
    All fields optional — a PATCH only needs to send what's actually
    changing. Deliberately excludes system_id, facility_id transfer, and
    status (those follow their own dedicated workflows per the design
    doc's transfer/closure rules, not a generic field edit).
    """
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    sex: Optional[str] = Field(default=None, pattern="^(M|F|unknown)$")
    dob: Optional[date] = None
    dob_estimated: Optional[bool] = None
    community_id: Optional[uuid.UUID] = None
    address: Optional[str] = Field(default=None, max_length=300)
    caregiver_name: Optional[str] = None
    caregiver_phone: Optional[str] = None
    caregiver_relationship: Optional[str] = None


class ChildOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    system_id: str
    full_name: str
    sex: str
    dob: date
    dob_estimated: bool
    facility_id: uuid.UUID
    community_id: Optional[uuid.UUID] = None
    address: Optional[str] = None
    caregiver_name: Optional[str] = None
    caregiver_phone: Optional[str] = None
    status: str
    created_at: datetime


class DuplicateCandidate(BaseModel):
    child: ChildOut
    match_reason: str


class DoseEvaluationOut(BaseModel):
    schedule_entry_id: uuid.UUID
    antigen: str
    dose_number: int
    status: str
    days_overdue: int
    reason: str
    eligible_date: Optional[date] = None
    dosage: Optional[str] = None
    route: Optional[str] = None
    site: Optional[str] = None


class ChildDetailOut(ChildOut):
    schedule: list[DoseEvaluationOut] = []
    fully_immunized: bool = False


class ChildSearchResult(ChildDetailOut):
    """Search result for the district-wide duplicate-check pane — same as
    ChildDetailOut plus the facility NAME (not just its id), so the
    searcher can see at a glance which facility a match is registered at."""
    facility_name: Optional[str] = None


class OfflineScheduleEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    antigen: str
    dose_number: int
    recommended_age_days: int
    minimum_age_days: int
    minimum_interval_from_prior_dose_days: Optional[int] = None
    prior_entry_id: Optional[uuid.UUID] = None
    due_soon_window_days: int
    overdue_window_days: int
    defaulter_threshold_days: int
    maximum_catchup_age_days: Optional[int] = None
    dosage: Optional[str] = None
    route: Optional[str] = None
    site: Optional[str] = None


class OfflineChild(ChildDetailOut):
    # Not "vaccinations": that name would pick up the ORM relationship.
    vaccination_history: list[dict] = []


class OfflinePack(BaseModel):
    """Everything a device needs to keep working without a connection."""
    generated_at: datetime
    truncated: bool = False
    schedule: list[OfflineScheduleEntry]
    children: list[OfflineChild]
