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
