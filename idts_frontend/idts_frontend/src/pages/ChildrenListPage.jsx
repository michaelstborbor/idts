import React from "react";
import { Users } from "lucide-react";
import { COLORS, ageLabel } from "../constants.js";
import { StatusBadge } from "../components/ui.jsx";

export default function ChildrenListPage({ children, dueRowsByChildId, loading, onOpenChild, onRegisterClick }) {
  if (loading) return <p style={{ textAlign: "center", color: COLORS.muted }}>Loading…</p>;

  if (children.length === 0) {
    return (
      <div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center", padding: "64px 0", borderRadius: 12, border: `1px solid ${COLORS.border}` }}>
        <Users size={28} style={{ color: "#B8B2A5", margin: "0 auto" }} />
        <p style={{ marginTop: 12, fontWeight: 500, color: COLORS.ink }}>No children registered yet</p>
        <p style={{ fontSize: 14, color: COLORS.muted, marginTop: 4, marginBottom: 20 }}>
          Register the first child to see auto-calculated due dates.
        </p>
        <button
          onClick={onRegisterClick}
          style={{ padding: "10px 16px", borderRadius: 8, fontSize: 14, fontWeight: 500, color: "#fff", backgroundColor: COLORS.primary, border: "none", cursor: "pointer" }}
        >
          Register a child
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", borderRadius: 12, border: `1px solid ${COLORS.border}`, overflow: "hidden", backgroundColor: COLORS.white }}>
      {children.map((c, i) => {
        const next = dueRowsByChildId ? dueRowsByChildId[c.id] : null;
        return (
          <button
            key={c.id}
            onClick={() => onOpenChild(c.id)}
            style={{
              width: "100%", textAlign: "left", padding: "14px 16px", display: "flex", alignItems: "center",
              justifyContent: "space-between", gap: 12, background: "none", border: "none", cursor: "pointer",
              borderTop: i === 0 ? "none" : `1px solid ${COLORS.border}`,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <p style={{ fontWeight: 500, fontSize: 15, color: COLORS.ink, margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.full_name}</p>
              <p style={{ fontSize: 14, color: COLORS.muted, marginTop: 2 }}>{ageLabel(c.dob)} · {c.system_id}</p>
            </div>
            {next && (
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <StatusBadge status={next.dose.status} />
                <p style={{ fontSize: 12, color: COLORS.muted, marginTop: 4 }}>{next.dose.antigen} dose {next.dose.dose_number}</p>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
