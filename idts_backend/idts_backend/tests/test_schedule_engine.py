from datetime import date

import pytest

from app.domain.schedule_engine import (
    DoseStatus,
    PriorDose,
    ScheduleEntry,
    evaluate_dose,
    evaluate_child_schedule,
)

PENTA1 = ScheduleEntry(
    id="penta-1",
    antigen="Pentavalent",
    dose_number=1,
    recommended_age_days=42,   # 6 weeks
    minimum_age_days=42,
    minimum_interval_from_prior_dose_days=None,
    due_soon_window_days=7,
    overdue_window_days=14,
    defaulter_threshold_days=30,
)

PENTA2 = ScheduleEntry(
    id="penta-2",
    antigen="Pentavalent",
    dose_number=2,
    recommended_age_days=70,   # 10 weeks
    minimum_age_days=70,
    minimum_interval_from_prior_dose_days=28,  # 4 weeks min from dose 1
    due_soon_window_days=7,
    overdue_window_days=14,
    defaulter_threshold_days=30,
)

MR1 = ScheduleEntry(
    id="mr-1",
    antigen="Measles-Rubella",
    dose_number=1,
    recommended_age_days=270,  # 9 months
    minimum_age_days=270,
    minimum_interval_from_prior_dose_days=None,
    maximum_catchup_age_days=1825,  # 5 years, illustrative CONFIG
)


def test_not_yet_due_before_minimum_age():
    dob = date(2026, 1, 1)
    today = date(2026, 1, 15)  # 14 days old, min age is 42 days
    result = evaluate_dose(dob=dob, today=today, entry=PENTA1, already_administered=False)
    assert result.status == DoseStatus.NOT_YET_DUE
    assert result.days_overdue < 0


def test_due_soon_window():
    dob = date(2026, 1, 1)
    today = dob.fromordinal(dob.toordinal() + 42 + 3)  # 3 days past eligible date
    result = evaluate_dose(dob=dob, today=today, entry=PENTA1, already_administered=False)
    assert result.status == DoseStatus.DUE_SOON


def test_overdue_before_defaulter_threshold():
    dob = date(2026, 1, 1)
    today = dob.fromordinal(dob.toordinal() + 42 + 20)  # 20 days overdue
    result = evaluate_dose(dob=dob, today=today, entry=PENTA1, already_administered=False)
    assert result.status == DoseStatus.OVERDUE, "20 days overdue should be 'overdue', not yet 'defaulter'"


def test_defaulter_past_threshold():
    dob = date(2026, 1, 1)
    today = dob.fromordinal(dob.toordinal() + 42 + 45)  # 45 days overdue > 30-day threshold
    result = evaluate_dose(dob=dob, today=today, entry=PENTA1, already_administered=False)
    assert result.status == DoseStatus.DEFAULTER
    assert "defaulter" in result.reason.lower()
    assert "45 days" in result.reason


def test_administered_dose_short_circuits_regardless_of_dates():
    dob = date(2020, 1, 1)  # very old child, would otherwise be a defaulter
    today = date(2026, 1, 1)
    result = evaluate_dose(dob=dob, today=today, entry=PENTA1, already_administered=True)
    assert result.status == DoseStatus.ADMINISTERED
    assert result.days_overdue == 0


def test_minimum_interval_from_prior_dose_extends_eligibility():
    """
    A child whose dose 1 was given LATE should not be marked overdue for dose 2
    purely by age — the minimum interval from the actual prior dose date must
    push the eligible date later. This is the exact failure mode the spec
    warns about implicitly in §8/§25 (logical validation, dose 2 cannot
    precede dose 1's clinically valid interval).
    """
    dob = date(2026, 1, 1)
    # Dose 1 given late, at day 60 instead of day 42
    late_dose1 = PriorDose(schedule_entry_id="penta-1", event_date=dob.fromordinal(dob.toordinal() + 60))
    today = dob.fromordinal(dob.toordinal() + 70)  # "recommended" day for dose 2 by age alone

    result = evaluate_dose(
        dob=dob,
        today=today,
        entry=PENTA2,
        already_administered=False,
        prior_dose=late_dose1,
    )
    # Eligible date should be max(age-anchor day70, interval-anchor day60+28=day88) = day 88
    assert result.eligible_date == dob.fromordinal(dob.toordinal() + 88)
    assert result.status == DoseStatus.NOT_YET_DUE, (
        "Without honoring the minimum interval from the actual (late) prior dose, "
        "this child would be incorrectly flagged as overdue on day 70."
    )


def test_maximum_catchup_age_marks_not_applicable_not_silently_defaulted():
    dob = date(2015, 1, 1)  # far beyond MR1's 5-year catch-up window
    today = date(2026, 1, 1)
    result = evaluate_dose(dob=dob, today=today, entry=MR1, already_administered=False)
    assert result.status == DoseStatus.NOT_APPLICABLE, (
        "A dose past its configured catch-up age must route to programme/clinical "
        "review (NOT_APPLICABLE), never be silently counted as an ordinary defaulter."
    )


def test_evaluate_child_schedule_preserves_order_and_handles_mixed_states():
    dob = date(2026, 1, 1)
    today = dob.fromordinal(dob.toordinal() + 100)
    results = evaluate_child_schedule(
        dob=dob,
        today=today,
        schedule_entries=[PENTA1, PENTA2, MR1],
        administered_dose_ids={"penta-1"},
        prior_doses_by_entry={},
    )
    assert [r.schedule_entry.id for r in results] == ["penta-1", "penta-2", "mr-1"]
    assert results[0].status == DoseStatus.ADMINISTERED
    assert results[1].status in (DoseStatus.DUE, DoseStatus.OVERDUE, DoseStatus.DEFAULTER, DoseStatus.DUE_SOON)
    assert results[2].status == DoseStatus.NOT_YET_DUE
