"""
Seed script.

Geography and facilities are REAL data: Sierra Leone's actual administrative
hierarchy down to chiefdom level, and 108 actual health facilities across
14 chiefdoms in Kono District, sourced from a Ministry of Health HMIS/CHIS
training roster the user provided directly (FACILITY_LIST_BY_CHIEFDOM.xlsx).
This is a genuine improvement over earlier placeholder geography.

The immunization SCHEDULE remains synthetic and unverified (see design
doc §7/§14) — real facility names do not imply a verified clinical
schedule; those are two independent open items, not one.

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


def seed():
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

        # --- Immunization schedule (synthetic, structured like Sierra Leone's
        # typical EPI programme, UNVERIFIED against the real MoHS schedule) ---
        schedule = ImmunizationSchedule(id=uuid.uuid4(), name="Synthetic SL-structured EPI schedule (unverified)", is_active=True)
        db.add(schedule)
        db.flush()

        def entry(antigen, dose, min_age, min_interval=None, prior=None, due_soon=7, overdue=14, defaulter=30, max_catchup=None, order=0):
            e = ScheduleEntry(
                id=uuid.uuid4(), schedule_id=schedule.id, antigen=antigen, dose_number=dose,
                recommended_age_days=min_age, minimum_age_days=min_age,
                minimum_interval_from_prior_dose_days=min_interval,
                prior_entry_id=prior.id if prior else None,
                due_soon_window_days=due_soon, overdue_window_days=overdue,
                defaulter_threshold_days=defaulter, maximum_catchup_age_days=max_catchup,
                display_order=order,
            )
            db.add(e)
            db.flush()
            return e

        bcg1 = entry("BCG", 1, 0, due_soon=3, overdue=11, order=1)
        entry("OPV (birth dose)", 0, 0, due_soon=3, overdue=11, order=2)
        penta1 = entry("Pentavalent", 1, 42, order=3)
        opv1 = entry("OPV", 1, 42, order=4)
        pcv1 = entry("PCV", 1, 42, order=5)
        penta2 = entry("Pentavalent", 2, 70, min_interval=28, prior=penta1, order=6)
        opv2 = entry("OPV", 2, 70, min_interval=28, prior=opv1, order=7)
        pcv2 = entry("PCV", 2, 70, min_interval=28, prior=pcv1, order=8)
        entry("Pentavalent", 3, 98, min_interval=28, prior=penta2, order=9)
        entry("OPV", 3, 98, min_interval=28, prior=opv2, order=10)
        entry("PCV", 3, 98, min_interval=28, prior=pcv2, order=11)
        entry("IPV", 1, 98, order=12)
        entry("Yellow Fever", 1, 270, due_soon=14, overdue=30, defaulter=60, order=13)
        mr1 = entry("Measles-Rubella", 1, 270, due_soon=14, overdue=30, defaulter=60, max_catchup=1825, order=14)
        entry("Measles-Rubella", 2, 540, min_interval=28, prior=mr1, due_soon=14, overdue=30, defaulter=60, max_catchup=1825, order=15)

        db.commit()
        print("Seed complete.")
        print(f"  Users: admin / focal (password: dev-only-change-me)")
        print(f"  Demo facility for 'focal' user: {first_facility.name}")
        print(f"  No CHWs seeded — add them via 'Add new CHW' in the frontend's assign-case flow.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
