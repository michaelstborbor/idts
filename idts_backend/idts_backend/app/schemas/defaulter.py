import uuid
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.child import ChildOut, DoseEvaluationOut


class VaccinationCreate(BaseModel):
    schedule_entry_id: uuid.UUID
    event_date: date
    facility_id: uuid.UUID
    session_type: str = "fixed"
    batch_lot_number: Optional[str] = None
    notes: Optional[str] = None
    # Client-generated key so a resubmitted offline transaction (design doc
    # §9) is recognized instead of creating a duplicate vaccination event.
    idempotency_key: Optional[str] = Field(default=None, max_length=100)


class VaccinationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    child_id: uuid.UUID
    schedule_entry_id: uuid.UUID
    event_date: date
    facility_id: uuid.UUID
    session_type: str
    batch_lot_number: Optional[str] = None
    notes: Optional[str] = None


class DueListRow(BaseModel):
    child: ChildOut
    dose: DoseEvaluationOut
    priority: Optional[str] = None
    risk_score: Optional[float] = None


class DefaulterAssignRequest(BaseModel):
    child_id: uuid.UUID
    schedule_entry_id: uuid.UUID
    assigned_to_id: uuid.UUID


class TracingAttemptCreate(BaseModel):
    method: str
    outcome: str
    next_followup_date: Optional[date] = None
    notes: Optional[str] = None


class TracingAttemptOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    defaulter_case_id: uuid.UUID
    attempt_date: date
    method: str
    outcome: str
    next_followup_date: Optional[date] = None
    notes: Optional[str] = None


class DefaulterCaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    child_id: uuid.UUID
    schedule_entry_id: uuid.UUID
    reason: str
    date_identified: date
    priority: str
    risk_score: float
    risk_score_breakdown: Optional[dict] = None
    assigned_to_id: Optional[uuid.UUID] = None
    status: str
    closure_reason: Optional[str] = None
    closed_at: Optional[datetime] = None
    tracing_attempts: list[TracingAttemptOut] = []


class CaseCloseRequest(BaseModel):
    closure_reason: str
