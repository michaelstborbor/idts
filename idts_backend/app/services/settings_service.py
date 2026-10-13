"""
System settings with defaults.

Security settings are enforced server-side (sign-in lockout, session
length, password length); the frontend only displays and edits them.
"""

from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models.settings import SystemSetting
from app.models.user import User

SECURITY_DEFAULTS: dict[str, Any] = {
    "session_timeout_minutes": 60,
    "password_min_length": 8,
    "max_failed_logins": 5,          # 0 turns lockout off
    "lockout_minutes": 15,
}

SECURITY_LIMITS: dict[str, tuple[int, int]] = {
    "session_timeout_minutes": (5, 1440),
    "password_min_length": (8, 64),
    "max_failed_logins": (0, 20),
    "lockout_minutes": (1, 1440),
}

SYSTEM_DEFAULTS: dict[str, Any] = {
    "programme_name": "Expanded Programme on Immunization",
    "organisation_name": "Ministry of Health, Sierra Leone",
}


def _get(db: Session, key: str, default: Any) -> Any:
    row = db.get(SystemSetting, key)
    return default if row is None or row.value is None else row.value


def _set(db: Session, key: str, value: Any, user: Optional[User]) -> None:
    row = db.get(SystemSetting, key)
    if row is None:
        row = SystemSetting(key=key)
        db.add(row)
    row.value = value
    row.updated_by_id = user.id if user else None


def get_security_settings(db: Session) -> dict[str, int]:
    return {k: int(_get(db, k, v)) for k, v in SECURITY_DEFAULTS.items()}


def set_security_settings(db: Session, values: dict[str, int], user: User) -> None:
    for k, v in values.items():
        _set(db, k, int(v), user)


def get_system_settings(db: Session) -> dict[str, Any]:
    return {k: _get(db, k, v) for k, v in SYSTEM_DEFAULTS.items()}


def set_system_settings(db: Session, values: dict[str, Any], user: User) -> None:
    for k in SYSTEM_DEFAULTS:
        if k in values:
            _set(db, k, values[k], user)


def password_min_length(db: Session) -> int:
    return get_security_settings(db)["password_min_length"]
