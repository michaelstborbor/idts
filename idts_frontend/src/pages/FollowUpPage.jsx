import React from "react";
import { CheckCircle2 } from "lucide-react";
import { CASE_STATUS_META, COLORS, PRIORITY_META } from "../constants.js";

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

export default function FollowUpPage({ cases, childrenById, loading, onOpenCase }) {
  if (loading) return <p style={{ textAlign: "center", color: COLORS.muted }}>Loading…</p>;

  const sorted = [...cases].sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3));

  if (sorted.length === 0) {
    return (
      <div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center", padding: "64px 0", borderRadius: 12, border: `1px solid ${COLORS.border}` }}>
        <CheckCircle2 size={28} style={{ color: "#B8B2A5", margin: "0 auto" }} />
        <p style={{ marginTop: 12, fontWeight: 500, color: COLORS.ink }}>No active follow-up cases</p>
        <p style={{ fontSize: 14, color: COLORS.muted, marginTop: 4 }}>
          Assign a defaulter from the "Due &amp; defaulters" tab to start tracing them.
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", borderRadius: 12, border: `1px solid ${COLORS.border}`, overflow: "hidden", backgroundColor: COLORS.white }}>
      {sorted.map((c, i) => {
        const child = childrenById[c.child_id];
        const meta = CASE_STATUS_META[c.status];
        return (
          <button
            key={c.id}
            onClick={() => child && onOpenCase(child, c)}
            style={{
              width: "100%", textAlign: "left", padding: "14px 16px", display: "flex", alignItems: "center",
              justifyContent: "space-between", gap: 12, background: "none", border: "none", cursor: "pointer",
              borderTop: i === 0 ? "none" : `1px solid ${COLORS.border}`,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <p style={{ fontWeight: 500, fontSize: 15, color: COLORS.ink, margin: 0 }}>
                {child ? child.full_name : "Unknown child"}
              </p>
              <p style={{ fontSize: 14, color: COLORS.muted, marginTop: 2 }}>{c.reason}</p>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
              <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 999, fontWeight: 500, color: meta.color, backgroundColor: meta.bg }}>
                {meta.label}
              </span>
              <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 999, fontWeight: 500, color: PRIORITY_META[c.priority].color, backgroundColor: PRIORITY_META[c.priority].bg }}>
                {PRIORITY_META[c.priority].label}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
