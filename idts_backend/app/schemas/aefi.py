import uuid
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.domain.aefi_catalog import (
    CAUSE_CATEGORY_KEYS,
    EVENT_TYPE_KEYS,
    MANAGEMENT_ACTION_KEYS,
    OUTCOME_KEYS,
    SERIOUS_CRITERIA_KEYS,
    SEVERITY_KEYS,
)


def _check_keys(values: list, allowed: set, what: str) -> list:
    unknown = [v for v in values if v not in allowed]
    if unknown:
        raise ValueError(f"Unknown {what}: {', '.join(unknown)}")
    # keep order, drop duplicates
    return list(dict.fromkeys(values))


class AefiCreate(BaseModel):
    child_id: uuid.UUID
    # The recorded dose(s) suspected of causing the event — at least one.
    vaccination_event_ids: list[uuid.UUID] = Field(min_length=1)
    onset_date: date
    event_type: str
    event_description: Optional[str] = Field(default=None, max_length=2000)
    severity: str
    serious_criteria: list[str] = []
    part_of_cluster: bool = False
    cause_category: str = "under_investigation"
    outcome: str = "unknown"
    management_actions: list[str] = []
    management_notes: Optional[str] = Field(default=None, max_length=4000)
    reported_date: Optional[date] = None
    investigation_date: Optional[date] = None

    @field_validator("event_type")
    @classmethod
    def _event_type(cls, v):
        if v not in EVENT_TYPE_KEYS:
            raise ValueError("Unknown event type")
        return v

    @field_validator("severity")
    @classmethod
    def _severity(cls, v):
        if v not in SEVERITY_KEYS:
            raise ValueError("Severity must be mild, moderate or severe")
        return v

    @field_validator("cause_category")
    @classmethod
    def _cause(cls, v):
        if v not in CAUSE_CATEGORY_KEYS:
            raise ValueError("Unknown cause category")
        return v

    @field_validator("outcome")
    @classmethod
    def _outcome(cls, v):
        if v not in OUTCOME_KEYS:
            raise ValueError("Unknown outcome")
        return v

    @field_validator("serious_criteria")
    @classmethod
    def _criteria(cls, v):
        return _check_keys(v, SERIOUS_CRITERIA_KEYS, "seriousness criterion")

    @field_validator("management_actions")
    @classmethod
    def _actions(cls, v):
        return _check_keys(v, MANAGEMENT_ACTION_KEYS, "management action")

    @model_validator(mode="after")
    def _other_needs_description(self):
        if self.event_type == "other" and not (self.event_description or "").strip():
            raise ValueError("Describe the event when the type is 'Other'")
        return self


class AefiUpdate(BaseModel):
    """Every field optional: send only what changed. The child cannot be
    changed (record a new AEFI for a different child instead)."""

    vaccination_event_ids: Optional[list[uuid.UUID]] = Field(default=None, min_length=1)
    onset_date: Optional[date] = None
    event_type: Optional[str] = None
    event_description: Optional[str] = Field(default=None, max_length=2000)
    severity: Optional[str] = None
    serious_criteria: Optional[list[str]] = None
    part_of_cluster: Optional[bool] = None
    cause_category: Optional[str] = None
    outcome: Optional[str] = None
    management_actions: Optional[list[str]] = None
    management_notes: Optional[str] = Field(default=None, max_length=4000)
    reported_date: Optional[date] = None
    investigation_date: Optional[date] = None

    @field_validator("event_type")
    @classmethod
    def _event_type(cls, v):
        if v is not None and v not in EVENT_TYPE_KEYS:
            raise ValueError("Unknown event type")
        return v

    @field_validator("severity")
    @classmethod
    def _severity(cls, v):
        if v is not None and v not in SEVERITY_KEYS:
            raise ValueError("Severity must be mild, moderate or severe")
        return v

    @field_validator("cause_category")
    @classmethod
    def _cause(cls, v):
        if v is not None and v not in CAUSE_CATEGORY_KEYS:
            raise ValueError("Unknown cause category")
        return v

    @field_validator("outcome")
    @classmethod
    def _outcome(cls, v):
        if v is not None and v not in OUTCOME_KEYS:
            raise ValueError("Unknown outcome")
        return v

    @field_validator("serious_criteria")
    @classmethod
    def _criteria(cls, v):
        return None if v is None else _check_keys(v, SERIOUS_CRITERIA_KEYS, "seriousness criterion")

    @field_validator("management_actions")
    @classmethod
    def _actions(cls, v):
        return None if v is None else _check_keys(v, MANAGEMENT_ACTION_KEYS, "management action")


class AefiVaccinationOut(BaseModel):
    vaccination_event_id: uuid.UUID
    antigen: str
    dose_number: int
    event_date: date
    batch_lot_number: Optional[str] = None


class AefiOut(BaseModel):
    id: uuid.UUID
    aefi_number: str
    child_id: uuid.UUID
    child_name: str
    child_system_id: str
    facility_name: Optional[str] = None
    onset_date: date
    event_type: str
    event_type_label: str
    event_description: Optional[str] = None
    severity: str
    serious_criteria: list[str]
    is_serious: bool
    part_of_cluster: bool
    cause_category: str
    outcome: str
    management_actions: list[str]
    management_notes: Optional[str] = None
    reported_date: Optional[date] = None
    investigation_date: Optional[date] = None
    # "not_required" (not serious) / "done" / "pending" / "overdue" — measured
    # from when the record was created in the system, against the 24h report
    # and 48h investigation targets for serious AEFIs.
    report_status: str
    investigation_status: str
    vaccinations: list[AefiVaccinationOut]
    recorded_by_name: Optional[str] = None
    created_at: datetime


class AefiSuggestionOut(BaseModel):
    actions: list[str]
    guidance: list[str]
    report_timeline: str


class EligibleVaccinationOut(BaseModel):
    vaccination_event_id: uuid.UUID
    antigen: str
    dose_number: int
    event_date: date
    batch_lot_number: Optional[str] = None
