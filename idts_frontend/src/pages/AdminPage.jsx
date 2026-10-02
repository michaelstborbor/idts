import React, { useEffect, useState } from "react";
import { KeyRound, Trash2, UserPlus, UserX, UserCheck } from "lucide-react";
import { api } from "../api/client.js";
import { COLORS, CONTENT_MAX_WIDTH } from "../constants.js";
import { ErrorText, Label, Modal, Pill, PrimaryButton, SecondaryButton, SelectInput, TextInput } from "../components/ui.jsx";

const ROLE_LABELS = {
  system_admin: "System Administrator",
  facility_focal_person: "Facility In-Charge",
  vaccinator: "Vaccinator",
  chw: "Community Health Worker",
  facility_supervisor: "Facility Supervisor",
  district_manager: "District Manager",
  national_user: "National Supervisor",
};
const ROLES = Object.keys(ROLE_LABELS);
// Who needs what: facility-level accounts see one facility, district managers one district.
const FACILITY_ROLES = ["facility_focal_person", "vaccinator", "chw", "facility_supervisor"];
const ACCESS_HINTS = {
  facility_focal_person: "Sees only their own facility's data.",
  vaccinator: "Sees only their own facility's data.",
  chw: "Sees only their own facility's data.",
  facility_supervisor: "Sees only their own facility's data.",
  district_manager: "Sees all facilities in the chosen district, with reports by facility, user and chiefdom.",
  national_user: "Sees all facilities in the country, with reports by district, facility and user.",
  system_admin: "Sees everything and manages user accounts.",
};

function CreateUserModal({ token, facilities, districts, onCreated, onClose }) {
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("chw");
  const [facilityId, setFacilityId] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!fullName.trim()) return setError("Enter the user's full name.");
    if (username.trim().length < 3) return setError("Username must be at least 3 characters.");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (FACILITY_ROLES.includes(role) && !facilityId) return setError("Choose the facility this account belongs to.");
    if (role === "district_manager" && !districtId) return setError("Choose the district this account manages.");
    setError("");
    setSubmitting(true);
    try {
      const user = await api.createUser(token, {
        full_name: fullName.trim(),
        username: username.trim(),
        password,
        role,
        facility_id: FACILITY_ROLES.includes(role) ? facilityId : null,
        geographic_area_id: role === "district_manager" ? districtId : null,
      });
      onCreated(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Create a new user" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <Label>Full name</Label>
          <TextInput value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Adama Sesay" />
        </div>
        <div>
          <Label>Username</Label>
          <TextInput value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. asesay" />
        </div>
        <div>
          <Label>Temporary password</Label>
          <TextInput type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
          <p style={{ fontSize: 12, color: COLORS.muted, marginTop: 4 }}>
            Share this with the user directly — they can change it themselves under Account settings.
          </p>
        </div>
        <div>
          <Label>Role</Label>
          <SelectInput value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </SelectInput>
        </div>
        <p style={{ fontSize: 12, color: COLORS.muted, margin: "-8px 0 0" }}>{ACCESS_HINTS[role]}</p>
        {FACILITY_ROLES.includes(role) && (
          <div>
            <Label>Facility</Label>
            <SelectInput value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
              <option value="">Select a facility…</option>
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </SelectInput>
          </div>
        )}
        {role === "district_manager" && (
          <div>
            <Label>District</Label>
            <SelectInput value={districtId} onChange={(e) => setDistrictId(e.target.value)}>
              <option value="">Select a district…</option>
              {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </SelectInput>
          </div>
        )}

        <ErrorText>{error}</ErrorText>

        <div style={{ display: "flex", gap: 12 }}>
          <SecondaryButton onClick={onClose} style={{ flex: 1 }}>Cancel</SecondaryButton>
          <PrimaryButton onClick={submit} disabled={submitting} style={{ flex: 1 }}>
            {submitting ? "Creating…" : "Create account"}
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

function generateTempPassword() {
  // Avoids look-alike characters (0/O, 1/l/I) so it's easy to read out or type.
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function ResetPasswordModal({ token, user, onClose }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    setError("");
    setSubmitting(true);
    try {
      await api.resetUserPassword(token, user.id, password);
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Reset password — ${user.full_name}`} onClose={onClose}>
      {done ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ fontSize: 14, color: "#2F6B4F", margin: 0 }}>Password reset for @{user.username}.</p>
          <p style={{ fontSize: 14, color: COLORS.ink, margin: 0 }}>
            New temporary password: <strong style={{ fontFamily: "monospace", fontSize: 15 }}>{password}</strong>
          </p>
          <p style={{ fontSize: 12, color: COLORS.muted, margin: 0 }}>
            Share this with the user directly. It won't be shown again after you close this window. They should change it under Account settings.
          </p>
          <PrimaryButton onClick={onClose}>Done</PrimaryButton>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <Label>New temporary password</Label>
            <TextInput type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
            <button
              type="button"
              onClick={() => setPassword(generateTempPassword())}
              style={{ marginTop: 8, padding: 0, background: "none", border: "none", cursor: "pointer", fontSize: 13, color: COLORS.primary }}
            >
              Generate a random password
            </button>
          </div>
          <ErrorText>{error}</ErrorText>
          <div style={{ display: "flex", gap: 12 }}>
            <SecondaryButton onClick={onClose} style={{ flex: 1 }}>Cancel</SecondaryButton>
            <PrimaryButton onClick={submit} disabled={submitting} style={{ flex: 1 }}>
              {submitting ? "Resetting…" : "Reset password"}
            </PrimaryButton>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function AdminPage({ token, facilities, currentUserId }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [togglingId, setTogglingId] = useState(null);
  const [removingId, setRemovingId] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);
  const [districts, setDistricts] = useState([]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const list = await api.listUsers(token, { includeInactive: true });
      setUsers(list);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [token]);
  useEffect(() => { api.listDistricts(token).then(setDistricts).catch(() => {}); }, [token]);

  async function toggleActive(user) {
    setTogglingId(user.id);
    try {
      await api.updateUser(token, user.id, { is_active: !user.is_active });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setTogglingId(null);
    }
  }

  async function removeUser(user) {
    const ok = window.confirm(
      `Permanently remove ${user.full_name} (@${user.username})?\n\nThis cannot be undone. If you only want to block their access, use Deactivate instead.`
    );
    if (!ok) return;
    setRemovingId(user.id);
    setError("");
    try {
      await api.deleteUser(token, user.id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setRemovingId(null);
    }
  }

  const facilityName = (id) => facilities.find((f) => f.id === id)?.name;
  const districtName = (id) => districts.find((d) => d.id === id)?.name;

  return (
    <div style={{ maxWidth: CONTENT_MAX_WIDTH, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button
          onClick={() => setShowCreate(true)}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 8, fontSize: 14, fontWeight: 500, color: "#fff", backgroundColor: COLORS.primary, border: "none", cursor: "pointer" }}
        >
          <UserPlus size={16} /> Create user
        </button>
      </div>

      {error && (
        <p style={{ fontSize: 14, color: "#8C2E1C", backgroundColor: "#F6D9D2", padding: "10px 14px", borderRadius: 8, marginBottom: 16 }}>
          {error}
        </p>
      )}

      {loading ? (
        <p style={{ textAlign: "center", color: COLORS.muted }}>Loading…</p>
      ) : (
        <div style={{ borderRadius: 12, border: `1px solid ${COLORS.border}`, overflow: "hidden", backgroundColor: COLORS.white }}>
          {users.map((u, i) => (
            <div
              key={u.id}
              style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, borderTop: i === 0 ? "none" : `1px solid ${COLORS.border}`, opacity: u.is_active ? 1 : 0.55 }}
            >
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 15, fontWeight: 500, color: COLORS.ink, margin: 0 }}>
                  {u.full_name} <span style={{ color: COLORS.muted, fontWeight: 400 }}>@{u.username}</span>
                  {u.role === "system_admin" && <span style={{ marginLeft: 8 }}><Pill label="Admin" color="#1D4E4A" bg="#DCEBE8" /></span>}
                  {u.id === currentUserId && <span style={{ marginLeft: 6 }}><Pill label="You" color="#6B6660" bg="#EDEBE6" /></span>}
                </p>
                <p style={{ fontSize: 14, color: COLORS.muted, marginTop: 2 }}>
                  {ROLE_LABELS[u.role] || u.role}
                  {u.facility_id ? ` · ${facilityName(u.facility_id) || "Unknown facility"}` : ""}
                  {u.geographic_area_id ? ` · ${districtName(u.geographic_area_id) || "Unknown district"}` : ""}
                  {!u.is_active ? " · Deactivated" : ""}
                </p>
              </div>
              {u.id !== currentUserId && (
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button
                    onClick={() => toggleActive(u)}
                    disabled={togglingId === u.id || removingId === u.id}
                    title={u.is_active ? "Deactivate" : "Reactivate"}
                    style={{
                      padding: 8, borderRadius: 8, border: `1px solid ${u.is_active ? "#F6D9D2" : COLORS.inputBorder}`,
                      backgroundColor: u.is_active ? "#FBE9E4" : COLORS.subtleBg, cursor: "pointer", display: "flex", flexShrink: 0,
                    }}
                  >
                    {u.is_active ? <UserX size={15} color="#8C2E1C" /> : <UserCheck size={15} color={COLORS.ink} />}
                  </button>
                  <button
                    onClick={() => setResetTarget(u)}
                    title="Reset password"
                    style={{
                      padding: 8, borderRadius: 8, border: `1px solid ${COLORS.inputBorder}`, backgroundColor: COLORS.subtleBg,
                      cursor: "pointer", display: "flex", flexShrink: 0,
                    }}
                  >
                    <KeyRound size={15} color={COLORS.ink} />
                  </button>
                  <button
                    onClick={() => removeUser(u)}
                    disabled={togglingId === u.id || removingId === u.id}
                    title="Remove permanently"
                    style={{
                      padding: 8, borderRadius: 8, border: "1px solid #F6D9D2", backgroundColor: "#FBE9E4",
                      cursor: "pointer", display: "flex", flexShrink: 0,
                    }}
                  >
                    <Trash2 size={15} color="#8C2E1C" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {resetTarget && (
        <ResetPasswordModal token={token} user={resetTarget} onClose={() => setResetTarget(null)} />
      )}

      {showCreate && (
        <CreateUserModal
          token={token}
          facilities={facilities}
          districts={districts}
          onCreated={() => { setShowCreate(false); load(); }}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
