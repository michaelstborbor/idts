"""AEFI catalog consistency — pure Python, no database needed."""
import itertools
import json
import re

from app.domain import aefi_catalog as c


def test_every_suggested_action_exists_in_the_catalog():
    for et, sev, crit, cluster in itertools.product(c.EVENT_TYPE_KEYS, c.SEVERITY_KEYS, [(), ("hospitalization",)], [False, True]):
        out = c.suggest_management(et, sev, crit, cluster)
        assert set(out["actions"]) <= c.MANAGEMENT_ACTION_KEYS
        assert len(out["actions"]) == len(set(out["actions"]))
        assert out["report_timeline"] in ("24h", "routine")


def test_seriousness_overrides_mild_severity():
    out = c.suggest_management("local_reaction", "mild", ("hospitalization",), False)
    assert {"report_24h", "investigate_48h", "refer_hospital"} <= set(out["actions"])


def test_severe_escalates_even_without_a_seriousness_criterion():
    out = c.suggest_management("fever", "severe", (), False)
    assert {"refer_hospital", "report_24h"} <= set(out["actions"])


def test_anaphylaxis_starts_with_epinephrine():
    out = c.suggest_management("anaphylaxis", "severe", ("life_threatening",), False)
    assert out["actions"][0] == "epinephrine_im"


def test_mild_local_reaction_is_a_routine_report_only():
    out = c.suggest_management("local_reaction", "mild", (), False)
    assert "report_routine" in out["actions"] and "report_24h" not in out["actions"]
    assert out["report_timeline"] == "routine"


def test_catalog_contains_no_drug_doses():
    assert not re.findall(r"\d+(?:\.\d+)?\s?(?:mg|mcg|ml|mL|µg|IU)\b", json.dumps(c.catalog()))
