import re
import secrets
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, require_role
from app.core.security import hash_password, verify_password
from app.db.session import get_db
from app.models.user import ROLES, User
from app.schemas.child import UserOut
from app.schemas.user import CHWCreate, PasswordChangeRequest, ProfileUpdate, UserAdminUpdate, UserCreate

router = APIRouter(prefix="/api/v1/users", tags=["users"])


@router.get("", response_model=list[UserOut])
def list_users(
    role: Optional[str] = None,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns users for assignment dropdowns (active-only, any authenticated
    user) or full account management (system_admin only, via
    include_inactive). A non-admin passing include_inactive is silently
    ignored rather than erroring — the common CHW-dropdown call site
    shouldn't need to know or care about this distinction.
    """
    query = db.query(User)
    if not (include_inactive and current_user.role == "system_admin"):
        query = query.filter(User.is_active.is_(True))
    if role:
        query = query.filter(User.role == role)
    return query.order_by(User.full_name).all()


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/me", response_model=UserOut)
def update_my_profile(
    payload: ProfileUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Self-service profile edit — deliberately limited to full_name.
    Username, role, and facility assignment are access-control decisions
    and stay admin-only (see update_user below)."""
    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(current_user, field, value.strip() if isinstance(value, str) else value)
    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/me/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_my_password(
    payload: PasswordChangeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect.")
    if payload.new_password == payload.current_password:
        raise HTTPException(status_code=400, detail="New password must be different from the current password.")
    current_user.hashed_password = hash_password(payload.new_password)
    db.commit()
    return None


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


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("system_admin")),
):
    """
    Full account creation with any role and an explicit password —
    system_admin only, per the design doc's roles matrix (§4: only
    System Admin manages users). This is the "allow multiple user login
    creation by Admin" feature; the CHW quick-add above stays as a
    separate, narrower, lower-friction path for facility staff who aren't
    admins.
    """
    if payload.role not in ROLES:
        raise HTTPException(status_code=400, detail=f"role must be one of {ROLES}")
    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(status_code=409, detail="That username is already taken.")

    user = User(
        id=uuid.uuid4(),
        full_name=payload.full_name.strip(),
        username=payload.username.strip(),
        hashed_password=hash_password(payload.password),
        role=payload.role,
        facility_id=payload.facility_id,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: uuid.UUID,
    payload: UserAdminUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("system_admin")),
):
    """Admin-only account management: change role/facility, deactivate or
    reactivate. Deliberately does not allow an admin to deactivate their
    own account here — that's a lockout risk with no legitimate reason to
    happen through this endpoint."""
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    update_data = payload.model_dump(exclude_unset=True)
    if "role" in update_data and update_data["role"] not in ROLES:
        raise HTTPException(status_code=400, detail=f"role must be one of {ROLES}")
    if user.id == current_user.id and update_data.get("is_active") is False:
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account.")

    for field, value in update_data.items():
        setattr(user, field, value.strip() if isinstance(value, str) else value)
    db.commit()
    db.refresh(user)
    return user
