"""
Importing every model module here ensures SQLAlchemy's declarative mapper
can resolve string-based relationship() references (e.g. "Child",
"Facility") regardless of which module gets imported first elsewhere in
the app. Always import app.models (this package) before calling
Base.metadata.create_all() or running Alembic autogenerate.
"""

from app.models.user import GeographicArea, Facility, User  # noqa: F401
from app.models.child import Child, ImmunizationSchedule, ScheduleEntry, VaccinationEvent  # noqa: F401
from app.models.defaulter import DefaulterCase, TracingAttempt, AuditLog  # noqa: F401
