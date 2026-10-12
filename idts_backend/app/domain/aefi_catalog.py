"""
AEFI (Adverse Events Following Immunization) catalog — the single source of
truth for every dropdown, checklist and rule used by the AEFI tab, the
dashboard and the reports. The backend validates against these keys, and the
frontend renders whatever /api/v1/aefi/catalog returns, so the two can never
drift apart.

Built on the WHO / CIOMS AEFI framework (definitions of AEFI, "serious" vs
"non-serious", cause-specific classification, 24-hour reporting and 48-hour
investigation of serious events). The exact WHO SEARO "Guidelines for AEFI
surveillance, 3rd edition (2014)" PDF could not be machine-read when this was
written, so this catalog follows the standard WHO/CIOMS framework rather than
being transcribed from that document — have your EPI/clinical lead compare it
with the document and your national AEFI guideline before go-live.

Two ideas that are easy to mix up, and are kept SEPARATE here on purpose:
  - SEVERITY (mild / moderate / severe) describes how intense an event is.
  - SERIOUSNESS (WHO/ICH criteria: death, life-threatening, hospitalization,
    disability, congenital anomaly, medically important) describes the
    OUTCOME and drives mandatory reporting. A "severe" event is not
    automatically "serious", and a "serious" event is not always "severe".

No drug doses appear anywhere in this file, deliberately: doses (paracetamol,
epinephrine) are weight/age-based and must come from the national or WHO
dosing chart, never from a free-text hint in an app.
"""

DISCLAIMER = (
    "Decision support only — it does not replace clinical judgement or your national AEFI guideline. "
    "Always take drug doses (e.g. paracetamol, epinephrine) from the national or WHO weight-based dosing chart."
)

SOURCE_NOTE = (
    "Based on the WHO/CIOMS AEFI framework. Confirm against the national AEFI guideline before use."
)

SEVERITIES = [
    {
        "key": "mild",
        "label": "Mild",
        "description": "Noticed by the caregiver or health worker but does not interfere with normal activities. "
                       "Reassurance and simple home care are enough.",
    },
    {
        "key": "moderate",
        "label": "Moderate",
        "description": "Interferes with normal activities (feeding, sleeping, playing) and/or needs medical attention "
                       "or treatment at a health facility, but is not life-threatening.",
    },
    {
        "key": "severe",
        "label": "Severe",
        "description": "Prevents normal activities or needs urgent medical intervention. 'Severe' describes intensity — "
                       "it is not the same as 'serious' (see the seriousness criteria).",
    },
]

# WHO / ICH seriousness criteria. Any one makes the AEFI "serious", which
# means it must be reported to the next level within 24 hours and
# investigated within 48 hours.
SERIOUS_CRITERIA = [
    {"key": "death", "label": "Death"},
    {"key": "life_threatening", "label": "Life-threatening (child was at immediate risk of death)"},
    {"key": "hospitalization", "label": "Required hospitalization, or prolonged an existing hospital stay"},
    {"key": "disability", "label": "Resulted in persistent or significant disability / incapacity"},
    {"key": "congenital_anomaly", "label": "Congenital anomaly / birth defect"},
    {"key": "medically_important", "label": "Other medically important event (judged serious by a clinician)"},
]

# WHO cause-specific classification of an AEFI (assigned after investigation;
# "under investigation" until then).
CAUSE_CATEGORIES = [
    {
        "key": "under_investigation",
        "label": "Not yet classified / under investigation",
        "description": "Default until the case has been investigated.",
    },
    {
        "key": "vaccine_product_related",
        "label": "Vaccine product-related reaction",
        "description": "Caused or precipitated by the inherent properties of the vaccine, even when used correctly.",
    },
    {
        "key": "vaccine_quality_defect",
        "label": "Vaccine quality defect-related reaction",
        "description": "Caused by a defect in the quality of the vaccine, including its administration device, as supplied by the manufacturer.",
    },
    {
        "key": "immunization_error",
        "label": "Immunization error-related reaction",
        "description": "Caused by inappropriate vaccine handling, prescribing or administration (programmatic error).",
    },
    {
        "key": "immunization_anxiety",
        "label": "Immunization anxiety-related reaction",
        "description": "Arising from anxiety about the immunization itself (e.g. fainting, hyperventilation).",
    },
    {
        "key": "coincidental",
        "label": "Coincidental event",
        "description": "Caused by something other than the vaccine, the error or anxiety — it just happened after vaccination.",
    },
]

OUTCOMES = [
    {"key": "unknown", "label": "Unknown / not yet known"},
    {"key": "recovering", "label": "Recovering"},
    {"key": "recovered", "label": "Recovered"},
    {"key": "recovered_sequelae", "label": "Recovered with sequelae"},
    {"key": "not_recovered", "label": "Not recovered"},
    {"key": "died", "label": "Died"},
]

# Common AEFIs. "guidance" lines are shown next to the event type in the form.
EVENT_TYPES = [
    {
        "key": "local_reaction",
        "label": "Local reaction (pain, swelling, redness at injection site)",
        "guidance": [
            "Common and usually settles by itself within a few days.",
            "A reaction that spreads widely, keeps getting worse, or comes with fever may need clinical assessment.",
        ],
    },
    {
        "key": "injection_site_abscess",
        "label": "Injection site abscess",
        "guidance": [
            "Collection of pus at the injection site. A sterile abscess comes from the vaccine; a bacterial abscess usually points to an injection-practice problem.",
            "Always review injection practices (hand hygiene, sterile equipment, reconstitution, correct site).",
        ],
    },
    {
        "key": "bcg_lymphadenitis",
        "label": "BCG lymphadenitis (swollen lymph node after BCG)",
        "guidance": [
            "Swelling of the lymph node on the same side as the BCG injection. A non-suppurative node often settles on its own.",
            "A node that is large, softening or draining needs clinician assessment.",
        ],
    },
    {
        "key": "fever",
        "label": "Fever",
        "guidance": [
            "Fever is a common, usually short-lived reaction. Look for other causes of fever (e.g. malaria, infection), especially if it persists.",
        ],
    },
    {
        "key": "rash",
        "label": "Rash / mild allergic reaction",
        "guidance": [
            "Skin rash or itching without breathing difficulty, swelling of the face/throat, or collapse. If any of those are present, record it as anaphylaxis instead.",
        ],
    },
    {
        "key": "persistent_crying",
        "label": "Persistent inconsolable crying (3 hours or more)",
        "guidance": [
            "Usually settles within about a day. Check for other causes of distress before attributing it to the vaccine.",
        ],
    },
    {
        "key": "febrile_seizure",
        "label": "Seizure with fever (febrile seizure)",
        "guidance": [
            "Seek medical assessment for every seizure. Protect the child during the seizure and treat the fever.",
        ],
    },
    {
        "key": "seizure_other",
        "label": "Seizure without fever / encephalopathy",
        "guidance": [
            "Needs urgent medical assessment and is usually treated as a serious AEFI until investigated.",
        ],
    },
    {
        "key": "hhe",
        "label": "Hypotonic-hyporesponsive episode (HHE)",
        "guidance": [
            "Sudden limpness with reduced responsiveness and pallor or blueness, usually within hours of vaccination. Needs urgent medical assessment.",
        ],
    },
    {
        "key": "anaphylaxis",
        "label": "Anaphylaxis / severe allergic reaction",
        "guidance": [
            "Medical emergency, usually starting within minutes to an hour: breathing difficulty, swelling of face or throat, rapid weak pulse, collapse.",
            "Give epinephrine (adrenaline) intramuscularly IMMEDIATELY using the weight-based dose in your national protocol — do not wait for referral.",
        ],
    },
    {
        "key": "vapp",
        "label": "Vaccine-associated paralytic polio / acute flaccid paralysis",
        "guidance": [
            "Any acute flaccid paralysis after OPV must be reported and investigated urgently, including stool specimens, as directed by the surveillance team.",
        ],
    },
    {
        "key": "sepsis_toxic_shock",
        "label": "Sepsis / toxic shock syndrome",
        "guidance": [
            "A life-threatening infection after vaccination points strongly to an injection-practice or contamination problem — investigate urgently and keep the vial.",
        ],
    },
    {
        "key": "other",
        "label": "Other (describe)",
        "guidance": ["Describe the event in your own words in the box provided."],
    },
]

# Management actions the health worker can tick. "group" is only for layout.
MANAGEMENT_ACTIONS = [
    # Care at the facility
    {"key": "reassure_caregiver", "group": "care", "label": "Reassure the caregiver and explain what to expect"},
    {"key": "cold_compress", "group": "care", "label": "Cool, damp cloth on the injection site (no harmful substances)"},
    {"key": "analgesic_antipyretic", "group": "care", "label": "Paracetamol for pain/fever — dose from the national weight-based chart"},
    {"key": "fluids_light_clothing", "group": "care", "label": "Extra fluids/breastfeeding, light clothing, tepid sponging for fever"},
    {"key": "clean_dress_site", "group": "care", "label": "Keep the site clean and dry; do not squeeze or cut without clinical assessment"},
    {"key": "observe", "group": "care", "label": "Observe at the facility and monitor vital signs"},
    {"key": "seizure_first_aid", "group": "care", "label": "Seizure first aid: recovery position, protect from injury, nothing in the mouth, note duration, treat fever"},
    {"key": "epinephrine_im", "group": "care", "label": "Epinephrine (adrenaline) IM immediately — dose from the national anaphylaxis protocol"},
    {"key": "airway_support", "group": "care", "label": "Support airway/breathing: lay flat, oxygen if available, call for help, resuscitate if needed"},
    {"key": "clinician_assessment", "group": "care", "label": "Clinician assessment (including antibiotics if bacterial infection is suspected)"},
    # Referral
    {"key": "refer_hospital", "group": "referral", "label": "Refer / transfer to hospital with a referral note"},
    {"key": "admit_observe", "group": "referral", "label": "Hospital admission / observation"},
    # Reporting and investigation
    {"key": "report_routine", "group": "reporting", "label": "Include in the routine (non-serious) AEFI report to the district"},
    {"key": "report_24h", "group": "reporting", "label": "Report to the district immunization/AEFI focal person within 24 hours"},
    {"key": "investigate_48h", "group": "reporting", "label": "Start the case investigation (AEFI investigation form) within 48 hours"},
    {"key": "keep_vaccine_vial", "group": "reporting", "label": "Keep the vial/diluent and record batch/lot; keep the cold chain; hold the suspect lot pending investigation"},
    {"key": "review_injection_practice", "group": "reporting", "label": "Review injection and vaccine-handling practices at the session/facility"},
    {"key": "collect_specimens", "group": "reporting", "label": "Collect specimens as directed by the investigation team"},
    {"key": "notify_epi_manager", "group": "reporting", "label": "Inform the EPI manager / AEFI committee"},
    # Follow-up
    {"key": "advise_return", "group": "followup", "label": "Explain danger signs and when to come back"},
    {"key": "follow_up_visit", "group": "followup", "label": "Schedule a follow-up visit"},
    {"key": "next_dose_review", "group": "followup", "label": "Ask a clinician/AEFI committee before the next dose of the implicated vaccine"},
]

EVENT_TYPE_KEYS = {e["key"] for e in EVENT_TYPES}
EVENT_TYPE_LABELS = {e["key"]: e["label"] for e in EVENT_TYPES}
SEVERITY_KEYS = {s["key"] for s in SEVERITIES}
SERIOUS_CRITERIA_KEYS = {c["key"] for c in SERIOUS_CRITERIA}
CAUSE_CATEGORY_KEYS = {c["key"] for c in CAUSE_CATEGORIES}
OUTCOME_KEYS = {o["key"] for o in OUTCOMES}
MANAGEMENT_ACTION_KEYS = {a["key"] for a in MANAGEMENT_ACTIONS}

# Event types where WHO-aligned guidance expects prompt reporting even if the
# case turns out not to meet the seriousness criteria.
ALWAYS_REPORT_PROMPTLY = {"anaphylaxis", "hhe", "seizure_other", "febrile_seizure", "vapp", "sepsis_toxic_shock"}

REPORT_WITHIN_HOURS = 24
INVESTIGATE_WITHIN_HOURS = 48


def catalog() -> dict:
    return {
        "disclaimer": DISCLAIMER,
        "source_note": SOURCE_NOTE,
        "severities": SEVERITIES,
        "serious_criteria": SERIOUS_CRITERIA,
        "cause_categories": CAUSE_CATEGORIES,
        "outcomes": OUTCOMES,
        "event_types": EVENT_TYPES,
        "management_actions": MANAGEMENT_ACTIONS,
        "report_within_hours": REPORT_WITHIN_HOURS,
        "investigate_within_hours": INVESTIGATE_WITHIN_HOURS,
    }


def suggest_management(event_type: str, severity: str, serious_criteria=(), part_of_cluster: bool = False) -> dict:
    """
    Suggested management for the form to pre-tick. The health worker can
    always change the ticks — this is a starting point, not an order.
    Returns {"actions": [keys], "guidance": [text lines], "report_timeline": "24h" | "routine"}.
    """
    actions: list = []
    guidance: list = []

    def add(*keys):
        for k in keys:
            if k not in actions:
                actions.append(k)

    serious = bool(serious_criteria)
    severe = severity == "severe"
    moderate_or_worse = severity in ("moderate", "severe")

    if event_type == "local_reaction":
        add("reassure_caregiver", "cold_compress", "advise_return")
        if severity == "mild":
            add("analgesic_antipyretic")
        if moderate_or_worse:
            add("observe", "clinician_assessment", "follow_up_visit")
            guidance.append("A spreading, worsening or fever-associated local reaction may be an infection — have a clinician assess it.")

    elif event_type == "injection_site_abscess":
        add("clean_dress_site", "clinician_assessment", "review_injection_practice", "follow_up_visit", "advise_return")
        if moderate_or_worse:
            add("refer_hospital")
        guidance.append("Review how the injection was given; a bacterial abscess usually reflects an injection-practice problem.")

    elif event_type == "bcg_lymphadenitis":
        add("reassure_caregiver", "advise_return", "follow_up_visit")
        if moderate_or_worse:
            add("clinician_assessment", "refer_hospital")
            guidance.append("A large, softening or draining node should be assessed by a clinician rather than treated at the session.")

    elif event_type == "fever":
        add("fluids_light_clothing", "analgesic_antipyretic", "advise_return")
        if moderate_or_worse:
            add("observe", "clinician_assessment", "follow_up_visit")
            guidance.append("Look for other causes of fever (e.g. malaria or another infection), especially if it persists.")

    elif event_type == "rash":
        add("reassure_caregiver", "advise_return")
        if moderate_or_worse:
            add("clinician_assessment", "follow_up_visit", "next_dose_review")
            guidance.append("If there is any breathing difficulty or swelling of the face/throat, record it as anaphylaxis instead.")

    elif event_type == "persistent_crying":
        add("reassure_caregiver", "observe", "advise_return")
        if moderate_or_worse:
            add("clinician_assessment", "follow_up_visit")

    elif event_type == "febrile_seizure":
        add("seizure_first_aid", "fluids_light_clothing", "analgesic_antipyretic", "refer_hospital", "report_24h", "follow_up_visit")
        guidance.append("Every seizure needs a medical assessment.")

    elif event_type == "seizure_other":
        add("seizure_first_aid", "refer_hospital", "report_24h", "investigate_48h", "notify_epi_manager", "keep_vaccine_vial")

    elif event_type == "hhe":
        add("observe", "refer_hospital", "report_24h", "investigate_48h", "keep_vaccine_vial", "next_dose_review")

    elif event_type == "anaphylaxis":
        add(
            "epinephrine_im", "airway_support", "refer_hospital", "report_24h", "investigate_48h",
            "keep_vaccine_vial", "notify_epi_manager", "next_dose_review",
        )
        guidance.append("Treat as an emergency: give epinephrine IM immediately (national weight-based dose) and do not delay for referral.")

    elif event_type == "vapp":
        add("refer_hospital", "collect_specimens", "report_24h", "investigate_48h", "notify_epi_manager", "keep_vaccine_vial")

    elif event_type == "sepsis_toxic_shock":
        add(
            "airway_support", "clinician_assessment", "refer_hospital", "report_24h", "investigate_48h",
            "keep_vaccine_vial", "review_injection_practice", "notify_epi_manager",
        )

    else:  # "other" or anything unrecognised
        add("reassure_caregiver", "advise_return")
        if moderate_or_worse:
            add("observe", "clinician_assessment", "follow_up_visit")

    # Escalations that apply to ANY event type
    if severe:
        add("refer_hospital", "report_24h")
        guidance.append("Severe events need urgent clinical assessment. Confirm whether any seriousness criterion applies.")
    if serious:
        add("refer_hospital", "report_24h", "investigate_48h", "keep_vaccine_vial", "notify_epi_manager")
        guidance.append("Serious AEFI: report to the next level within 24 hours and start the investigation within 48 hours.")
    if part_of_cluster:
        add("report_24h", "investigate_48h", "keep_vaccine_vial", "notify_epi_manager")
        guidance.append("Part of a cluster: investigate together (same vial/lot, session, vaccinator or place) and hold the suspect lot.")

    prompt = serious or severe or part_of_cluster or event_type in ALWAYS_REPORT_PROMPTLY
    if not prompt:
        add("report_routine")

    return {
        "actions": actions,
        "guidance": guidance,
        "report_timeline": "24h" if prompt else "routine",
    }
