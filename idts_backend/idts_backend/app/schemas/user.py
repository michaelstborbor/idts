import uuid
from typing import Optional

from pydantic import BaseModel, Field


class CHWCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)
    facility_id: Optional[uuid.UUID] = None


class UserCreate(BaseModel):
    """Admin-only: create a user with any role and an explicit password
    (unlike the CHW quick-add flow, which generates a placeholder)."""
    full_name: str = Field(min_length=1, max_length=200)
    username: str = Field(min_length=3, max_length=100)
    password: str = Field(min_length=8, max_length=200)
    role: str
    facility_id: Optional[uuid.UUID] = None


class UserAdminUpdate(BaseModel):
    """Admin-only: partial update of another user's account."""
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    role: Optional[str] = None
    facility_id: Optional[uuid.UUID] = None
    is_active: Optional[bool] = None


class ProfileUpdate(BaseModel):
    """Self-service: a user editing their own display name. Username,
    role, and facility are admin-controlled, not self-editable — changing
    those is an access-control decision, not a profile preference."""
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=200)


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=200)
