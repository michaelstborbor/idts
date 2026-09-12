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


class ChildCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)
    sex: str = Field(pattern="^(M|F|unknown)$")
    dob: date
    dob_estimated: bool = False
    facility_id: uuid.UUID
    community_id: Optional[uuid.UUID] = None
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


class ChildDetailOut(ChildOut):
    schedule: list[DoseEvaluationOut] = []
