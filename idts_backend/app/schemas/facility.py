import uuid
from typing import Optional

from pydantic import BaseModel, ConfigDict


class FacilityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    facility_type: str
    chiefdom: Optional[str] = None
    district: Optional[str] = None


class DistrictOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
