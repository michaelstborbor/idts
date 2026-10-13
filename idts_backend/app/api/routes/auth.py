from datetime import timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.core.security import create_access_token, verify_password
from app.db.base import utcnow
from app.db.session import get_db
from app.models.user import User
from app.schemas.child import Token  # re-exported below for clarity
from app.services import audit
from app.services.settings_service import get_security_settings

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _aware(dt):
    # SQLite hands back naive datetimes even for timezone=True columns.
    return dt.replace(tzinfo=timezone.utc) if dt is not None and dt.tzinfo is None else dt


@router.post("/login", response_model=Token)
def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    policy = get_security_settings(db)
    user = db.query(User).filter(User.username == form_data.username).first()
    now = utcnow()

    if user is not None and user.locked_until is not None and _aware(user.locked_until) > now:
        audit.record(db, user, "login_blocked", "auth", user.id, "Sign-in refused: account locked", request=request)
        db.commit()
        minutes = max(1, int((_aware(user.locked_until) - now).total_seconds() // 60) + 1)
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail=f"Too many failed sign-in attempts. Try again in {minutes} minute{'s' if minutes != 1 else ''}, or ask an administrator to unlock the account.",
        )

    if user is None or not verify_password(form_data.password, user.hashed_password):
        summary = "Failed sign-in: wrong password" if user else "Failed sign-in: unknown username"
        if user is not None:
            user.failed_login_count = (user.failed_login_count or 0) + 1
            if policy["max_failed_logins"] and user.failed_login_count >= policy["max_failed_logins"]:
                user.locked_until = now + timedelta(minutes=policy["lockout_minutes"])
                user.failed_login_count = 0
                summary = f"Account locked for {policy['lockout_minutes']} min after repeated failed sign-ins"
        audit.record(
            db, user, "login_failed", "auth", user.id if user else None, summary,
            request=request, actor_username=form_data.username[:100],
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect username or password")
    if not user.is_active:
        audit.record(db, user, "login_blocked", "auth", user.id, "Sign-in refused: account inactive", request=request)
        db.commit()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is inactive")

    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = now
    audit.record(db, user, "login", "auth", user.id, "Signed in", request=request)
    db.commit()
    token = create_access_token(subject=user.username, role=user.role, expires_minutes=policy["session_timeout_minutes"])
    return Token(access_token=token)
