from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import Facility, User
from app.schemas.facility import FacilityOut

router = APIRouter(prefix="/api/v1/facilities", tags=["facilities"])


@router.get("", response_model=list[FacilityOut])
def list_facilities(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(Facility).filter(Facility.is_active.is_(True)).order_by(Facility.name).all()
