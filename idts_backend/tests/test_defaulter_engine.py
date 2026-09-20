from datetime import date

import pytest

from app.domain.defaulter_engine import (
    DefaulterCaseInput,
    Priority,
    RiskWeights,
    build_defaulter_case_reason,
    score_defaulter_case,
)
from app.domain.schedule_engine import DoseEvaluation, DoseStatus, ScheduleEntry


PENTA3 = ScheduleEntry(
    id="penta-3",
    antigen="Pentavalent",
    dose_number=3,
    recommended_age_days=98,
    minimum_age_days=98,
    minimum_interval_from_prior_dose_days=28,
    defaulter_threshold_days=30,
)


def test_low_risk_case_scores_low_priority():
    case = DefaulterCaseInput(
        days_overdue_on_triggering_dose=32,   # just past 30-day threshold
        missed_dose_count=1,
        has_previous_default_history=False,
        unsuccessful_tracing_attempt_count=0,
        is_high_risk_area=False,
    )
    result = score_defaulter_case(case)
    assert result.priority == Priority.LOW
    assert 0.0 <= result.score < RiskWeights().medium_priority_threshold


def test_high_risk_case_scores_high_priority():
    case = DefaulterCaseInput(
        days_overdue_on_triggering_dose=90,
        missed_dose_count=5,
        has_previous_default_history=True,
        unsuccessful_tracing_attempt_count=3,
        is_high_risk_area=True,
    )
    result = score_defaulter_case(case)
    assert result.priority == Priority.HIGH
    assert result.score == pytest.approx(1.0, abs=0.01)


def test_score_breakdown_sums_to_total_and_is_fully_attributable():
    """
    Auditability requirement (design doc §8.2): a supervisor must be able to see
    *why* a case scored the way it did. The breakdown components must sum to
    the reported total — no hidden terms.
    """
    case = DefaulterCaseInput(
        days_overdue_on_triggering_dose=45,
        missed_dose_count=2,
        has_previous_default_history=True,
        unsuccessful_tracing_attempt_count=1,
        is_high_risk_area=False,
    )
    result = score_defaulter_case(case)
    component_sum = sum(result.breakdown.as_dict().values())
    assert component_sum == pytest.approx(result.score, abs=0.001)


def test_weights_are_fully_configurable_not_hardcoded():
    """Passing a different RiskWeights instance must change the outcome — proves
    nothing is hard-coded inside score_defaulter_case itself."""
    case = DefaulterCaseInput(
        days_overdue_on_triggering_dose=10,
        missed_dose_count=1,
        has_previous_default_history=False,
        unsuccessful_tracing_attempt_count=0,
        is_high_risk_area=False,
    )
    lenient = score_defaulter_case(case, RiskWeights(high_priority_threshold=0.99, medium_priority_threshold=0.98))
    strict = score_defaulter_case(case, RiskWeights(high_priority_threshold=0.01, medium_priority_threshold=0.001))
    assert lenient.priority == Priority.LOW
    assert strict.priority == Priority.HIGH


def test_build_defaulter_case_reason_matches_spec_example_format():
    entry = PENTA3
    evaluation = DoseEvaluation(
        schedule_entry=entry,
        status=DoseStatus.DEFAULTER,
        days_overdue=21,
        reason="irrelevant for this test",
        eligible_date=date(2026, 1, 1),
    )
    reason = build_defaulter_case_reason(evaluation)
    # Master prompt §11 gives the canonical example: "Pentavalent dose 3 overdue by 21 days."
    assert reason.startswith("Pentavalent dose 3 overdue by 21 days")


def test_build_defaulter_case_reason_rejects_non_defaulter_evaluation():
    entry = PENTA3
    evaluation = DoseEvaluation(
        schedule_entry=entry,
        status=DoseStatus.OVERDUE,
        days_overdue=5,
        reason="irrelevant",
        eligible_date=date(2026, 1, 1),
    )
    with pytest.raises(ValueError):
        build_defaulter_case_reason(evaluation)
