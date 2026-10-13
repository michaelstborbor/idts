"""
Activity log writer (design doc §33).

Every call adds one row to audit_logs in the caller's transaction; the
caller commits. Rows snapshot the actor's username and name so the log
stays readable after renames.

Sign-in events (entity "auth") never set user_id: a user who has only
signed in has no clinical records, and a user_id FK on those rows would
otherwise block an admin from permanently removing an unused account.
The username snapshot still says who it was.
"""

import uuid
from typing import Any, Optional

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.models.defaulter import AuditLog
from app.models.user import User


def client_ip(request: Optional[Request]) -> Optional[str]:
    if request is None:
        return None
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    return request.client.host[:64] if request.client else None


def record(
    db: Session,
    actor: Optional[User],
    action: str,
    entity: str,
    entity_id: Optional[Any] = None,
    summary: Optional[str] = None,
    before: Optional[dict] = None,
    after: Optional[dict] = None,
    request: Optional[Request] = None,
    actor_username: Optional[str] = None,
) -> None:
    db.add(AuditLog(
        id=uuid.uuid4(),
        user_id=actor.id if actor is not None and entity != "auth" else None,
        actor_username=actor.username if actor is not None else actor_username,
        actor_name=actor.full_name if actor is not None else None,
        action=action,
        entity=entity,
        entity_id=str(entity_id) if entity_id is not None else None,
        summary=summary[:300] if summary else None,
        before=jsonable_encoder(before) if before else None,
        after=jsonable_encoder(after) if after else None,
        ip_address=client_ip(request),
        timestamp=utcnow(),
    ))
