import uuid
from typing import Optional

from pydantic import BaseModel, ConfigDict


class FacilityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    facility_type: str
    chiefdom_id: Optional[uuid.UUID] = None
    chiefdom: Optional[str] = None
    district_id: Optional[uuid.UUID] = None
    district: Optional[str] = None


class AreaOut(BaseModel):
    """A single country/district/chiefdom, for the cascading dropdowns in
    Admin > Create user and the Reports Organizational Unit picker."""
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    level: str


# Kept as an alias so older frontend code calling /facilities/districts
# still gets a response shaped the way it expects.
class DistrictOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
