"""
Data-access scoping: which facilities' data may the current user see?

One place decides this, so dashboard, reports, children, due-list,
defaulter cases and vaccinations can never disagree with each other.

Levels (derived from the user's role):
  facility  -> facility_focal_person, vaccinator, chw, facility_supervisor
               see ONLY their own facility (User.facility_id) everywhere
               EXCEPT the report builder, which gives facility_supervisor
               and facility_focal_person their whole CHIEFDOM (see
               report_scope_facility_ids below) — vaccinator and chw get
               no report access at all, enforced separately.
  district  -> district_manager sees every facility under their assigned
               area (User.geographic_area_id = a district)
  national  -> national_user sees every facility under their assigned
               COUNTRY (User.geographic_area_id = a country) — so a
               second country's facilities stay invisible to them
  admin     -> system_admin sees everything, across every country

Works for any number of countries/districts: add more geography +
facilities, assign accounts to the right area, and nothing here changes.

"Fails closed": an account with no area/facility assigned sees NOTHING
rather than everything.
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

REPORT_ROLES = {"system_admin", "national_user", "district_manager", "facility_supervisor", "facility_focal_person"}
NO_REPORT_ACCESS_ROLES = {"vaccinator", "chw"}

# Which report breakdowns each level may request in the Aggregate report
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


def can_access_reports(user: User) -> bool:
    """Vaccinator and CHW get no report access at all — not a narrowed
    scope, no access. Enforced here so it can't be bypassed by calling the
    API directly, not just by hiding the Reports tab."""
    return user.role not in NO_REPORT_ACCESS_ROLES


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


def facility_ids_under_area(db: Session, area_id: uuid.UUID) -> list:
    area_ids = _descendant_area_ids(db, area_id)
    rows = db.query(Facility.id).filter(Facility.geographic_area_id.in_(area_ids)).all()
    return [r[0] for r in rows]


def accessible_facility_ids(db: Session, user: User) -> Optional[list]:
    """None means 'no restriction'. An empty list means 'nothing'. This is
    the EVERYDAY scope — Dashboard, Children, due-list, defaulter cases,
    vaccinations. Facility-level roles always get just their own facility
    here, regardless of role (that broadens only for reports — see
    report_scope_facility_ids)."""
    level = access_level(user)
    if level == LEVEL_ADMIN:
        return None
    if level == LEVEL_NATIONAL:
        return [] if not user.geographic_area_id else facility_ids_under_area(db, user.geographic_area_id)
    if level == LEVEL_DISTRICT:
        return [] if not user.geographic_area_id else facility_ids_under_area(db, user.geographic_area_id)
    return [user.facility_id] if user.facility_id else []


def report_scope_facility_ids(db: Session, user: User) -> Optional[list]:
    """
    Scope for the REPORT BUILDER specifically. Same as
    accessible_facility_ids() for admin/national/district. Different only
    for facility_supervisor and facility_focal_person, who may report on
    any facility in their own CHIEFDOM (not just their own facility) —
    per the access rules given when this report builder was specified.
    Call can_access_reports() first; this assumes the caller already has
    report access.
    """
    if user.role in ("facility_supervisor", "facility_focal_person"):
        if not user.facility_id:
            return []
        facility = db.query(Facility).filter(Facility.id == user.facility_id).first()
        if facility is None or facility.geographic_area_id is None:
            return []
        return facility_ids_under_area(db, facility.geographic_area_id)
    return accessible_facility_ids(db, user)


def report_root_area(db: Session, user: User) -> Optional[GeographicArea]:
    """
    The GeographicArea the report builder's Organizational Unit tree is
    rooted at for this user — i.e. the highest level they're allowed to
    pick. None for system_admin (every country is a root). None for
    everyone else means "not assigned — sees nothing" (fails closed).
    For facility_supervisor/facility_focal_person, the root is their own
    CHIEFDOM (matches report_scope_facility_ids above); for vaccinator/chw
    this is never called (no report access at all).
    """
    if user.role == "system_admin":
        return None
    if user.role in ("national_user", "district_manager"):
        if not user.geographic_area_id:
            return None
        return db.query(GeographicArea).filter(GeographicArea.id == user.geographic_area_id).first()
    if user.role in ("facility_supervisor", "facility_focal_person"):
        if not user.facility_id:
            return None
        facility = db.query(Facility).filter(Facility.id == user.facility_id).first()
        if facility is None or facility.geographic_area_id is None:
            return None
        return db.query(GeographicArea).filter(GeographicArea.id == facility.geographic_area_id).first()
    return None


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
    if level in (LEVEL_NATIONAL, LEVEL_DISTRICT):
        if not user.geographic_area_id:
            return "No area assigned"
        area = db.query(GeographicArea).filter(GeographicArea.id == user.geographic_area_id).first()
        return area.name if area else "No area assigned"
    if not user.facility_id:
        return "No facility assigned"
    facility = db.query(Facility).filter(Facility.id == user.facility_id).first()
    return facility.name if facility else "No facility assigned"
