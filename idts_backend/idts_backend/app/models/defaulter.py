"""
Defaulter follow-up (design doc §6/§14/§15) + audit trail (§33).

DefaulterCase.reason and .risk_score_breakdown store the human-readable
explanation produced by app.domain.defaulter_engine — the whole point of
keeping that engine transparent (no black-box scoring) is defeated if the
"why" isn't persisted alongside the case, so both are stored, not just the
final priority label.
"""

import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, Float, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.db.guid import GUID, new_uuid


class DefaulterCase(Base, TimestampMixin):
    __tablename__ = "defaulter_cases"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)
    child_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("children.id"), nullable=False)
    schedule_entry_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("schedule_entries.id"), nullable=False)

    reason: Mapped[str] = mapped_column(Text, nullable=False)
    date_identified: Mapped[date] = mapped_column(Date, nullable=False)

    priority: Mapped[str] = mapped_column(String(20), nullable=False)  # high / medium / low
    risk_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    risk_score_breakdown: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    assigned_to_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID(), ForeignKey("users.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(40), default="open", nullable=False)
    # open / assigned / in_tracing / return_pending_confirmation / closed

    closure_reason: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    child: Mapped["Child"] = relationship(back_populates="defaulter_cases")  # noqa: F821
    tracing_attempts: Mapped[list["TracingAttempt"]] = relationship(
        back_populates="defaulter_case", cascade="all, delete-orphan"
    )


class TracingAttempt(Base, TimestampMixin):
    __tablename__ = "tracing_attempts"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)
    defaulter_case_id: Mapped[uuid.UUID] = mapped_column(GUID(), ForeignKey("defaulter_cases.id"), nullable=False)
    tracer_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID(), ForeignKey("users.id"), nullable=True)

    attempt_date: Mapped[date] = mapped_column(Date, nullable=False)
    method: Mapped[str] = mapped_column(String(50), nullable=False)
    outcome: Mapped[str] = mapped_column(String(50), nullable=False)
    next_followup_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    defaulter_case: Mapped[DefaulterCase] = relationship(back_populates="tracing_attempts")


class AuditLog(Base):
    """
    Append-only. No application role is ever granted UPDATE/DELETE on this
    table (enforced at the DB-user-grant level in the deployment guide, not
    just in application code) — design doc §33's "tamper-resistant" requirement.
    """

    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID(), ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    entity: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    before: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    after: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
