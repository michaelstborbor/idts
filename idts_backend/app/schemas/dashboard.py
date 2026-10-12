from pydantic import BaseModel
import uuid


class DashboardStatsOut(BaseModel):
    registered: int
    fully_immunized: int
    fully_immunized_child_ids: list[uuid.UUID] = []
    needs_attention_children: int
    given_total: int
    dose_status_counts: dict[str, int]
    cases_in_tracing: int
    cases_pending_confirmation: int
    cases_returned_to_service: int
    scope_label: str = ""
    # Adverse events following immunization (all-time, within the caller's scope)
    aefi_total: int = 0
    aefi_by_severity: dict[str, int] = {"mild": 0, "moderate": 0, "severe": 0}
    aefi_serious: int = 0
    aefi_serious_awaiting_report: int = 0
