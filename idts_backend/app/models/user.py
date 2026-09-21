"""
Users, roles, facilities, and a lightweight geography model.

Roles are a plain string enum rather than a separate permissions table —
the design doc's roles matrix (§4) is enforced in route-level dependencies
(app/core/security.py's require_role), not modeled as granular per-action
DB rows. That's a deliberate scope reduction for the MVP: a fully granular
permissions table is listed as real ERD scope (§28) but isn't needed until
we have more than a handful of fixed roles.
"""

import uuid
from typing import Optional

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.db.guid import GUID, new_uuid

# Roles from design doc §4. Kept as plain strings (not a DB enum) so new
# roles can be added via a code change + migration without an ALTER TYPE.
ROLES = [
    "system_admin",
    "facility_focal_person",
    "vaccinator",
    "chw",
    "facility_supervisor",
    "district_manager",
    "national_user",
]


class GeographicArea(Base, TimestampMixin):
    """Self-referencing hierarchy: Country -> Province -> District -> Chiefdom -> Community (§5)."""

    __tablename__ = "geographic_areas"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    level: Mapped[str] = mapped_column(String(50), nullable=False)  # country/province/district/chiefdom/community
    parent_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID(), ForeignKey("geographic_areas.id"), nullable=True)

    parent: Mapped[Optional["GeographicArea"]] = relationship(remote_side=[id])


class Facility(Base, TimestampMixin):
    __tablename__ = "facilities"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    facility_type: Mapped[str] = mapped_column(String(50), nullable=False, default="phu")  # [CONFIG]
    geographic_area_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID(), ForeignKey("geographic_areas.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    geographic_area: Mapped[Optional[GeographicArea]] = relationship()


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=new_uuid)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False)
    facility_id: Mapped[Optional[uuid.UUID]] = mapped_column(GUID(), ForeignKey("facilities.id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    facility: Mapped[Optional[Facility]] = relationship()
