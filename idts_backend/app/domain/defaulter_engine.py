"""
Defaulter prioritization engine — pure Python, DB/UI-independent.

Deliberately a transparent weighted-sum formula, NOT a trained model.
Master-prompt §12 explicitly instructs: "Avoid opaque machine-learning-based
risk scores unless there is sufficient validated local data." No such
validated dataset exists at design time, so this stays rules-based and
auditable: every score returned carries its contributing-factor breakdown.

This module consumes DoseEvaluation objects produced by schedule_engine.py
plus a small amount of case-history context; it does not query the DB itself.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

from app.domain.schedule_engine import DoseEvaluation, DoseStatus


class Priority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


@dataclass(frozen=True)
class RiskWeights:
    """All weights and normalization bounds are [CONFIG] — see design doc §8.2."""
    w_days_overdue: float = 0.35
    w_missed_dose_count: float = 0.25
    w_previous_default_history: float = 0.15
    w_unsuccessful_tracing_attempts: float = 0.15
    w_high_risk_area: float = 0.10

    # normalization caps — values at/above these count as "1.0" on that factor
    days_overdue_cap: int = 90
    missed_dose_count_cap: int = 5
    unsuccessful_attempts_cap: int = 3

    high_priority_threshold: float = 0.65   # [CONFIG]
    medium_priority_threshold: float = 0.35  # [CONFIG]


@dataclass(frozen=True)
class RiskFactorBreakdown:
    days_overdue_component: float
    missed_dose_count_component: float
    previous_default_history_component: float
    unsuccessful_tracing_attempts_component: float
    high_risk_area_component: float

    def as_dict(self) -> dict:
        return {
            "days_overdue": round(self.days_overdue_component, 4),
            "missed_dose_count": round(self.missed_dose_count_component, 4),
            "previous_default_history": round(self.previous_default_history_component, 4),
            "unsuccessful_tracing_attempts": round(self.unsuccessful_tracing_attempts_component, 4),
            "high_risk_area": round(self.high_risk_area_component, 4),
        }


@dataclass(frozen=True)
class DefaulterCaseInput:
    """Everything the risk engine needs about one child's current case."""
    days_overdue_on_triggering_dose: int
    missed_dose_count: int
    has_previous_default_history: bool
    unsuccessful_tracing_attempt_count: int
    is_high_risk_area: bool


@dataclass(frozen=True)
class RiskAssessment:
    score: float
    priority: Priority
    breakdown: RiskFactorBreakdown
    explanation: str


def _normalize(value: float, cap: float) -> float:
    if cap <= 0:
        return 0.0
    return max(0.0, min(1.0, value / cap))


def score_defaulter_case(case: DefaulterCaseInput, weights: RiskWeights = RiskWeights()) -> RiskAssessment:
    days_component = _normalize(case.days_overdue_on_triggering_dose, weights.days_overdue_cap) * weights.w_days_overdue
    missed_component = _normalize(case.missed_dose_count, weights.missed_dose_count_cap) * weights.w_missed_dose_count
    history_component = (1.0 if case.has_previous_default_history else 0.0) * weights.w_previous_default_history
    attempts_component = (
        _normalize(case.unsuccessful_tracing_attempt_count, weights.unsuccessful_attempts_cap)
        * weights.w_unsuccessful_tracing_attempts
    )
    area_component = (1.0 if case.is_high_risk_area else 0.0) * weights.w_high_risk_area

    breakdown = RiskFactorBreakdown(
        days_overdue_component=days_component,
        missed_dose_count_component=missed_component,
        previous_default_history_component=history_component,
        unsuccessful_tracing_attempts_component=attempts_component,
        high_risk_area_component=area_component,
    )

    total = days_component + missed_component + history_component + attempts_component + area_component

    if total >= weights.high_priority_threshold:
        priority = Priority.HIGH
    elif total >= weights.medium_priority_threshold:
        priority = Priority.MEDIUM
    else:
        priority = Priority.LOW

    explanation = (
        f"Score {total:.2f} → {priority.value} priority. "
        f"Largest contributing factor(s): "
        + ", ".join(
            f"{k}={v:.2f}"
            for k, v in sorted(breakdown.as_dict().items(), key=lambda kv: -kv[1])[:2]
        )
    )

    return RiskAssessment(score=round(total, 4), priority=priority, breakdown=breakdown, explanation=explanation)


def build_defaulter_case_reason(evaluation: DoseEvaluation) -> str:
    """
    Human-readable reason string stored on the DefaulterCase record
    (design doc §6, e.g. "Pentavalent dose 3 overdue by 21 days" per §11).
    """
    if evaluation.status != DoseStatus.DEFAULTER:
        raise ValueError(
            f"build_defaulter_case_reason called on a non-defaulter evaluation "
            f"(status={evaluation.status}); this should never happen — check caller logic."
        )
    return (
        f"{evaluation.schedule_entry.antigen} dose {evaluation.schedule_entry.dose_number} "
        f"overdue by {evaluation.days_overdue} days "
        f"(defaulter threshold: {evaluation.schedule_entry.defaulter_threshold_days} days)."
    )
