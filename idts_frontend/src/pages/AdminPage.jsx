import React, { useEffect, useState } from "react";
import { UserPlus, UserX, UserCheck } from "lucide-react";
import { api } from "../api/client.js";
import { COLORS } from "../constants.js";
import { ErrorText, Label, Modal, PrimaryButton, SecondaryButton, SelectInput, TextInput } from "../components/ui.jsx";

const ROLE_LABELS = {
  system_admin: "System Administrator",
  facility_focal_person: "Facility In-Charge",
  vaccinator: "Vaccinator",
  chw: "Community Health Worker",
  facility_supervisor: "Facility Supervisor",
  district_manager: "District Manager",
  national_user: "National Programme User",
};
const ROLES = Object.keys(ROLE_LABELS);

function CreateUserModal({ token, facilities, onCreated, onClose }) {
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("chw");
  const [facilityId, setFacilityId] = useState(facilities[0]?.id || "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!fullName.trim()) return setError("Enter the user's full name.");
    if (username.trim().length < 3) return setError("Username must be at least 3 characters.");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    setError("");
    setSubmitting(true);
    try {
      const user = await api.createUser(token, {
        full_name: fullName.trim(),
        username: username.trim(),
        password,
        role,
        facility_id: facilityId || null,
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
        <div>
          <Label>Facility <span style={{ color: COLORS.muted, fontWeight: 400 }}>(optional)</span></Label>
          <SelectInput value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
            <option value="">No facility assigned</option>
            {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </SelectInput>
        </div>

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

export default function AdminPage({ token, facilities }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [togglingId, setTogglingId] = useState(null);

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

  const facilityName = (id) => facilities.find((f) => f.id === id)?.name;

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
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
                </p>
                <p style={{ fontSize: 14, color: COLORS.muted, marginTop: 2 }}>
                  {ROLE_LABELS[u.role] || u.role}
                  {u.facility_id ? ` · ${facilityName(u.facility_id) || "Unknown facility"}` : ""}
                  {!u.is_active ? " · Deactivated" : ""}
                </p>
              </div>
              <button
                onClick={() => toggleActive(u)}
                disabled={togglingId === u.id}
                title={u.is_active ? "Deactivate" : "Reactivate"}
                style={{
                  padding: 8, borderRadius: 8, border: `1px solid ${u.is_active ? "#F6D9D2" : COLORS.inputBorder}`,
                  backgroundColor: u.is_active ? "#FBE9E4" : COLORS.subtleBg, cursor: "pointer", display: "flex", flexShrink: 0,
                }}
              >
                {u.is_active ? <UserX size={15} color="#8C2E1C" /> : <UserCheck size={15} color={COLORS.ink} />}
              </button>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateUserModal
          token={token}
          facilities={facilities}
          onCreated={() => { setShowCreate(false); load(); }}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
