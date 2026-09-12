"""
Bridges SQLAlchemy models to the pure-domain engines in app/domain/.

This module deliberately does the *minimum* translation work: convert DB
rows into the dataclasses schedule_engine.py and defaulter_engine.py
already expect, call the (already-tested) pure functions, and convert the
results back. No business logic lives here — if you find yourself adding
an if/else about due dates in this file, it belongs in app/domain/ instead,
where it can be unit-tested in isolation.
"""

from datetime import date
from typing import Optional

from sqlalchemy.orm import Session

from app.domain.defaulter_engine import (
    DefaulterCaseInput,
    RiskAssessment,
    RiskWeights,
    score_defaulter_case,
)
from app.domain.schedule_engine import (
    DoseEvaluation,
    PriorDose,
    ScheduleEntry as DomainScheduleEntry,
    evaluate_child_schedule,
)
from app.models.child import Child, ImmunizationSchedule, ScheduleEntry, VaccinationEvent
from app.models.defaulter import DefaulterCase


def _to_domain_entry(row: ScheduleEntry) -> DomainScheduleEntry:
    return DomainScheduleEntry(
        id=str(row.id),
        antigen=row.antigen,
        dose_number=row.dose_number,
        recommended_age_days=row.recommended_age_days,
        minimum_age_days=row.minimum_age_days,
        minimum_interval_from_prior_dose_days=row.minimum_interval_from_prior_dose_days,
        due_soon_window_days=row.due_soon_window_days,
        overdue_window_days=row.overdue_window_days,
        defaulter_threshold_days=row.defaulter_threshold_days,
        maximum_catchup_age_days=row.maximum_catchup_age_days,
    )


def get_active_schedule_entries(db: Session) -> list[ScheduleEntry]:
    """
    Returns entries from the currently active schedule, ordered for display.
    Full schedule *versioning* (multiple historical versions per §7) is
    modeled in the ERD but the "pick the version active on a given date"
    logic is intentionally deferred — flagged here rather than silently
    assumed, since it's a real gap versus the full design doc.
    """
    schedule = db.query(ImmunizationSchedule).filter(ImmunizationSchedule.is_active.is_(True)).first()
    if schedule is None:
        return []
    return sorted(schedule.entries, key=lambda e: e.display_order)


def evaluate_child(db: Session, child: Child, today: Optional[date] = None) -> list[DoseEvaluation]:
    today = today or date.today()
    entries = get_active_schedule_entries(db)
    domain_entries = [_to_domain_entry(e) for e in entries]

    administered_map: dict[str, VaccinationEvent] = {}
    for v in child.vaccinations:
        administered_map[str(v.schedule_entry_id)] = v

    administered_ids = set(administered_map.keys())

    prior_doses: dict[str, PriorDose] = {}
    for entry in entries:
        if entry.prior_entry_id is not None:
            prior_event = administered_map.get(str(entry.prior_entry_id))
            if prior_event is not None:
                prior_doses[str(entry.id)] = PriorDose(
                    schedule_entry_id=str(entry.prior_entry_id),
                    event_date=prior_event.event_date,
                )

    return evaluate_child_schedule(
        dob=child.dob,
        today=today,
        schedule_entries=domain_entries,
        administered_dose_ids=administered_ids,
        prior_doses_by_entry=prior_doses,
    )


def missed_dose_count(evaluations: list[DoseEvaluation]) -> int:
    return sum(1 for e in evaluations if e.status.value == "defaulter")


def score_case_for_child(
    db: Session,
    child: Child,
    triggering_evaluation: DoseEvaluation,
    weights: RiskWeights = RiskWeights(),
) -> RiskAssessment:
    """
    Builds the DefaulterCaseInput for a specific overdue dose and scores it.
    `has_previous_default_history` looks at this child's past *closed* cases
    — a child who has defaulted before is treated as higher-risk going
    forward, per design doc §12's listed risk factors.
    """
    all_evaluations = evaluate_child(db, child)
    missed = missed_dose_count(all_evaluations)

    past_defaults = (
        db.query(DefaulterCase)
        .filter(DefaulterCase.child_id == child.id, DefaulterCase.status == "closed")
        .count()
    )

    open_case_count = (
        db.query(DefaulterCase)
        .filter(DefaulterCase.child_id == child.id, DefaulterCase.status != "closed")
        .count()
    )

    case_input = DefaulterCaseInput(
        days_overdue_on_triggering_dose=max(triggering_evaluation.days_overdue, 0),
        missed_dose_count=missed,
        has_previous_default_history=past_defaults > 0,
        unsuccessful_tracing_attempt_count=0,  # populated by caller once a case/attempts exist
        is_high_risk_area=False,  # [CONFIG] — no geographic risk classification configured yet
    )
    return score_defaulter_case(case_input, weights)
