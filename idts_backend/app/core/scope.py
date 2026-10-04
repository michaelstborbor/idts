"""
Data-access scoping: which facilities' data may the current user see?

One place decides this, so dashboard, reports, children, due-list,
defaulter cases, vaccinations, and user-account visibility can never
disagree with each other.

Levels (derived from the user's role) — each tier owns a different kind
of geography node:
  facility  -> facility_focal_person, vaccinator, chw: own facility only
               (User.facility_id). No filtering, nothing wider, anywhere
               — including Reports.
  chiefdom  -> facility_supervisor: every facility in their assigned
               CHIEFDOM (User.geographic_area_id = a chiefdom)
  district  -> district_manager: every facility in their assigned
               DISTRICT (User.geographic_area_id = a district)
  national  -> national_user: every facility in their assigned COUNTRY
               (User.geographic_area_id = a country)
  admin     -> system_admin: everything, across every country

This is also, deliberately, each role's Reports access and Dashboard/
Children access — they're the same scope now, not two different rules
(an earlier version of this file gave facility_supervisor and
facility_focal_person a wider "reports-only" scope; that's gone, because
facility_supervisor's own assigned level is now a chiefdom, so there's
nothing left to widen to).

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
LEVEL_CHIEFDOM = "chiefdom"
LEVEL_DISTRICT = "district"
LEVEL_NATIONAL = "national"
LEVEL_ADMIN = "admin"

REPORT_ROLES = {"system_admin", "national_user", "district_manager", "facility_supervisor", "facility_focal_person"}
NO_REPORT_ACCESS_ROLES = {"vaccinator", "chw"}
FACILITY_ONLY_ROLES = {"facility_focal_person", "vaccinator", "chw"}
AREA_ASSIGNED_ROLES = {"national_user", "district_manager", "facility_supervisor"}  # use geographic_area_id

# Which report breakdowns each level may request in the Aggregate report
LEVEL_GROUPINGS = {
    LEVEL_FACILITY: ["facility", "user"],
    LEVEL_CHIEFDOM: ["facility", "user"],
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
    if user.role == "facility_supervisor":
        return LEVEL_CHIEFDOM
    return LEVEL_FACILITY


def can_access_reports(user: User) -> bool:
    """Vaccinator and CHW get no report access at all — not a narrowed
    scope, no access. Enforced here so it can't be bypassed by calling the
    API directly, not just by hiding the Reports tab."""
    return user.role not in NO_REPORT_ACCESS_ROLES


def _ancestor_of_level(areas: dict, area_id, level: str):
    """Walks a GeographicArea's parent chain to find its ancestor at the
    given level (e.g. a chiefdom's district, or its country)."""
    current = areas.get(area_id) if area_id else None
    hops = 0
    while current is not None and hops < 10:
        if current.level == level:
            return current
        current = areas.get(current.parent_id) if current.parent_id else None
        hops += 1
    return None


def facility_ids_under_area(db: Session, area_id: uuid.UUID) -> list:
    rows = db.query(GeographicArea.id, GeographicArea.parent_id).all()
    children_of: dict = {}
    for a_id, parent_id in rows:
        children_of.setdefault(parent_id, []).append(a_id)
    found = {area_id}
    stack = [area_id]
    while stack:
        current = stack.pop()
        for child_id in children_of.get(current, []):
            if child_id not in found:
                found.add(child_id)
                stack.append(child_id)
    facility_rows = db.query(Facility.id).filter(Facility.geographic_area_id.in_(found)).all()
    return [r[0] for r in facility_rows]


def accessible_facility_ids(db: Session, user: User) -> Optional[list]:
    """None means 'no restriction'. An empty list means 'nothing'. This is
    THE scope — Dashboard, Children, due-list, defaulter cases,
    vaccinations, user-account visibility, AND Reports (see module
    docstring: these are no longer different rules)."""
    if user.role == "system_admin":
        return None
    if user.role in AREA_ASSIGNED_ROLES:
        return [] if not user.geographic_area_id else facility_ids_under_area(db, user.geographic_area_id)
    return [user.facility_id] if user.facility_id else []


def registration_root_area(db: Session, user: User) -> Optional[GeographicArea]:
    """
    The broadest GeographicArea node this user may browse under in a
    cascading picker (Admin > Create/Edit user, child registration,
    Reports' Organizational Unit step for anyone above facility level).
    None for system_admin (every country is a root). Unlike a bare facility
    id, this ALWAYS resolves to an area, even for facility-only roles — via
    their facility's own chiefdom — because the registration cascade still
    needs to show which District/Chiefdom that one facility sits in.
    """
    if user.role == "system_admin":
        return None
    if user.role in AREA_ASSIGNED_ROLES:
        if not user.geographic_area_id:
            return None
        return db.query(GeographicArea).filter(GeographicArea.id == user.geographic_area_id).first()
    if user.role in FACILITY_ONLY_ROLES:
        if not user.facility_id:
            return None
        facility = db.query(Facility).filter(Facility.id == user.facility_id).first()
        if facility is None or facility.geographic_area_id is None:
            return None
        return db.query(GeographicArea).filter(GeographicArea.id == facility.geographic_area_id).first()
    return None


def report_root_area(db: Session, user: User) -> Optional[GeographicArea]:
    """
    Like registration_root_area, but for the REPORTS Organizational Unit
    picker specifically: returns None for facility-only roles on purpose
    (facility_focal_person/vaccinator/chw) — they get NO filter UI at all,
    just their one fixed facility and nothing wider, per the access rules
    for Reports. admin/national/district/chiefdom-level roles are
    identical to registration_root_area.
    """
    if user.role in FACILITY_ONLY_ROLES:
        return None
    return registration_root_area(db, user)


def fixed_report_facility_id(user: User) -> Optional[uuid.UUID]:
    """For facility-only roles, Reports has no picker at all — just their
    one facility. None for every other role (they get a real picker)."""
    return user.facility_id if user.role in FACILITY_ONLY_ROLES else None


def district_search_scope_facility_ids(db: Session, user: User) -> Optional[list]:
    """
    Scope for the 'Search for child' duplicate-check pane next to
    Register child: the user's whole DISTRICT — wider than their everyday
    access for facility_supervisor (chiefdom) and the facility-only roles
    (one facility), so a child who moved facilities within the district is
    still found before a duplicate gets registered. For district_manager,
    national_user and system_admin this is identical to their everyday
    scope (already district-or-wider) — no additional widening needed or
    given. This is the one deliberate, narrow exception to normal scope
    anywhere in the system, and it only ever widens READ access for this
    one search action — it does not change what a user can edit, record
    doses against, or see anywhere else.
    """
    level = access_level(user)
    if level in (LEVEL_ADMIN, LEVEL_NATIONAL, LEVEL_DISTRICT):
        return accessible_facility_ids(db, user)
    root = registration_root_area(db, user)  # their chiefdom, directly or via facility
    if root is None:
        return []
    areas = {a.id: a for a in db.query(GeographicArea).all()}
    district = root if root.level == "district" else _ancestor_of_level(areas, root.id, "district")
    return [] if district is None else facility_ids_under_area(db, district.id)


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
    if user.role == "system_admin":
        return "All data (system-wide)"
    if user.role in AREA_ASSIGNED_ROLES:
        if not user.geographic_area_id:
            return "No area assigned"
        area = db.query(GeographicArea).filter(GeographicArea.id == user.geographic_area_id).first()
        return area.name if area else "No area assigned"
    if not user.facility_id:
        return "No facility assigned"
    facility = db.query(Facility).filter(Facility.id == user.facility_id).first()
    return facility.name if facility else "No facility assigned"
