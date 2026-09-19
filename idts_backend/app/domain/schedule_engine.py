"""
Schedule engine — pure Python, no DB/HTTP dependencies (per design §3.2 / §42).

Responsible ONLY for:
  - determining which schedule entries apply to a child
  - computing each entry's status: not_yet_due | due_soon | due | overdue | defaulter
  - explaining *why* (so a supervisor/auditor can always see the reasoning)

Deliberately does NOT decide risk priority (see defaulter_engine.py) and does NOT
touch the database — it is unit-testable in isolation, which matters because
this is the module most likely to encode a wrong clinical assumption if it is
tangled up with ORM/session code.

All numeric thresholds are passed in via ScheduleEntry / DefaulterConfig —
nothing here is hard-coded, per master-prompt §3.5 and §58.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from enum import Enum
from typing import Optional


class DoseStatus(str, Enum):
    NOT_YET_DUE = "not_yet_due"
    DUE_SOON = "due_soon"
    DUE = "due"
    OVERDUE = "overdue"
    DEFAULTER = "defaulter"
    ADMINISTERED = "administered"
    NOT_APPLICABLE = "not_applicable"  # e.g. past max catch-up age; needs clinical review


@dataclass(frozen=True)
class ScheduleEntry:
    """One dose row of a versioned immunization schedule. All values [CONFIG]."""
    id: str
    antigen: str
    dose_number: int
    recommended_age_days: int
    minimum_age_days: int
    minimum_interval_from_prior_dose_days: Optional[int]
    due_soon_window_days: int = 7          # [CONFIG] default; override per antigen if needed
    overdue_window_days: int = 14          # [CONFIG] window between "overdue" and "defaulter"
    defaulter_threshold_days: int = 30     # [CONFIG] days overdue before classified defaulter
    maximum_catchup_age_days: Optional[int] = None  # [CONFIG]
    # Clinical administration details — display-only, never read by any
    # function in this module. Carried through so the API/UI can show them
    # without a second lookup.
    dosage: Optional[str] = None
    route: Optional[str] = None
    site: Optional[str] = None


@dataclass(frozen=True)
class PriorDose:
    schedule_entry_id: str
    event_date: date


@dataclass(frozen=True)
class DoseEvaluation:
    schedule_entry: ScheduleEntry
    status: DoseStatus
    days_overdue: int  # negative = not yet due
    reason: str
    eligible_date: Optional[date]  # date the child becomes eligible for this dose


def _eligible_date(dob: date, entry: ScheduleEntry, prior_dose: Optional[PriorDose]) -> date:
    """
    The earliest date a dose is clinically valid: max(DOB + minimum_age,
    prior_dose_date + minimum_interval). This is the anchor for all
    downstream due/overdue math — getting this wrong is the single most
    common source of false-positive defaulter flags in EPI trackers.
    """
    age_anchor = dob + timedelta(days=entry.minimum_age_days)
    if prior_dose and entry.minimum_interval_from_prior_dose_days is not None:
        interval_anchor = prior_dose.event_date + timedelta(
            days=entry.minimum_interval_from_prior_dose_days
        )
        return max(age_anchor, interval_anchor)
    return age_anchor


def evaluate_dose(
    *,
    dob: date,
    today: date,
    entry: ScheduleEntry,
    already_administered: bool,
    prior_dose: Optional[PriorDose] = None,
) -> DoseEvaluation:
    """
    Evaluate a single scheduled dose for a single child.

    Intentionally side-effect free so it can be called both by the nightly
    batch job and by an on-demand "recalculate this child now" API call
    right after a vaccination is recorded (design doc §5, Scenario B).
    """
    if already_administered:
        return DoseEvaluation(
            schedule_entry=entry,
            status=DoseStatus.ADMINISTERED,
            days_overdue=0,
            reason=f"{entry.antigen} dose {entry.dose_number} already administered.",
            eligible_date=None,
        )

    eligible = _eligible_date(dob, entry, prior_dose)

    if entry.maximum_catchup_age_days is not None:
        max_catchup_date = dob + timedelta(days=entry.maximum_catchup_age_days)
        if today > max_catchup_date:
            return DoseEvaluation(
                schedule_entry=entry,
                status=DoseStatus.NOT_APPLICABLE,
                days_overdue=0,
                reason=(
                    f"{entry.antigen} dose {entry.dose_number} is past the configured "
                    f"maximum catch-up age ({entry.maximum_catchup_age_days} days); "
                    "requires programme/clinical review, not an automatic default."
                ),
                eligible_date=eligible,
            )

    days_overdue = (today - eligible).days

    if days_overdue < 0:
        return DoseEvaluation(
            schedule_entry=entry,
            status=DoseStatus.NOT_YET_DUE,
            days_overdue=days_overdue,
            reason=f"{entry.antigen} dose {entry.dose_number} becomes due on {eligible.isoformat()}.",
            eligible_date=eligible,
        )
    if days_overdue <= entry.due_soon_window_days:
        status, label = DoseStatus.DUE_SOON, "due soon"
    elif days_overdue <= entry.due_soon_window_days + entry.overdue_window_days:
        status, label = DoseStatus.OVERDUE, "overdue"
    elif days_overdue > entry.defaulter_threshold_days:
        status, label = DoseStatus.DEFAULTER, "classified as defaulter"
    else:
        status, label = DoseStatus.DUE, "due"

    reason = f"{entry.antigen} dose {entry.dose_number} {label} by {max(days_overdue, 0)} days."
    return DoseEvaluation(
        schedule_entry=entry,
        status=status,
        days_overdue=days_overdue,
        reason=reason,
        eligible_date=eligible,
    )


def evaluate_child_schedule(
    *,
    dob: date,
    today: date,
    schedule_entries: list[ScheduleEntry],
    administered_dose_ids: set[str],
    prior_doses_by_entry: dict[str, PriorDose],
) -> list[DoseEvaluation]:
    """Evaluate every applicable schedule entry for one child. Order preserved as given."""
    results: list[DoseEvaluation] = []
    for entry in schedule_entries:
        results.append(
            evaluate_dose(
                dob=dob,
                today=today,
                entry=entry,
                already_administered=entry.id in administered_dose_ids,
                prior_dose=prior_doses_by_entry.get(entry.id),
            )
        )
    return results
