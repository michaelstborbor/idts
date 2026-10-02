from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.core.scope import accessible_facility_ids, restrict
from app.db.session import get_db
from app.models.user import Facility, GeographicArea, User
from app.schemas.facility import DistrictOut, FacilityOut

router = APIRouter(prefix="/api/v1/facilities", tags=["facilities"])


def _with_chiefdom_and_district(db: Session, facilities: list[Facility]) -> list[FacilityOut]:
    """
    Attaches each facility's chiefdom and district name, so the frontend can
    show e.g. "Ngelehun (Badjia, Bo District)" instead of a bare facility
    name — needed now that several districts' facilities share one list.
    Two hops up the geography tree: facility -> chiefdom -> district.
    """
    areas = {a.id: a for a in db.query(GeographicArea).all()}
    out = []
    for f in facilities:
        chiefdom = areas.get(f.geographic_area_id) if f.geographic_area_id else None
        district = areas.get(chiefdom.parent_id) if chiefdom and chiefdom.parent_id else None
        out.append(FacilityOut(
            id=f.id, name=f.name, facility_type=f.facility_type,
            chiefdom=chiefdom.name if chiefdom else None,
            district=district.name if district else None,
        ))
    return out


@router.get("", response_model=list[FacilityOut])
def list_facilities(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Only the facilities this user is allowed to see (their own facility,
    their district's facilities, or all — see app/core/scope.py). Each
    facility carries its chiefdom and district name (see helper above)."""
    query = db.query(Facility).filter(Facility.is_active.is_(True))
    query = restrict(query, Facility.id, accessible_facility_ids(db, current_user))
    facilities = query.order_by(Facility.name).all()
    return _with_chiefdom_and_district(db, facilities)


@router.get("/districts", response_model=list[DistrictOut])
def list_districts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Districts, for assigning a district-level account to its district."""
    return db.query(GeographicArea).filter(GeographicArea.level == "district").order_by(GeographicArea.name).all()
