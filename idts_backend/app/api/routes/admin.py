"""
Administration API: security policy, system settings, activity log and a
system overview. Everything here is system_admin only, except the public
branding endpoint the sign-in page reads before anyone is signed in.
"""

import csv
import io
import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.deps import require_role
from app.db.session import get_db
from app.models.child import Child, ScheduleEntry, VaccinationEvent
from app.models.defaulter import AuditLog, DefaulterCase
from app.models.user import Facility, GeographicArea, User
from app.services import audit
from app.services.settings_service import (
    SECURITY_LIMITS,
    get_security_settings,
    get_system_settings,
    set_security_settings,
    set_system_settings,
)

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])
public_router = APIRouter(prefix="/api/v1/settings", tags=["settings"])

admin_only = require_role("system_admin")


# ---------------------------------------------------------------------------
# Security settings
# ---------------------------------------------------------------------------

class SecuritySettings(BaseModel):
    session_timeout_minutes: int
    password_min_length: int
    max_failed_logins: int
    lockout_minutes: int


class SecuritySettingsUpdate(BaseModel):
    session_timeout_minutes: Optional[int] = None
    password_min_length: Optional[int] = None
    max_failed_logins: Optional[int] = None
    lockout_minutes: Optional[int] = None


@router.get("/settings/security", response_model=SecuritySettings)
def read_security_settings(db: Session = Depends(get_db), _: User = Depends(admin_only)):
    return get_security_settings(db)


@router.put("/settings/security", response_model=SecuritySettings)
def update_security_settings(
    payload: SecuritySettingsUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(admin_only),
):
    values = payload.model_dump(exclude_none=True)
    for key, value in values.items():
        low, high = SECURITY_LIMITS[key]
        if not low <= value <= high:
            raise HTTPException(status_code=400, detail=f"{key.replace('_', ' ').capitalize()} must be between {low} and {high}.")
    before = get_security_settings(db)
    set_security_settings(db, values, current_user)
    changed = {k: v for k, v in values.items() if before.get(k) != v}
    if changed:
        audit.record(
            db, current_user, "update", "security_settings", None,
            "Changed " + ", ".join(k.replace("_", " ") for k in changed),
            before={k: before[k] for k in changed}, after=changed, request=request,
        )
    db.commit()
    return get_security_settings(db)


# ---------------------------------------------------------------------------
# System settings
# ---------------------------------------------------------------------------

class SystemSettings(BaseModel):
    programme_name: str
    organisation_name: str


class SystemSettingsUpdate(BaseModel):
    programme_name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    organisation_name: Optional[str] = Field(default=None, min_length=1, max_length=120)


@router.get("/settings/system", response_model=SystemSettings)
def read_system_settings(db: Session = Depends(get_db), _: User = Depends(admin_only)):
    return get_system_settings(db)


@router.put("/settings/system", response_model=SystemSettings)
def update_system_settings(
    payload: SystemSettingsUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(admin_only),
):
    values = {k: v.strip() for k, v in payload.model_dump(exclude_none=True).items()}
    before = get_system_settings(db)
    set_system_settings(db, values, current_user)
    changed = {k: v for k, v in values.items() if before.get(k) != v}
    if changed:
        audit.record(
            db, current_user, "update", "system_settings", None,
            "Changed " + ", ".join(k.replace("_", " ") for k in changed),
            before={k: before[k] for k in changed}, after=changed, request=request,
        )
    db.commit()
    return get_system_settings(db)


# ---------------------------------------------------------------------------
# Dose status thresholds (per schedule entry)
# ---------------------------------------------------------------------------

THRESHOLD_FIELDS = ("due_soon_window_days", "overdue_window_days", "defaulter_threshold_days")


class ScheduleThreshold(BaseModel):
    id: uuid.UUID
    antigen: str
    dose_number: int
    recommended_age_days: int
    due_soon_window_days: int
    overdue_window_days: int
    defaulter_threshold_days: int


class ScheduleThresholdUpdate(BaseModel):
    id: uuid.UUID
    due_soon_window_days: int = Field(ge=0, le=120)
    overdue_window_days: int = Field(ge=0, le=365)
    defaulter_threshold_days: int = Field(ge=1, le=730)


def _active_entries(db: Session):
    return (
        db.query(ScheduleEntry)
        .order_by(ScheduleEntry.recommended_age_days, ScheduleEntry.antigen, ScheduleEntry.dose_number)
        .all()
    )


@router.get("/schedule-thresholds", response_model=list[ScheduleThreshold])
def read_schedule_thresholds(db: Session = Depends(get_db), _: User = Depends(admin_only)):
    return _active_entries(db)


@router.put("/schedule-thresholds", response_model=list[ScheduleThreshold])
def update_schedule_thresholds(
    payload: list[ScheduleThresholdUpdate],
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(admin_only),
):
    """Thresholds differ by dose (birth doses are chased sooner than later
    ones), so each schedule entry is edited on its own row."""
    entries = {e.id: e for e in db.query(ScheduleEntry).filter(ScheduleEntry.id.in_([u.id for u in payload])).all()}
    changes = []
    for u in payload:
        entry = entries.get(u.id)
        if entry is None:
            raise HTTPException(status_code=404, detail="Schedule entry not found.")
        label = f"{entry.antigen} dose {entry.dose_number}"
        # The status engine checks due soon, then overdue, then defaulter: a
        # defaulter threshold inside the first two windows would never be
        # reached, so reject it rather than silently misclassify.
        if u.defaulter_threshold_days <= u.due_soon_window_days + u.overdue_window_days:
            raise HTTPException(
                status_code=400,
                detail=f"{label}: the defaulter threshold must be longer than the due-soon and overdue windows added together.",
            )
        before = {f: getattr(entry, f) for f in THRESHOLD_FIELDS}
        after = {f: getattr(u, f) for f in THRESHOLD_FIELDS}
        if before != after:
            for f, v in after.items():
                setattr(entry, f, v)
            changes.append((entry, label, before, after))
    for entry, label, before, after in changes:
        audit.record(
            db, current_user, "update", "system_settings", entry.id,
            f"Changed status thresholds for {label}", before=before, after=after, request=request,
        )
    db.commit()
    return _active_entries(db)


class PublicSettings(BaseModel):
    programme_name: str
    organisation_name: str


@public_router.get("/public", response_model=PublicSettings)
def read_public_settings(db: Session = Depends(get_db)):
    s = get_system_settings(db)
    return {"programme_name": s["programme_name"], "organisation_name": s["organisation_name"]}


# ---------------------------------------------------------------------------
# System overview
# ---------------------------------------------------------------------------

class SystemInfo(BaseModel):
    api_version: str
    database: str
    users_active: int
    users_inactive: int
    users_locked: int
    facilities: int
    districts: int
    children: int
    vaccinations: int
    open_defaulter_cases: int
    schedule_entries: int
    audit_events_last_7_days: int


@router.get("/system-info", response_model=SystemInfo)
def system_info(db: Session = Depends(get_db), _: User = Depends(admin_only)):
    now = datetime.now(timezone.utc)
    return SystemInfo(
        api_version=_api_version(),
        database=db.get_bind().dialect.name,
        users_active=db.query(User).filter(User.is_active.is_(True)).count(),
        users_inactive=db.query(User).filter(User.is_active.is_(False)).count(),
        users_locked=db.query(User).filter(User.locked_until.isnot(None), User.locked_until > now).count(),
        facilities=db.query(Facility).count(),
        districts=db.query(GeographicArea).filter(GeographicArea.level == "district").count(),
        children=db.query(Child).filter(Child.status == "active", Child.deleted_at.is_(None)).count(),
        vaccinations=db.query(VaccinationEvent).count(),
        open_defaulter_cases=db.query(DefaulterCase).filter(DefaulterCase.status != "closed").count(),
        schedule_entries=db.query(ScheduleEntry).count(),
        audit_events_last_7_days=db.query(AuditLog).filter(AuditLog.timestamp >= now - timedelta(days=7)).count(),
    )


def _api_version() -> str:
    from app.main import app  # late import: app.main imports this module
    return app.version


# ---------------------------------------------------------------------------
# Activity log
# ---------------------------------------------------------------------------

class AuditLogOut(BaseModel):
    id: uuid.UUID
    timestamp: datetime
    actor_username: Optional[str] = None
    actor_name: Optional[str] = None
    action: str
    entity: str
    entity_id: Optional[str] = None
    summary: Optional[str] = None
    ip_address: Optional[str] = None
    before: Optional[dict] = None
    after: Optional[dict] = None


class AuditLogPage(BaseModel):
    total: int
    items: list[AuditLogOut]


def _filtered_logs(db: Session, q, action, entity, start_date, end_date):
    query = db.query(AuditLog, User).outerjoin(User, AuditLog.user_id == User.id)
    if action:
        query = query.filter(AuditLog.action == action)
    if entity:
        query = query.filter(AuditLog.entity == entity)
    if start_date:
        query = query.filter(AuditLog.timestamp >= datetime.combine(start_date, time.min, tzinfo=timezone.utc))
    if end_date:
        query = query.filter(AuditLog.timestamp < datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=timezone.utc))
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(
            AuditLog.actor_username.ilike(like), AuditLog.actor_name.ilike(like),
            AuditLog.summary.ilike(like), User.full_name.ilike(like), User.username.ilike(like),
        ))
    return query


def _row_out(log: AuditLog, user: Optional[User]) -> AuditLogOut:
    return AuditLogOut(
        id=log.id, timestamp=log.timestamp,
        actor_username=log.actor_username or (user.username if user else None),
        actor_name=log.actor_name or (user.full_name if user else None),
        action=log.action, entity=log.entity, entity_id=log.entity_id,
        summary=log.summary, ip_address=log.ip_address, before=log.before, after=log.after,
    )


@router.get("/audit-logs", response_model=AuditLogPage)
def list_audit_logs(
    q: Optional[str] = None,
    action: Optional[str] = None,
    entity: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(admin_only),
):
    query = _filtered_logs(db, q, action, entity, start_date, end_date)
    total = query.with_entities(func.count(AuditLog.id)).scalar()
    rows = query.order_by(AuditLog.timestamp.desc()).offset(offset).limit(limit).all()
    return AuditLogPage(total=total, items=[_row_out(log, user) for log, user in rows])


@router.get("/audit-logs/export")
def export_audit_logs(
    q: Optional[str] = None,
    action: Optional[str] = None,
    entity: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(admin_only),
):
    rows = _filtered_logs(db, q, action, entity, start_date, end_date).order_by(AuditLog.timestamp.desc()).limit(50000).all()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["timestamp_utc", "username", "name", "action", "area", "record_id", "summary", "ip_address"])
    for log, user in rows:
        r = _row_out(log, user)
        writer.writerow([r.timestamp.isoformat(), r.actor_username or "", r.actor_name or "", r.action, r.entity, r.entity_id or "", r.summary or "", r.ip_address or ""])
    # Exporting the log is itself a sensitive action worth recording.
    audit.record(db, current_user, "export", "audit_log", None, f"Exported {len(rows)} activity log entries", request=request)
    db.commit()
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="idts-activity-log-{date.today().isoformat()}.csv"'},
    )
