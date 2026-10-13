"""
One-time script: adds new districts/chiefdoms/facilities to the EXISTING
database, without touching anything already there — current districts,
users, children, vaccination history, defaulter cases, everything stays
exactly as it is.

Reads every district file in app/data/ (any *.json shaped like the example
below, e.g. karene_district.json; kono_facilities.json, which the main seed
uses, has a different shape and is skipped):
    {
      "<District Name>": {
        "province": "<Province Name>",
        "chiefdoms": {
          "<Chiefdom Name>": [ {"name": "...", "type": "chp"}, ... ],
          ...
        }
      },
      ...
    }
Add more districts later by extending a JSON file (or dropping a new one in
app/data/) and re-running this script — it is safe to run more than once. Matching is by exact
name: a district, chiefdom, or facility whose name already exists under
the right parent is left alone rather than duplicated; anything new is
added. A Province that doesn't exist yet is created once and reused.

Run with:  PYTHONPATH=. python3 -m app.add_geography
"""

import json
import uuid
from pathlib import Path

from app.db.session import SessionLocal
from app.models.user import Facility, GeographicArea

DATA_DIR = Path(__file__).parent / "data"


def load_district_files(data_dir: Path = DATA_DIR) -> dict:
    """Merges every district-shaped JSON file in data_dir into one
    {district name: {"province": ..., "chiefdoms": {...}}} dict. Files that
    aren't shaped that way (e.g. kono_facilities.json) are ignored."""
    merged: dict = {}
    for path in sorted(data_dir.glob("*.json")):
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict) or not data:
            continue
        if not all(isinstance(v, dict) and "province" in v and "chiefdoms" in v for v in data.values()):
            continue
        merged.update(data)
    return merged


def get_or_create_area(db, name: str, level: str, parent) -> GeographicArea:
    name = name.strip()
    query = db.query(GeographicArea).filter(GeographicArea.name == name, GeographicArea.level == level)
    query = query.filter(GeographicArea.parent_id == (parent.id if parent else None))
    existing = query.first()
    if existing:
        return existing
    area = GeographicArea(id=uuid.uuid4(), name=name, level=level, parent=parent)
    db.add(area)
    db.flush()
    return area


def run(db=None):
    owns_session = db is None
    if owns_session:
        db = SessionLocal()
    try:
        data = load_district_files()
        if not data:
            return

        # All new districts here sit under Sierra Leone -> their Province,
        # the same two top levels your existing Kono data already uses.
        country = db.query(GeographicArea).filter(GeographicArea.level == "country").first()
        if country is None:
            raise RuntimeError("No country-level GeographicArea found — run the main seed script first.")

        total_districts = total_chiefdoms = total_facilities = 0
        total_skipped_facilities = 0

        for district_name, district_info in data.items():
            province = get_or_create_area(db, district_info["province"], "province", country)
            district = get_or_create_area(db, district_name, "district", province)
            total_districts += 1

            for chiefdom_name, facilities in district_info["chiefdoms"].items():
                chiefdom = get_or_create_area(db, chiefdom_name, "chiefdom", district)
                total_chiefdoms += 1

                for fac in facilities:
                    fac_name = fac["name"].strip()
                    existing = (
                        db.query(Facility)
                        .filter(Facility.name == fac_name, Facility.geographic_area_id == chiefdom.id)
                        .first()
                    )
                    if existing:
                        total_skipped_facilities += 1
                        continue
                    db.add(Facility(
                        id=uuid.uuid4(), name=fac_name, facility_type=fac["type"],
                        geographic_area=chiefdom, is_active=True,
                    ))
                    total_facilities += 1

        db.commit()
        print(
            f"Added {total_facilities} new facilities across {total_chiefdoms} chiefdoms in "
            f"{total_districts} district(s). Skipped {total_skipped_facilities} facilities that "
            f"already existed (no duplicates created)."
        )
    finally:
        if owns_session:
            db.close()


if __name__ == "__main__":
    run()
