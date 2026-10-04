import React, { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { COLORS } from "../constants.js";
import { ErrorText, Label, PrimaryButton, SecondaryButton, SelectInput, TextInput } from "../components/ui.jsx";

// ---------------------------------------------------------------------------
// Cascading facility picker, scoped to the LOGGED-IN user's own access
// level — not an admin picking for someone else (see AdminPage's
// GeographyFields for that case). Each role starts fixed at its own
// assigned level and must choose all the way down to one Facility:
//   system_admin:          Country -> District -> Chiefdom -> Facility
//   national_user:         Country fixed -> District -> Chiefdom -> Facility
//   district_manager:      District fixed -> Chiefdom -> Facility
//   facility_supervisor:   Chiefdom fixed -> Facility
//   facility_focal_person / vaccinator / chw: their one facility, fixed —
//     no picker at all, since there's nothing else to choose from.
// ---------------------------------------------------------------------------
function FacilityPicker({ token, role, value, onChange }) {
  const isFixedFacility = role === "facility_focal_person" || role === "vaccinator" || role === "chw";
  const needsDistrictStep = role === "system_admin" || role === "national_user" || role === "district_manager";
  const needsChiefdomStep = role === "system_admin" || role === "national_user" || role === "district_manager" || role === "facility_supervisor";

  const [countries, setCountries] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [chiefdoms, setChiefdoms] = useState([]);
  const [facilities, setFacilities] = useState([]);
  const [fixedFacility, setFixedFacility] = useState(null);

  const [countryId, setCountryId] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [chiefdomId, setChiefdomId] = useState("");

  useEffect(() => {
    if (!isFixedFacility) return;
    api.listFacilities(token).then((list) => { if (list[0]) { setFixedFacility(list[0]); onChange(list[0].id); } }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFixedFacility, token]);

  useEffect(() => {
    if (isFixedFacility) return;
    if (role === "system_admin") {
      api.listCountries(token).then((list) => {
        setCountries(list);
        if (list.length === 1) setCountryId(list[0].id);
      }).catch(() => {});
    } else if (role === "national_user") {
      api.listCountries(token).then((list) => { if (list[0]) setCountryId(list[0].id); }).catch(() => {});
    }
  }, [isFixedFacility, role, token]);

  useEffect(() => {
    if (isFixedFacility) return;
    if (role === "district_manager") {
      api.listDistricts(token).then((list) => { if (list[0]) setDistrictId(list[0].id); }).catch(() => {});
    } else if (needsDistrictStep && countryId) {
      api.listDistricts(token, { countryId }).then(setDistricts).catch(() => {});
    }
  }, [isFixedFacility, needsDistrictStep, role, countryId, token]);

  useEffect(() => {
    if (isFixedFacility) return;
    setChiefdomId(""); setFacilities([]); onChange("");
    if (role === "facility_supervisor") {
      api.listChiefdoms(token).then((list) => { if (list[0]) setChiefdomId(list[0].id); }).catch(() => {});
    } else if (needsChiefdomStep && districtId) {
      api.listChiefdoms(token, { districtId }).then(setChiefdoms).catch(() => {});
    } else {
      setChiefdoms([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFixedFacility, needsChiefdomStep, role, districtId, token]);

  useEffect(() => {
    if (isFixedFacility || !chiefdomId) return;
    api.listFacilities(token, { chiefdomId }).then((list) => {
      setFacilities(list);
      if (list.length === 1) onChange(list[0].id);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFixedFacility, chiefdomId, token]);

  if (isFixedFacility) {
    return (
      <div>
        <Label>Facility</Label>
        <p style={{ fontSize: 14, color: COLORS.ink, padding: "10px 12px", borderRadius: 8, backgroundColor: COLORS.subtleBg, margin: 0 }}>
          {fixedFacility ? fixedFacility.name : "Loading…"}
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {role === "system_admin" && (
        <div>
          <Label>Country</Label>
          <SelectInput value={countryId} onChange={(e) => setCountryId(e.target.value)}>
            <option value="">Select a country…</option>
            {countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </SelectInput>
        </div>
      )}
      {needsDistrictStep && (role === "system_admin" ? countryId : true) && (
        <div>
          <Label>District</Label>
          <SelectInput value={districtId} onChange={(e) => setDistrictId(e.target.value)}>
            <option value="">Select a district…</option>
            {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </SelectInput>
        </div>
      )}
      {needsChiefdomStep && districtId && (
        <div>
          <Label>Chiefdom</Label>
          <SelectInput value={chiefdomId} onChange={(e) => setChiefdomId(e.target.value)}>
            <option value="">Select a chiefdom…</option>
            {chiefdoms.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </SelectInput>
        </div>
      )}
      {chiefdomId && (
        <div>
          <Label>Facility</Label>
          <SelectInput value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">Select a facility…</option>
            {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </SelectInput>
        </div>
      )}
    </div>
  );
}

/**
 * Shared form for both registering a new child and editing an existing
 * one — the fields are the same; only the submit action and a few UI
 * details (title, button label, whether duplicate-checking applies)
 * differ. Editing intentionally excludes facility (a transfer is its own
 * workflow, not a field edit — see the backend's update_child docstring)
 * and skips duplicate-checking (the child already exists; checking for
 * duplicates of an existing record doesn't make sense).
 */
export default function ChildForm({ token, currentUser, mode = "create", initialChild, onSaved, onCancel }) {
  const isEdit = mode === "edit";

  const [name, setName] = useState(initialChild?.full_name || "");
  const [sex, setSex] = useState(initialChild?.sex || "F");
  const [dob, setDob] = useState(initialChild?.dob || "");
  const [facilityId, setFacilityId] = useState(initialChild?.facility_id || "");
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
          <FacilityPicker token={token} role={currentUser.role} value={facilityId} onChange={setFacilityId} />
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
