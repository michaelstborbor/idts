import React, { useState } from "react";
import { api } from "../api/client.js";
import { COLORS } from "../constants.js";
import { ErrorText, Label, PrimaryButton, SecondaryButton, SelectInput, TextInput } from "../components/ui.jsx";

/**
 * Shared form for both registering a new child and editing an existing
 * one — the fields are the same; only the submit action and a few UI
 * details (title, button label, whether duplicate-checking applies)
 * differ. Editing intentionally excludes facility (a transfer is its own
 * workflow, not a field edit — see the backend's update_child docstring)
 * and skips duplicate-checking (the child already exists; checking for
 * duplicates of an existing record doesn't make sense).
 */
export default function ChildForm({ token, facilities, mode = "create", initialChild, onSaved, onCancel }) {
  const isEdit = mode === "edit";

  const [name, setName] = useState(initialChild?.full_name || "");
  const [sex, setSex] = useState(initialChild?.sex || "F");
  const [dob, setDob] = useState(initialChild?.dob || "");
  const [facilityId, setFacilityId] = useState(initialChild?.facility_id || facilities[0]?.id || "");
  const [address, setAddress] = useState(initialChild?.address || "");
  const [caregiverName, setCaregiverName] = useState(initialChild?.caregiver_name || "");
  const [caregiverPhone, setCaregiverPhone] = useState(initialChild?.caregiver_phone || "");
  const [error, setError] = useState("");
  const [duplicates, setDuplicates] = useState(isEdit ? [] : null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function checkDuplicatesAndSubmit() {
    if (!name.trim()) return setError("Enter the child's name.");
    if (!dob) return setError("Enter a date of birth.");
    if (new Date(dob) > new Date()) return setError("Date of birth can't be in the future.");
    if (!isEdit && !facilityId) return setError("Select a facility.");
    setError("");

    if (!isEdit && duplicates === null) {
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
      if (isEdit) {
        const updated = await api.updateChild(token, initialChild.id, {
          full_name: name.trim(),
          sex,
          dob,
          address: address.trim() || null,
          caregiver_name: caregiverName.trim() || null,
          caregiver_phone: caregiverPhone.trim() || null,
        });
        onSaved(updated);
      } else {
        const child = await api.registerChild(token, {
          full_name: name.trim(),
          sex,
          dob,
          facility_id: facilityId,
          address: address.trim() || null,
          caregiver_name: caregiverName.trim() || null,
          caregiver_phone: caregiverPhone.trim() || null,
        });
        onSaved(child);
      }
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
            onChange={(e) => { setName(e.target.value); if (!isEdit) setDuplicates(null); }}
            placeholder="e.g. Fatmata Kamara"
          />
        </div>

        <div className="responsive-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
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
              onChange={(e) => { setDob(e.target.value); if (!isEdit) setDuplicates(null); }}
              max={new Date().toISOString().slice(0, 10)}
            />
          </div>
        </div>

        {!isEdit && (
          <div>
            <Label>Facility</Label>
            <SelectInput value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </SelectInput>
          </div>
        )}

        <div>
          <Label>Address <span style={{ color: COLORS.muted, fontWeight: 400 }}>(optional)</span></Label>
          <TextInput value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. 12 Sandor Road, Koidu Town" />
        </div>

        <div className="responsive-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
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
            {checking ? "Checking…" : submitting ? "Saving…" : isEdit ? "Save changes" : duplicates && duplicates.length > 0 ? "Register anyway" : "Register child"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
