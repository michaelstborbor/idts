import React, { useState } from "react";
import { AlertCircle } from "lucide-react";
import { api } from "../api/client.js";
import { COLORS, SESSION_TYPES, todayIso } from "../constants.js";
import { ErrorText, Label, Modal, PrimaryButton, SecondaryButton, SelectInput, TextInput } from "../components/ui.jsx";

function genIdempotencyKey() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function VaccinationModal({ token, child, dose, facilities, onSaved, onClose }) {
  const [dateGiven, setDateGiven] = useState(todayIso());
  const [facilityId, setFacilityId] = useState(child.facility_id || facilities[0]?.id || "");
  const [sessionType, setSessionType] = useState("fixed");
  const [batchLot, setBatchLot] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const givenDate = new Date(`${dateGiven}T00:00:00`);
  const dob = new Date(`${child.dob}T00:00:00`);
  const today = new Date();
  const isBeforeBirth = dateGiven && givenDate < dob;
  const isFuture = dateGiven && givenDate > today;
  const eligibleDate = dose.eligible_date ? new Date(`${dose.eligible_date}T00:00:00`) : null;
  const isEarlyCatchUp = eligibleDate && !isBeforeBirth && !isFuture && givenDate < eligibleDate;

  async function submit() {
    if (!dateGiven) return setError("Enter the date this dose was given.");
    if (isBeforeBirth) return setError("Date given can't be before the child's date of birth.");
    if (isFuture) return setError("Date given can't be in the future.");
    setError("");
    setSubmitting(true);
    try {
      const record = await api.recordVaccination(token, child.id, {
        schedule_entry_id: dose.schedule_entry_id,
        event_date: dateGiven,
        facility_id: facilityId,
        session_type: sessionType,
        batch_lot_number: batchLot.trim() || null,
        notes: notes.trim() || null,
        idempotency_key: genIdempotencyKey(),
      });
      onSaved(record);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Record ${dose.antigen} · dose ${dose.dose_number}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <Label>Date given</Label>
          <TextInput type="date" value={dateGiven} onChange={(e) => setDateGiven(e.target.value)} max={todayIso()} />
        </div>

        {isEarlyCatchUp && (
          <div style={{ display: "flex", gap: 8, padding: "10px 14px", borderRadius: 8, backgroundColor: "#FBF1DC", color: "#8A6A1F", fontSize: 14 }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>This is earlier than the recommended minimum age/interval for this dose. You can still
              record it — just double-check the date, or confirm this is an intentional catch-up decision.</span>
          </div>
        )}

        <div>
          <Label>Facility / session</Label>
          <SelectInput value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
            {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </SelectInput>
        </div>

        <div>
          <Label>Session type</Label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {SESSION_TYPES.map((s) => (
              <button
                type="button"
                key={s.value}
                onClick={() => setSessionType(s.value)}
                style={{
                  padding: "8px 0", borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: "pointer",
                  border: `1px solid ${sessionType === s.value ? COLORS.primary : COLORS.inputBorder}`,
                  backgroundColor: sessionType === s.value ? COLORS.primary : COLORS.white,
                  color: sessionType === s.value ? COLORS.white : COLORS.ink,
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label>Batch / lot number <span style={{ color: COLORS.muted, fontWeight: 400 }}>(optional)</span></Label>
          <TextInput value={batchLot} onChange={(e) => setBatchLot(e.target.value)} placeholder="e.g. PENT2026-014" />
        </div>

        <div>
          <Label>Notes <span style={{ color: COLORS.muted, fontWeight: 400 }}>(optional)</span></Label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${COLORS.inputBorder}`, fontSize: 15, outline: "none", resize: "none", boxSizing: "border-box", fontFamily: "inherit" }}
          />
        </div>

        <ErrorText>{error}</ErrorText>

        <div style={{ display: "flex", gap: 12 }}>
          <SecondaryButton onClick={onClose} style={{ flex: 1 }}>Cancel</SecondaryButton>
          <PrimaryButton onClick={submit} disabled={submitting} style={{ flex: 1 }}>
            {submitting ? "Saving…" : "Save vaccination"}
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}
