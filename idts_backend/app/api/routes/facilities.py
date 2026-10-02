from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.core.scope import accessible_facility_ids, restrict
from app.db.session import get_db
from app.models.user import Facility, GeographicArea, User
from app.schemas.facility import DistrictOut, FacilityOut

router = APIRouter(prefix="/api/v1/facilities", tags=["facilities"])


@router.get("", response_model=list[FacilityOut])
def list_facilities(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Only the facilities this user is allowed to see (their own facility,
    their district's facilities, or all — see app/core/scope.py)."""
    query = db.query(Facility).filter(Facility.is_active.is_(True))
    query = restrict(query, Facility.id, accessible_facility_ids(db, current_user))
    return query.order_by(Facility.name).all()


@router.get("/districts", response_model=list[DistrictOut])
def list_districts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Districts, for assigning a district-level account to its district."""
    return db.query(GeographicArea).filter(GeographicArea.level == "district").order_by(GeographicArea.name).all()
