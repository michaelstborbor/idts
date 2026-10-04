import uuid
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.core.scope import accessible_facility_ids, registration_root_area, restrict
from app.db.session import get_db
from app.models.user import Facility, GeographicArea, User
from app.schemas.facility import AreaOut, FacilityOut

router = APIRouter(prefix="/api/v1/facilities", tags=["facilities"])


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


def _with_chiefdom_and_district(db: Session, facilities: list) -> list:
    """Attaches each facility's chiefdom and district (id + name), so the
    frontend can show e.g. "Ngelehun (Badjia, Bo District)" and filter
    facility pickers by chiefdom."""
    areas = {a.id: a for a in db.query(GeographicArea).all()}
    out = []
    for f in facilities:
        chiefdom = areas.get(f.geographic_area_id) if f.geographic_area_id else None
        district = _ancestor_of_level(areas, chiefdom.id, "district") if chiefdom else None
        out.append(FacilityOut(
            id=f.id, name=f.name, facility_type=f.facility_type,
            chiefdom_id=chiefdom.id if chiefdom else None,
            chiefdom=chiefdom.name if chiefdom else None,
            district_id=district.id if district else None,
            district=district.name if district else None,
        ))
    return out


# ---------------------------------------------------------------------------
# Geography pickers: countries / districts / chiefdoms. Every role gets a
# result here, not just admin/national/district — a chiefdom- or facility-
# level account browsing Child registration or (for roles with report
# access) the Reports Organizational Unit step needs to see the single
# district/chiefdom their own area or facility sits in, same idea as
# registration_root_area in app/core/scope.py, which powers all of this.
# ---------------------------------------------------------------------------

@router.get("/countries", response_model=list[AreaOut])
def list_countries(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role == "system_admin":
        return db.query(GeographicArea).filter(GeographicArea.level == "country").order_by(GeographicArea.name).all()
    root = registration_root_area(db, current_user)
    if root is None:
        return []
    areas = {a.id: a for a in db.query(GeographicArea).all()}
    country = root if root.level == "country" else _ancestor_of_level(areas, root.id, "country")
    return [country] if country else []


@router.get("/districts", response_model=list[AreaOut])
def list_districts(
    country_id: Optional[uuid.UUID] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    areas = {a.id: a for a in db.query(GeographicArea).all()}

    if current_user.role == "system_admin":
        query = db.query(GeographicArea).filter(GeographicArea.level == "district")
        if country_id:
            query = query.filter(GeographicArea.id.in_(
                [a.id for a in areas.values() if a.level == "district" and _ancestor_of_level(areas, a.id, "country") and _ancestor_of_level(areas, a.id, "country").id == country_id]
            ))
        return query.order_by(GeographicArea.name).all()

    if current_user.role == "national_user":
        root = registration_root_area(db, current_user)  # their country
        if not root:
            return []
        return db.query(GeographicArea).filter(GeographicArea.level == "district", GeographicArea.parent_id == root.id).order_by(GeographicArea.name).all()

    # district_manager, facility_supervisor, and the three facility-only
    # roles: exactly one district — the one they're in or under.
    root = registration_root_area(db, current_user)
    if root is None:
        return []
    district = root if root.level == "district" else _ancestor_of_level(areas, root.id, "district")
    return [district] if district else []


@router.get("/chiefdoms", response_model=list[AreaOut])
def list_chiefdoms(
    district_id: Optional[uuid.UUID] = None,
    country_id: Optional[uuid.UUID] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """district_id narrows to one district; country_id narrows to every
    chiefdom in a country regardless of district."""
    areas = {a.id: a for a in db.query(GeographicArea).all()}

    def chiefdoms_in_district(d_id):
        return [a for a in areas.values() if a.level == "chiefdom" and a.parent_id == d_id]

    def chiefdoms_in_country(c_id):
        return [a for a in areas.values() if a.level == "chiefdom" and _ancestor_of_level(areas, a.id, "country") and _ancestor_of_level(areas, a.id, "country").id == c_id]

    if current_user.role == "system_admin":
        if district_id:
            result = chiefdoms_in_district(district_id)
        elif country_id:
            result = chiefdoms_in_country(country_id)
        else:
            result = [a for a in areas.values() if a.level == "chiefdom"]
        return sorted(result, key=lambda a: a.name)

    if current_user.role == "national_user":
        root = registration_root_area(db, current_user)  # their country
        if not root:
            return []
        if district_id:
            district = areas.get(district_id)
            if not district or _ancestor_of_level(areas, district.id, "country") is None or _ancestor_of_level(areas, district.id, "country").id != root.id:
                return []
            result = chiefdoms_in_district(district_id)
        else:
            result = chiefdoms_in_country(root.id)
        return sorted(result, key=lambda a: a.name)

    if current_user.role == "district_manager":
        root = registration_root_area(db, current_user)  # their district
        if not root:
            return []
        return sorted(chiefdoms_in_district(root.id), key=lambda a: a.name)

    # facility_supervisor (assigned directly to a chiefdom) and the three
    # facility-only roles (via their facility's chiefdom): exactly one.
    root = registration_root_area(db, current_user)
    if root is None:
        return []
    chiefdom = root if root.level == "chiefdom" else _ancestor_of_level(areas, root.id, "chiefdom")
    return [chiefdom] if chiefdom else []


@router.get("", response_model=list[FacilityOut])
def list_facilities(
    chiefdom_id: Optional[uuid.UUID] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Only the facilities this user is allowed to see (app/core/scope.py).
    Pass chiefdom_id to narrow to one chiefdom (e.g. a cascading picker's
    last step)."""
    query = db.query(Facility).filter(Facility.is_active.is_(True))
    query = restrict(query, Facility.id, accessible_facility_ids(db, current_user))
    if chiefdom_id:
        query = query.filter(Facility.geographic_area_id == chiefdom_id)
    facilities = query.order_by(Facility.name).all()
    return _with_chiefdom_and_district(db, facilities)
