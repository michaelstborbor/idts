"""
Adverse Events Following Immunization (AEFI) records.

One AefiEvent is one adverse event for one child. It is linked to the
specific recorded vaccination(s) suspected of causing it (AefiVaccination),
so reports can be broken down by antigen and the batch/lot number is
traceable. Access is scoped through the CHILD's facility, exactly like every
other child-linked record (see app/core/scope.py) — AEFI has no separate
facility column that could disagree with the child's.

Severity (mild/moderate/severe) and seriousness (WHO/ICH criteria) are
stored separately on purpose — see app/domain/aefi_catalog.py.
"""

import uuid
from datetime import date
from typing import Optional

from sqlalchemy import Boolean, Date, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.db.guid import GUID, new_uuid


class AefiEvent(Base, TimestampMixin):
    __tablename__ = "aefi_events"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)
    aefi_number: Mapped[str] = mapped_column(String(30), unique=True, nullable=False, index=True)

    child_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("children.id"), nullable=False, index=True)
    onset_date: Mapped[date] = mapped_column(Date, nullable=False)

    event_type: Mapped[str] = mapped_column(String(50), nullable=False)
    event_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    severity: Mapped[str] = mapped_column(String(20), nullable=False)  # mild / moderate / severe

    # Comma-separated keys from SERIOUS_CRITERIA; is_serious is derived from
    # it on every write so it can be filtered/counted in SQL.
    serious_criteria: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    is_serious: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    part_of_cluster: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    cause_category: Mapped[str] = mapped_column(String(50), default="under_investigation", nullable=False)
    outcome: Mapped[str] = mapped_column(String(30), default="unknown", nullable=False)

    management_actions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # comma-separated keys
    management_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    reported_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)  # reported to the next level
    investigation_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    recorded_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID(), ForeignKey("users.id"), nullable=True)

    vaccinations: Mapped[list["AefiVaccination"]] = relationship(
        back_populates="aefi", cascade="all, delete-orphan"
    )


class AefiVaccination(Base):
    """Links an AEFI to the recorded dose(s) suspected of causing it."""

    __tablename__ = "aefi_vaccinations"
    __table_args__ = (UniqueConstraint("aefi_id", "vaccination_event_id", name="uq_aefi_vaccination"),)

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)
    aefi_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("aefi_events.id"), nullable=False, index=True)
    vaccination_event_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("vaccination_events.id"), nullable=False, index=True
    )

    aefi: Mapped[AefiEvent] = relationship(back_populates="vaccinations")
