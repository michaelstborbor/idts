"""The startup geography import (app/add_geography.py) reads every district
file in app/data/, so Karene District (karene_district.json) is loaded."""

from app.add_geography import load_district_files


def test_district_files_include_karene_and_skip_kono_seed_file():
    data = load_district_files()
    assert {"Bo District", "Pujehun District", "Karene District"} <= set(data)
    assert "Fiama" not in data  # kono_facilities.json has a different shape and is skipped

    karene = data["Karene District"]
    assert karene["province"] == "Northern Province"
    assert len(karene["chiefdoms"]) == 13
    assert sum(len(f) for f in karene["chiefdoms"].values()) == 62
    assert {"name": "Kamasondo CHC", "type": "chc"} in karene["chiefdoms"]["Buya"]
