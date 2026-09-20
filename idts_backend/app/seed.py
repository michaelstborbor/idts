"""
Seed script.

Geography and facilities are REAL data: Sierra Leone's actual administrative
hierarchy down to chiefdom level, and 108 actual health facilities across
14 chiefdoms in Kono District, sourced from a Ministry of Health HMIS/CHIS
training roster the user provided directly (FACILITY_LIST_BY_CHIEFDOM.xlsx).

The immunization schedule's ANTIGENS, AGES, DOSAGE, ROUTE, and SITE OF
ADMINISTRATION are now sourced from the official Ministry of Health &
Sanitation vaccination schedule chart the user provided directly (photo,
September 2026) — this is real, Ministry-sourced clinical data, not a
placeholder.

Two things are NOT from that source and remain [CONFIG] pending separate
confirmation:
  1. minimum_interval_from_prior_dose_days — the Ministry chart gives a
     recommended AGE per dose, not a separate "minimum interval" column.
     Intervals below are DERIVED by subtracting consecutive recommended
     ages for the same antigen (e.g. Penta2 at 10 weeks minus Penta1 at
     6 weeks = 4 weeks) — an arithmetic implication of the chart, not an
     independently Ministry-stated rule. Flagged so this distinction is
     never lost.
  2. due_soon_window_days / overdue_window_days / defaulter_threshold_days
     — these are programmatic policy decisions (how many days late before
     the system nags, then escalates), not clinical facts. The Ministry
     chart doesn't address them at all. Values here are the same
     placeholders used throughout this project's development and remain
     open items for the DHMT/EPI programme — see
     IDTS_Schedule_Verification_Request.docx.

No CHW users are seeded, deliberately: there is no existing CHW roster
for Kono District yet. The facility_focal_person role can add CHWs
on-the-fly through the "Add new CHW" input in the frontend's assign-case
flow (POST /api/v1/users/chw), rather than this script inventing names.

Run with: PYTHONPATH=. python3 -m app.seed
"""

import json
import uuid
from pathlib import Path

from app.core.security import hash_password
from app.db.base import Base
from app.db.session import SessionLocal, engine
import app.models  # noqa: F401 — registers all models before create_all
from app.models.child import ImmunizationSchedule, ScheduleEntry
from app.models.user import Facility, GeographicArea, User

FACILITIES_DATA_PATH = Path(__file__).parent / "data" / "kono_facilities.json"


def seed(db=None):
    """
    If `db` is not provided, creates tables against the default engine and
    uses the default SessionLocal — this is the normal path for
    `python -m app.seed` and the app's startup lifespan. Tests pass in a
    session bound to their own isolated test engine instead, so seeding
    never touches the real default database file as a side effect of
    running the test suite.
    """
    owns_session = db is None
    if owns_session:
        Base.metadata.create_all(bind=engine)
        db = SessionLocal()
    try:
        if db.query(User).count() > 0:
            print("Database already seeded — skipping.")
            return

        # --- Geography: Country -> Province -> District -> Chiefdom ---
        sierra_leone = GeographicArea(id=uuid.uuid4(), name="Sierra Leone", level="country")
        eastern_province = GeographicArea(id=uuid.uuid4(), name="Eastern Province", level="province", parent=sierra_leone)
        kono_district = GeographicArea(id=uuid.uuid4(), name="Kono District", level="district", parent=eastern_province)
        db.add_all([sierra_leone, eastern_province, kono_district])
        db.flush()

        with open(FACILITIES_DATA_PATH) as f:
            chiefdom_data = json.load(f)

        chiefdom_areas = {}
        facility_count = 0
        first_facility = None
        for chiefdom_name, facilities in sorted(chiefdom_data.items()):
            chiefdom_area = GeographicArea(id=uuid.uuid4(), name=chiefdom_name, level="chiefdom", parent=kono_district)
            db.add(chiefdom_area)
            db.flush()
            chiefdom_areas[chiefdom_name] = chiefdom_area

            for fac in facilities:
                facility = Facility(
                    id=uuid.uuid4(),
                    name=fac["name"],
                    facility_type=fac["type"],
                    geographic_area=chiefdom_area,
                    is_active=True,
                )
                db.add(facility)
                facility_count += 1
                if first_facility is None:
                    first_facility = facility

        db.flush()
        print(f"Seeded {facility_count} real facilities across {len(chiefdom_areas)} chiefdoms in Kono District.")

        # --- Users (passwords are for local/dev testing only — CHANGE before real use) ---
        admin = User(
            id=uuid.uuid4(), full_name="System Administrator", username="admin",
            hashed_password=hash_password("dev-only-change-me"), role="system_admin",
        )
        focal = User(
            id=uuid.uuid4(), full_name="Facility In-Charge (Demo)", username="focal",
            hashed_password=hash_password("dev-only-change-me"), role="facility_focal_person",
            facility_id=first_facility.id,
        )
        db.add_all([admin, focal])
        db.flush()
        # No CHWs seeded — none exist yet for Kono District. Add them via the
        # "Add new CHW" input in the frontend's assign-case flow.

        # --- Immunization schedule ---
        schedule = ImmunizationSchedule(
            id=uuid.uuid4(),
            name="Sierra Leone MoHS EPI Schedule (antigens/ages/dosage/route/site per Ministry chart, Sep 2026; due/overdue/defaulter thresholds still placeholder — see IDTS_Schedule_Verification_Request.docx)",
            is_active=True,
        )
        db.add(schedule)
        db.flush()

        def entry(antigen, dose, age_days, dosage, route, site, min_interval=None, prior=None,
                   due_soon=7, overdue=14, defaulter=30, max_catchup=None, order=0):
            e = ScheduleEntry(
                id=uuid.uuid4(), schedule_id=schedule.id, antigen=antigen, dose_number=dose,
                recommended_age_days=age_days, minimum_age_days=age_days,
                minimum_interval_from_prior_dose_days=min_interval,
                prior_entry_id=prior.id if prior else None,
                due_soon_window_days=due_soon, overdue_window_days=overdue,
                defaulter_threshold_days=defaulter, maximum_catchup_age_days=max_catchup,
                dosage=dosage, route=route, site=site,
                display_order=order,
            )
            db.add(e)
            db.flush()
            return e

        # --- At birth ---
        entry("BCG", 1, 0, "0.05 mls", "Intradermal", "Right Upper arm",
              due_soon=3, overdue=11, defaulter=30, order=1)
        opv0 = entry("OPV (birth dose)", 0, 0, "2 drops (recommended)", "Oral", "Mouth",
              due_soon=3, overdue=11, defaulter=30, order=2)

        # --- 6 weeks (42 days) ---
        opv1 = entry("OPV", 1, 42, "2 drops (recommended)", "Oral", "Mouth", order=3)
        penta1 = entry("Pentavalent", 1, 42, "0.5 mls", "Intramuscular", "Left outer thigh", order=4)
        pcv1 = entry("PCV", 1, 42, "0.5 mls", "Intramuscular", "Right outer thigh", order=5)
        rota1 = entry("Rota", 1, 42, "2 drops (recommended)", "Oral", "Mouth", order=6)

        # --- 10 weeks (70 days) — intervals derived: 70-42=28 days ---
        opv2 = entry("OPV", 2, 70, "2 drops (recommended)", "Oral", "Mouth",
              min_interval=28, prior=opv1, order=7)
        penta2 = entry("Pentavalent", 2, 70, "0.5 mls", "Intramuscular", "Left outer thigh",
              min_interval=28, prior=penta1, order=8)
        pcv2 = entry("PCV", 2, 70, "0.5 mls", "Intramuscular", "Right outer thigh",
              min_interval=28, prior=pcv1, order=9)
        rota2 = entry("Rota", 2, 70, "2 drops (recommended)", "Oral", "Mouth",
              min_interval=28, prior=rota1, order=10)
        ipti1 = entry("IPTi", 1, 70, "Tablet \u00bc\u2013\u00bd", "Oral", "Mouth", order=11)

        # --- 14 weeks (98 days) — intervals derived: 98-70=28 days ---
        entry("OPV", 3, 98, "2 drops (recommended)", "Oral", "Mouth",
              min_interval=28, prior=opv2, order=12)
        penta3 = entry("Pentavalent", 3, 98, "0.5 mls", "Intramuscular", "Left outer thigh",
              min_interval=28, prior=penta2, order=13)
        entry("PCV", 3, 98, "0.5 mls", "Intramuscular", "Right outer thigh",
              min_interval=28, prior=pcv2, order=14)
        ipv1 = entry("IPV", 1, 98, "0.5 mls", "Intramuscular", "Right outer thigh", order=15)
        ipti2 = entry("IPTi", 2, 98, "Tablet \u00bc\u2013\u00bd", "Oral", "Mouth",
              min_interval=28, prior=ipti1, order=16)

        # --- 6 months (180 days) ---
        entry("Vitamin A Supplement", 1, 180, "100,000 IU", "Oral", "Mouth",
              due_soon=14, overdue=30, defaulter=60, order=17)
        malaria1 = entry("Malaria vaccine", 1, 180, "0.5 mls", "Intramuscular", "Right Outer Thigh",
              due_soon=14, overdue=30, defaulter=60, order=18)

        # --- 7 months (210 days) — interval derived: 210-180=30 days ---
        malaria2 = entry("Malaria vaccine", 2, 210, "0.5 mls", "Intramuscular", "Right Outer Thigh",
              min_interval=30, prior=malaria1, due_soon=14, overdue=30, defaulter=60, order=19)

        # --- 8 months (240 days) — interval derived: 240-210=30 days ---
        malaria3 = entry("Malaria vaccine", 3, 240, "0.5 mls", "Intramuscular", "Right Outer Thigh",
              min_interval=30, prior=malaria2, due_soon=14, overdue=30, defaulter=60, order=20)

        # --- 9 months (270 days) ---
        mr1 = entry("Measles-Rubella (MR)", 1, 270, "0.5 mls", "Subcutaneous", "Left Upper arm",
              due_soon=14, overdue=30, defaulter=60, max_catchup=1825, order=21)
        entry("Yellow Fever", 1, 270, "0.5 mls", "Subcutaneous", "Right Upper arm",
              due_soon=14, overdue=30, defaulter=60, order=22)
        # IPV2/IPTi-3 intervals derived: 270-98=172 days
        entry("IPV", 2, 270, "0.5 mls", "Intramuscular", "Right outer thigh",
              min_interval=172, prior=ipv1, due_soon=14, overdue=30, defaulter=60, order=23)
        entry("IPTi", 3, 270, "Tablet \u00bc\u2013\u00bd", "Oral", "Mouth",
              min_interval=172, prior=ipti2, due_soon=14, overdue=30, defaulter=60, order=24)

        # --- 12 months (360 days) ---
        entry("Vitamin A Supplement & Albendazole", 1, 360, "200,000 IU", "Oral", "Mouth",
              due_soon=14, overdue=30, defaulter=60, order=25)

        # --- 15 months (450 days) — intervals derived: MR2 450-270=180 days; Malaria4 450-240=210 days ---
        entry("Measles-Rubella (MR)", 2, 450, "0.5 mls", "Subcutaneous", "Left Upper arm",
              min_interval=180, prior=mr1, due_soon=14, overdue=30, defaulter=60, max_catchup=1825, order=26)
        entry("Malaria vaccine", 4, 450, "0.5 mls", "Intramuscular", "Right Outer Thigh",
              min_interval=210, prior=malaria3, due_soon=14, overdue=30, defaulter=60, order=27)

        db.commit()
        print("Seed complete.")
        print("  27 schedule entries loaded (antigens/ages/dosage/route/site per official MoHS chart).")
        print(f"  Users: admin / focal (password: dev-only-change-me)")
        print(f"  Demo facility for 'focal' user: {first_facility.name}")
        print(f"  No CHWs seeded — add them via 'Add new CHW' in the frontend's assign-case flow.")
    finally:
        if owns_session:
            db.close()


if __name__ == "__main__":
    seed()
