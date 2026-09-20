from datetime import date
from typing import Optional

from pydantic import BaseModel


class VaccinationSummaryRow(BaseModel):
    antigen: str
    session_type: str
    count: int


class VaccinationSummaryOut(BaseModel):
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    rows: list[VaccinationSummaryRow]
    total_doses: int
