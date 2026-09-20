"""
Child registry + versioned immunization schedule (design doc §6/§7).

Caregiver info is kept inline on Child rather than a separate Caregiver
table + join table for the MVP — a deliberate, documented simplification
matching the frontend prototype (idts_prototype.jsx). The full ERD (§28)
calls for a separate Caregiver entity supporting multiple caregivers per
child; that's real scope for a later milestone once multi-caregiver
tracking is actually needed, not before.
"""

import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.db.guid import GUID, new_uuid


class Child(Base, TimestampMixin):
    __tablename__ = "children"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)
    system_id: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)

    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    sex: Mapped[str] = mapped_column(String(10), nullable=False)  # M / F / unknown
    dob: Mapped[date] = mapped_column(Date, nullable=False)
    dob_estimated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    community_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID(), ForeignKey("geographic_areas.id"), nullable=True)
    facility_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("facilities.id"), nullable=False)

    caregiver_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    caregiver_phone: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    caregiver_relationship: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    status: Mapped[str] = mapped_column(String(30), default="active", nullable=False)
    # active / transferred / deceased / moved_out / lost_to_followup

    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)  # soft delete

    facility: Mapped["Facility"] = relationship()  # noqa: F821 (registered via app.models package)
    vaccinations: Mapped[list["VaccinationEvent"]] = relationship(back_populates="child", cascade="all, delete-orphan")
    defaulter_cases: Mapped[list["DefaulterCase"]] = relationship(back_populates="child", cascade="all, delete-orphan")


class ImmunizationSchedule(Base, TimestampMixin):
    """A named, versioned schedule (e.g. one per country/programme config)."""

    __tablename__ = "immunization_schedules"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    entries: Mapped[list["ScheduleEntry"]] = relationship(back_populates="schedule", cascade="all, delete-orphan")


class ScheduleEntry(Base, TimestampMixin):
    """
    One dose row — mirrors app.domain.schedule_engine.ScheduleEntry exactly,
    so converting a DB row to the pure-domain dataclass is a 1:1 field copy
    (see app/services/schedule_service.py). All numeric values [CONFIG].
    """

    __tablename__ = "schedule_entries"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)
    schedule_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("immunization_schedules.id"), nullable=False)

    antigen: Mapped[str] = mapped_column(String(100), nullable=False)
    dose_number: Mapped[int] = mapped_column(Integer, nullable=False)

    recommended_age_days: Mapped[int] = mapped_column(Integer, nullable=False)
    minimum_age_days: Mapped[int] = mapped_column(Integer, nullable=False)
    minimum_interval_from_prior_dose_days: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    prior_entry_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID(), ForeignKey("schedule_entries.id"), nullable=True)

    due_soon_window_days: Mapped[int] = mapped_column(Integer, default=7, nullable=False)
    overdue_window_days: Mapped[int] = mapped_column(Integer, default=14, nullable=False)
    defaulter_threshold_days: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    maximum_catchup_age_days: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    display_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    schedule: Mapped[ImmunizationSchedule] = relationship(back_populates="entries")


class VaccinationEvent(Base, TimestampMixin):
    __tablename__ = "vaccination_events"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)
    child_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("children.id"), nullable=False)
    schedule_entry_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("schedule_entries.id"), nullable=False)

    event_date: Mapped[date] = mapped_column(Date, nullable=False)
    facility_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("facilities.id"), nullable=False)
    vaccinator_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID(), ForeignKey("users.id"), nullable=True)

    session_type: Mapped[str] = mapped_column(String(30), default="fixed", nullable=False)
    batch_lot_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Idempotency key for offline sync (design doc §9): a client-generated
    # value that lets a resubmitted transaction be recognized and answered
    # without creating a duplicate vaccination record.
    idempotency_key: Mapped[Optional[str]] = mapped_column(String(100), unique=True, nullable=True, index=True)

    child: Mapped[Child] = relationship(back_populates="vaccinations")
    schedule_entry: Mapped[ScheduleEntry] = relationship()
