import uuid
from typing import Optional

from pydantic import BaseModel, Field


class CHWCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)
    facility_id: Optional[uuid.UUID] = None
