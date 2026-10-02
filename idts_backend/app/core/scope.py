"""
Data-access scoping: which facilities' data may the current user see?

One place decides this, so dashboard, reports, children, due-list,
defaulter cases and vaccinations can never disagree with each other.

Levels (derived from the user's role):
  facility  -> facility_focal_person, vaccinator, chw, facility_supervisor
               see ONLY their own facility (User.facility_id)
  district  -> district_manager sees every facility located anywhere under
               their assigned area (User.geographic_area_id, normally a
               district). Works for any number of districts: add another
               district + its facilities, assign a district_manager to it,
               and nothing here changes.
  national  -> national_user sees all facilities in the country
  admin     -> system_admin sees everything, across every country/district
               present in the database

"Fails closed": a facility-level user with no facility, or a district
manager with no district, sees NOTHING rather than everything.
"""

import uuid
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import false
from sqlalchemy.orm import Session

from app.models.user import Facility, GeographicArea, User

LEVEL_FACILITY = "facility"
LEVEL_DISTRICT = "district"
LEVEL_NATIONAL = "national"
LEVEL_ADMIN = "admin"

# Which report breakdowns each level may request
LEVEL_GROUPINGS = {
    LEVEL_FACILITY: ["facility", "user"],
    LEVEL_DISTRICT: ["facility", "user", "chiefdom"],
    LEVEL_NATIONAL: ["facility", "user", "chiefdom", "district"],
    LEVEL_ADMIN: ["facility", "user", "chiefdom", "district", "country"],
}


def access_level(user: User) -> str:
    if user.role == "system_admin":
        return LEVEL_ADMIN
    if user.role == "national_user":
        return LEVEL_NATIONAL
    if user.role == "district_manager":
        return LEVEL_DISTRICT
    return LEVEL_FACILITY


def _descendant_area_ids(db: Session, root_id: uuid.UUID) -> set:
    rows = db.query(GeographicArea.id, GeographicArea.parent_id).all()
    children_of: dict = {}
    for area_id, parent_id in rows:
        children_of.setdefault(parent_id, []).append(area_id)
    found = {root_id}
    stack = [root_id]
    while stack:
        current = stack.pop()
        for child_id in children_of.get(current, []):
            if child_id not in found:
                found.add(child_id)
                stack.append(child_id)
    return found


def accessible_facility_ids(db: Session, user: User) -> Optional[list]:
    """None means 'no restriction'. An empty list means 'nothing'."""
    level = access_level(user)
    if level in (LEVEL_ADMIN, LEVEL_NATIONAL):
        return None
    if level == LEVEL_DISTRICT:
        if not user.geographic_area_id:
            return []
        area_ids = _descendant_area_ids(db, user.geographic_area_id)
        rows = db.query(Facility.id).filter(Facility.geographic_area_id.in_(area_ids)).all()
        return [r[0] for r in rows]
    return [user.facility_id] if user.facility_id else []


def resolve_facility_scope(db: Session, user: User, requested_facility_id: Optional[uuid.UUID] = None) -> Optional[list]:
    """Scope for a request that may also ask for one specific facility."""
    ids = accessible_facility_ids(db, user)
    if requested_facility_id is None:
        return ids
    if ids is not None and requested_facility_id not in ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have access to that facility.")
    return [requested_facility_id]


def restrict(query, column, ids: Optional[list]):
    """Apply a scope (from the functions above) to a SQLAlchemy query."""
    if ids is None:
        return query
    if not ids:
        return query.filter(false())
    return query.filter(column.in_(ids))


def ensure_facility_in_scope(db: Session, user: User, facility_id: Optional[uuid.UUID]) -> None:
    if facility_id is None:
        return
    ids = accessible_facility_ids(db, user)
    if ids is not None and facility_id not in ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have access to that facility.")


def ensure_child_in_scope(db: Session, user: User, child) -> None:
    """Out-of-scope children look exactly like nonexistent ones (404), so a
    user can't even confirm that a child exists at another facility."""
    ids = accessible_facility_ids(db, user)
    if ids is not None and child.facility_id not in ids:
        raise HTTPException(status_code=404, detail="Child not found")


def scope_label(db: Session, user: User) -> str:
    level = access_level(user)
    if level == LEVEL_ADMIN:
        return "All data (system-wide)"
    if level == LEVEL_NATIONAL:
        return "All facilities (national)"
    if level == LEVEL_DISTRICT:
        if not user.geographic_area_id:
            return "No district assigned"
        area = db.query(GeographicArea).filter(GeographicArea.id == user.geographic_area_id).first()
        return area.name if area else "No district assigned"
    if not user.facility_id:
        return "No facility assigned"
    facility = db.query(Facility).filter(Facility.id == user.facility_id).first()
    return facility.name if facility else "No facility assigned"
