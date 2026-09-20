import React, { useState } from "react";
import { api } from "../api/client.js";
import { COLORS } from "../constants.js";
import { ErrorText, Label, PrimaryButton, TextInput } from "../components/ui.jsx";

export default function AccountSettingsPage({ token, currentUser, onProfileUpdated }) {
  const [fullName, setFullName] = useState(currentUser.full_name);
  const [profileError, setProfileError] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  async function saveProfile() {
    if (!fullName.trim()) return setProfileError("Name can't be empty.");
    setProfileError("");
    setProfileSaved(false);
    setSavingProfile(true);
    try {
      const updated = await api.updateMyProfile(token, fullName.trim());
      onProfileUpdated(updated);
      setProfileSaved(true);
    } catch (err) {
      setProfileError(err.message);
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword() {
    if (!currentPassword) return setPasswordError("Enter your current password.");
    if (newPassword.length < 8) return setPasswordError("New password must be at least 8 characters.");
    if (newPassword !== confirmPassword) return setPasswordError("New password and confirmation don't match.");
    setPasswordError("");
    setPasswordSaved(false);
    setSavingPassword(true);
    try {
      await api.changeMyPassword(token, currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSaved(true);
    } catch (err) {
      setPasswordError(err.message);
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column", gap: 32 }}>
      <div>
        <h3 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "#6B6660", marginBottom: 12 }}>
          Profile
        </h3>
        <div style={{ borderRadius: 12, border: `1px solid ${COLORS.border}`, padding: 20, backgroundColor: COLORS.white, display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ fontSize: 13, color: COLORS.muted, margin: 0 }}>
            Username: <strong style={{ color: COLORS.ink }}>{currentUser.username}</strong> ·
            Role: <strong style={{ color: COLORS.ink }}>{currentUser.role.replace(/_/g, " ")}</strong>
            <br />Username and role can only be changed by an administrator.
          </p>
          <div>
            <Label>Display name</Label>
            <TextInput value={fullName} onChange={(e) => { setFullName(e.target.value); setProfileSaved(false); }} />
          </div>
          <ErrorText>{profileError}</ErrorText>
          {profileSaved && <p style={{ fontSize: 14, color: "#2F6B4F", margin: 0 }}>Saved.</p>}
          <PrimaryButton onClick={saveProfile} disabled={savingProfile}>
            {savingProfile ? "Saving…" : "Save name"}
          </PrimaryButton>
        </div>
      </div>

      <div>
        <h3 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "#6B6660", marginBottom: 12 }}>
          Change password
        </h3>
        <div style={{ borderRadius: 12, border: `1px solid ${COLORS.border}`, padding: 20, backgroundColor: COLORS.white, display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <Label>Current password</Label>
            <TextInput type="password" value={currentPassword} onChange={(e) => { setCurrentPassword(e.target.value); setPasswordSaved(false); }} />
          </div>
          <div>
            <Label>New password</Label>
            <TextInput type="password" value={newPassword} onChange={(e) => { setNewPassword(e.target.value); setPasswordSaved(false); }} placeholder="At least 8 characters" />
          </div>
          <div>
            <Label>Confirm new password</Label>
            <TextInput type="password" value={confirmPassword} onChange={(e) => { setConfirmPassword(e.target.value); setPasswordSaved(false); }} />
          </div>
          <ErrorText>{passwordError}</ErrorText>
          {passwordSaved && <p style={{ fontSize: 14, color: "#2F6B4F", margin: 0 }}>Password changed.</p>}
          <PrimaryButton onClick={savePassword} disabled={savingPassword}>
            {savingPassword ? "Saving…" : "Change password"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
