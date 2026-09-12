import React, { useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { api } from "../api/client.js";
import { COLORS, PRIORITY_META } from "../constants.js";
import { ErrorText, Label, Modal, PrimaryButton, SecondaryButton, SelectInput, TextInput } from "../components/ui.jsx";

export default function AssignCaseModal({ token, child, dose, priority, onAssigned, onClose }) {
  const [chws, setChws] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [loadingChws, setLoadingChws] = useState(true);
  const [showAddChw, setShowAddChw] = useState(false);
  const [newChwName, setNewChwName] = useState("");
  const [addingChw, setAddingChw] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function loadChws() {
    setLoadingChws(true);
    try {
      // Facility staff can be assigned tracing too, not only CHWs, so offer
      // both — but CHWs are the primary/expected case.
      const [chwList, focalList] = await Promise.all([
        api.listUsers(token, "chw"),
        api.listUsers(token, "facility_focal_person"),
      ]);
      const combined = [...chwList, ...focalList];
      setChws(combined);
      if (combined.length > 0 && !selectedId) setSelectedId(combined[0].id);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingChws(false);
    }
  }

  useEffect(() => { loadChws(); }, []);

  async function submit() {
    if (!selectedId) return setError("Select (or add) a health worker to assign this case to.");
    setError("");
    setSubmitting(true);
    try {
      const newCase = await api.assignDefaulter(token, {
        child_id: child.id,
        schedule_entry_id: dose.schedule_entry_id,
        assigned_to_id: selectedId,
      });
      onAssigned(newCase);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Assign ${child.full_name}'s case`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <p style={{ fontSize: 14, color: COLORS.muted, margin: 0 }}>{dose.reason}</p>
        {priority && (
          <span style={{ display: "inline-block", width: "fit-content", fontSize: 12, padding: "2px 8px", borderRadius: 999, fontWeight: 500, color: PRIORITY_META[priority].color, backgroundColor: PRIORITY_META[priority].bg }}>
            {PRIORITY_META[priority].label}
          </span>
        )}

        <div>
          <Label>Assign to</Label>
          {loadingChws ? (
            <p style={{ fontSize: 14, color: COLORS.muted }}>Loading health workers…</p>
          ) : chws.length === 0 && !showAddChw ? (
            <p style={{ fontSize: 14, color: COLORS.muted }}>
              No health workers on file yet for this facility. Add one below.
            </p>
          ) : (
            <SelectInput value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              {chws.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name} {u.role === "facility_focal_person" ? "(Facility In-Charge)" : "(CHW)"}
                </option>
              ))}
            </SelectInput>
          )}
        </div>

        {!showAddChw ? (
          <button
            type="button"
            onClick={() => setShowAddChw(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: COLORS.primary, background: "none", border: "none", cursor: "pointer", padding: 0, width: "fit-content" }}
          >
            <UserPlus size={15} /> Add new CHW
          </button>
        ) : (
          <div style={{ padding: 14, borderRadius: 8, backgroundColor: COLORS.subtleBg, display: "flex", flexDirection: "column", gap: 10 }}>
            <Label>New CHW's name</Label>
            <TextInput
              value={newChwName}
              onChange={(e) => setNewChwName(e.target.value)}
              placeholder="e.g. Aminata Sesay"
              autoFocus
            />
            <p style={{ fontSize: 12, color: COLORS.muted, margin: 0 }}>
              There's no CHW roster on file yet — this creates a basic record for
              this health worker so they can be assigned cases. They don't need
              login credentials for this to work.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <SecondaryButton onClick={() => { setShowAddChw(false); setNewChwName(""); }} style={{ flex: 1 }}>
                Cancel
              </SecondaryButton>
              <PrimaryButton
                onClick={async () => {
                  if (!newChwName.trim()) return setError("Enter the new CHW's name.");
                  setAddingChw(true);
                  setError("");
                  try {
                    const chw = await api.createChw(token, newChwName.trim(), child.facility_id);
                    setChws((prev) => [...prev, chw]);
                    setSelectedId(chw.id);
                    setNewChwName("");
                    setShowAddChw(false);
                  } catch (err) {
                    setError(err.message);
                  } finally {
                    setAddingChw(false);
                  }
                }}
                disabled={addingChw}
                style={{ flex: 1 }}
              >
                {addingChw ? "Adding…" : "Add CHW"}
              </PrimaryButton>
            </div>
          </div>
        )}

        <ErrorText>{error}</ErrorText>

        <div style={{ display: "flex", gap: 12 }}>
          <SecondaryButton onClick={onClose} style={{ flex: 1 }}>Cancel</SecondaryButton>
          <PrimaryButton onClick={submit} disabled={submitting || !selectedId} style={{ flex: 1 }}>
            {submitting ? "Assigning…" : "Assign case"}
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}
