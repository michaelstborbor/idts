import React, { useState } from "react";
import { api } from "../api/client.js";
import { COLORS } from "../constants.js";
import { ErrorText, Label, PrimaryButton, SecondaryButton, SelectInput, TextInput } from "../components/ui.jsx";

export default function RegisterForm({ token, facilities, onRegistered, onCancel }) {
  const [name, setName] = useState("");
  const [sex, setSex] = useState("F");
  const [dob, setDob] = useState("");
  const [facilityId, setFacilityId] = useState(facilities[0]?.id || "");
  const [caregiverName, setCaregiverName] = useState("");
  const [caregiverPhone, setCaregiverPhone] = useState("");
  const [error, setError] = useState("");
  const [duplicates, setDuplicates] = useState(null); // null = not checked, [] = checked/none, [...] = found
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function checkDuplicatesAndSubmit() {
    if (!name.trim()) return setError("Enter the child's name.");
    if (!dob) return setError("Enter a date of birth.");
    if (new Date(dob) > new Date()) return setError("Date of birth can't be in the future.");
    if (!facilityId) return setError("Select a facility.");
    setError("");

    if (duplicates === null) {
      setChecking(true);
      try {
        const found = await api.findDuplicates(token, name.trim(), dob);
        setDuplicates(found);
        if (found.length > 0) {
          setChecking(false);
          return; // show the warning, let the user confirm before creating
        }
      } catch (err) {
        setError(err.message);
        setChecking(false);
        return;
      }
      setChecking(false);
    }

    await submit();
  }

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      const child = await api.registerChild(token, {
        full_name: name.trim(),
        sex,
        dob,
        facility_id: facilityId,
        caregiver_name: caregiverName.trim() || null,
        caregiver_phone: caregiverPhone.trim() || null,
      });
      onRegistered(child);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: "0 auto" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <Label>Child's full name</Label>
          <TextInput
            value={name}
            onChange={(e) => { setName(e.target.value); setDuplicates(null); }}
            placeholder="e.g. Fatmata Kamara"
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <Label>Sex</Label>
            <div style={{ display: "flex", borderRadius: 8, border: `1px solid ${COLORS.inputBorder}`, overflow: "hidden" }}>
              {["F", "M"].map((s) => (
                <button
                  type="button"
                  key={s}
                  onClick={() => setSex(s)}
                  style={{
                    flex: 1, padding: "10px 0", fontSize: 14, fontWeight: 500, border: "none", cursor: "pointer",
                    backgroundColor: sex === s ? COLORS.primary : COLORS.white,
                    color: sex === s ? COLORS.white : COLORS.ink,
                  }}
                >
                  {s === "F" ? "Female" : "Male"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>Date of birth</Label>
            <TextInput
              type="date"
              value={dob}
              onChange={(e) => { setDob(e.target.value); setDuplicates(null); }}
              max={new Date().toISOString().slice(0, 10)}
            />
          </div>
        </div>

        <div>
          <Label>Facility</Label>
          <SelectInput value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
            {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </SelectInput>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <Label>Caregiver name</Label>
            <TextInput value={caregiverName} onChange={(e) => setCaregiverName(e.target.value)} placeholder="e.g. Mariama Kamara" />
          </div>
          <div>
            <Label>Caregiver phone</Label>
            <TextInput value={caregiverPhone} onChange={(e) => setCaregiverPhone(e.target.value)} placeholder="e.g. 076 000 000" />
          </div>
        </div>

        {duplicates && duplicates.length > 0 && (
          <div style={{ padding: "12px 14px", borderRadius: 8, backgroundColor: "#FBF1DC", color: "#8A6A1F", fontSize: 14, lineHeight: 1.5 }}>
            <strong>Possible existing record{duplicates.length > 1 ? "s" : ""} found:</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {duplicates.map((d) => (
                <li key={d.child.id}>{d.child.full_name} ({d.child.system_id}) — {d.match_reason}</li>
              ))}
            </ul>
            <p style={{ margin: "8px 0 0" }}>Register anyway if this is genuinely a different child.</p>
          </div>
        )}

        <ErrorText>{error}</ErrorText>

        <div style={{ display: "flex", gap: 12 }}>
          <SecondaryButton onClick={onCancel} style={{ flex: 1 }}>Cancel</SecondaryButton>
          <PrimaryButton onClick={checkDuplicatesAndSubmit} disabled={checking || submitting} style={{ flex: 1 }}>
            {checking ? "Checking…" : submitting ? "Registering…" : duplicates && duplicates.length > 0 ? "Register anyway" : "Register child"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
