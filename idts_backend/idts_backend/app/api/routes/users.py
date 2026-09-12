import re
import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_role
from app.core.security import hash_password
from app.db.session import get_db
from app.models.user import User
from app.schemas.child import UserOut
from app.schemas.user import CHWCreate

router = APIRouter(prefix="/api/v1/users", tags=["users"])


@router.get("", response_model=list[UserOut])
def list_users(
    role: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns active users for assignment dropdowns etc. Deliberately returns
    only the fields in UserOut (id/name/username/role/facility_id) — never
    the password hash, per design doc §32's data-minimization principle.
    """
    query = db.query(User).filter(User.is_active.is_(True))
    if role:
        query = query.filter(User.role == role)
    return query.order_by(User.full_name).all()


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


def _generate_username(db: Session, full_name: str) -> str:
    """
    CHWs are added on-the-fly by facility staff with no login system of
    their own yet (design note: no CHW roster exists for Kono District at
    seed time — see app/seed.py). A username is still required by the
    User model's schema, so we derive one from the name and disambiguate
    with a short random suffix rather than making the caller invent one.
    """
    base = re.sub(r"[^a-z0-9]+", "", full_name.lower()) or "chw"
    base = base[:20]
    for _ in range(10):
        candidate = f"{base}{secrets.token_hex(2)}"
        if not db.query(User).filter(User.username == candidate).first():
            return candidate
    return f"{base}{uuid.uuid4().hex[:8]}"


@router.post("/chw", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_chw(
    payload: CHWCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role("system_admin", "facility_focal_person", "facility_supervisor")
    ),
):
    """
    Lets a Facility In-Charge (or supervisor/admin) add a new Community
    Health Worker on the spot when assigning a defaulter case, since no
    pre-existing CHW roster is available yet for this district. The CHW
    gets a real account (so future tracing-attempt recording by the CHW
    themself is possible later) but with a system-generated placeholder
    password — this is a data-entry convenience, not a real login
    workflow yet, and should not be treated as one until CHWs are actually
    issued their own credentials.
    """
    if not payload.full_name.strip():
        raise HTTPException(status_code=400, detail="CHW name cannot be empty.")

    username = _generate_username(db, payload.full_name)
    placeholder_password = secrets.token_urlsafe(16)

    chw = User(
        id=uuid.uuid4(),
        full_name=payload.full_name.strip(),
        username=username,
        hashed_password=hash_password(placeholder_password),
        role="chw",
        facility_id=payload.facility_id or current_user.facility_id,
        is_active=True,
    )
    db.add(chw)
    db.commit()
    db.refresh(chw)
    return chw
