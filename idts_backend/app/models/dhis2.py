"""
History of data sent to DHIS2: one row per send (or test send), with the
import summary DHIS2 returned, so administrators can see what reached the
national HMIS and when.
"""

import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, utcnow
from app.db.guid import GUID, new_uuid


class Dhis2Export(Base):
    __tablename__ = "dhis2_exports"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID(), ForeignKey("users.id"), nullable=True)
    period: Mapped[str] = mapped_column(String(10), nullable=False)
    dry_run: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)  # success | warning | error
    values_sent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    imported: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    updated: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    ignored: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    message: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    conflicts: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
