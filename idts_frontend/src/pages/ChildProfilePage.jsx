import React, { useEffect, useState } from "react";
import { ChevronLeft, History, Syringe } from "lucide-react";
import { api } from "../api/client.js";
import { COLORS, ageLabel, fmtDate } from "../constants.js";
import { StatusBadge } from "../components/ui.jsx";
import VaccinationModal from "../components/VaccinationModal.jsx";

export default function ChildProfilePage({ token, childId, facilities, onBack }) {
  const [child, setChild] = useState(null);
  const [vaccinations, setVaccinations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalDose, setModalDose] = useState(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [childData, vaccData] = await Promise.all([
        api.getChild(token, childId),
        api.listVaccinations(token, childId),
      ]);
      setChild(childData);
      setVaccinations(vaccData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [childId]);

  if (loading) return <p style={{ textAlign: "center", color: COLORS.muted }}>Loading…</p>;
  if (error) return <p style={{ textAlign: "center", color: "#8C2E1C" }}>{error}</p>;
  if (!child) return null;

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: COLORS.primary, background: "none", border: "none", cursor: "pointer", marginBottom: 20, padding: 0 }}>
        <ChevronLeft size={16} /> All children
      </button>

      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 24, fontWeight: 600, color: COLORS.ink, margin: 0 }}>{child.full_name}</h2>
        <p style={{ fontSize: 14, color: COLORS.muted, marginTop: 4 }}>
          {ageLabel(child.dob)} · Born {fmtDate(child.dob)} · {child.sex === "F" ? "Female" : "Male"} · {child.system_id}
        </p>
        {child.caregiver_name && (
          <p style={{ fontSize: 14, color: COLORS.muted, marginTop: 4 }}>
            Caregiver: {child.caregiver_name}{child.caregiver_phone ? ` · ${child.caregiver_phone}` : ""}
          </p>
        )}
      </div>

      <h3 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "#6B6660", marginBottom: 12 }}>
        Immunization schedule
      </h3>
      <div style={{ borderRadius: 12, border: `1px solid ${COLORS.border}`, overflow: "hidden", marginBottom: 32 }}>
        {child.schedule.map((dose, i) => (
          <div
            key={dose.schedule_entry_id}
            style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, borderTop: i === 0 ? "none" : `1px solid ${COLORS.border}` }}
          >
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 15, fontWeight: 500, color: COLORS.ink, margin: 0 }}>
                {dose.antigen} <span style={{ color: COLORS.muted, fontWeight: 400 }}>· dose {dose.dose_number}</span>
              </p>
              <p style={{ fontSize: 14, color: COLORS.muted, marginTop: 2 }}>{dose.reason}</p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <StatusBadge status={dose.status} />
              {dose.status !== "administered" && dose.status !== "not_applicable" && (
                <button
                  onClick={() => setModalDose(dose)}
                  title="Record this vaccination"
                  style={{ padding: 8, borderRadius: 8, backgroundColor: COLORS.primary, border: "none", cursor: "pointer", display: "flex" }}
                >
                  <Syringe size={15} color="#fff" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "#6B6660", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
        <History size={14} /> Vaccination history
      </h3>
      {vaccinations.length === 0 ? (
        <p style={{ fontSize: 14, color: COLORS.muted }}>No vaccinations recorded yet.</p>
      ) : (
        <div style={{ borderRadius: 12, border: `1px solid ${COLORS.border}`, overflow: "hidden" }}>
          {vaccinations.map((v, i) => {
            const scheduleRow = child.schedule.find((d) => d.schedule_entry_id === v.schedule_entry_id);
            return (
              <div key={v.id} style={{ padding: "12px 16px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, borderTop: i === 0 ? "none" : `1px solid ${COLORS.border}` }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 15, fontWeight: 500, color: COLORS.ink, margin: 0 }}>
                    {scheduleRow ? `${scheduleRow.antigen} · dose ${scheduleRow.dose_number}` : v.schedule_entry_id}
                  </p>
                  <p style={{ fontSize: 14, color: COLORS.muted, marginTop: 2 }}>
                    {v.session_type}{v.batch_lot_number ? ` · Batch ${v.batch_lot_number}` : ""}
                  </p>
                  {v.notes && <p style={{ fontSize: 14, color: COLORS.muted, marginTop: 2, fontStyle: "italic" }}>{v.notes}</p>}
                </div>
                <p style={{ fontSize: 14, color: COLORS.muted, flexShrink: 0 }}>{fmtDate(v.event_date)}</p>
              </div>
            );
          })}
        </div>
      )}

      <p style={{ fontSize: 12, color: COLORS.muted, marginTop: 20, lineHeight: 1.6 }}>
        Schedule shown is a synthetic example structured on Sierra Leone's typical EPI programme —
        not yet verified against the official national schedule.
      </p>

      {modalDose && (
        <VaccinationModal
          token={token}
          child={child}
          dose={modalDose}
          facilities={facilities}
          onSaved={() => { setModalDose(null); load(); }}
          onClose={() => setModalDose(null)}
        />
      )}
    </div>
  );
}
