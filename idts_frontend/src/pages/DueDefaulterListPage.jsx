import React, { useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { COLORS, PRIORITY_META } from "../constants.js";
import { StatusBadge } from "../components/ui.jsx";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "defaulter", label: "Defaulters" },
  { value: "overdue", label: "Overdue" },
  { value: "due", label: "Due" },
  { value: "due_soon", label: "Due soon" },
];

export default function DueDefaulterListPage({ dueRows, activeCasesByKey, loading, onOpenChild, onAssign, onOpenCase }) {
  const [statusFilter, setStatusFilter] = useState("all");

  const counts = useMemo(() => {
    const c = { defaulter: 0, overdue: 0, due: 0, due_soon: 0 };
    dueRows.forEach((r) => { c[r.dose.status] = (c[r.dose.status] || 0) + 1; });
    return c;
  }, [dueRows]);

  const rows = statusFilter === "all" ? dueRows : dueRows.filter((r) => r.dose.status === statusFilter);

  if (loading) return <p style={{ textAlign: "center", color: COLORS.muted }}>Loading…</p>;

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {FILTERS.map((t) => (
          <button
            key={t.value}
            onClick={() => setStatusFilter(t.value)}
            style={{
              padding: "6px 12px", borderRadius: 999, fontSize: 14, fontWeight: 500, cursor: "pointer",
              border: `1px solid ${statusFilter === t.value ? COLORS.primary : COLORS.inputBorder}`,
              backgroundColor: statusFilter === t.value ? COLORS.primary : COLORS.white,
              color: statusFilter === t.value ? COLORS.white : COLORS.ink,
            }}
          >
            {t.label} <span style={{ opacity: 0.75 }}>({t.value === "all" ? dueRows.length : counts[t.value] || 0})</span>
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div style={{ textAlign: "center", padding: "64px 0", borderRadius: 12, border: `1px solid ${COLORS.border}` }}>
          <CheckCircle2 size={28} style={{ color: "#B8B2A5", margin: "0 auto" }} />
          <p style={{ marginTop: 12, fontWeight: 500, color: COLORS.ink }}>Nothing matches this filter</p>
          <p style={{ fontSize: 14, color: COLORS.muted, marginTop: 4 }}>
            {dueRows.length === 0 ? "No children are currently due, overdue, or defaulters." : "Try a different filter."}
          </p>
        </div>
      ) : (
        <div style={{ borderRadius: 12, border: `1px solid ${COLORS.border}`, overflow: "hidden", backgroundColor: COLORS.white }}>
          {rows.map((r, i) => {
            const key = `${r.child.id}:${r.dose.schedule_entry_id}`;
            const activeCase = r.dose.status === "defaulter" ? activeCasesByKey[key] : null;
            return (
              <div
                key={key}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 16px", borderTop: i === 0 ? "none" : `1px solid ${COLORS.border}` }}
              >
                <button
                  onClick={() => onOpenChild(r.child.id)}
                  style={{ minWidth: 0, textAlign: "left", flex: 1, background: "none", border: "none", cursor: "pointer", padding: 0 }}
                >
                  <p style={{ fontWeight: 500, fontSize: 15, color: COLORS.ink, margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.child.full_name}
                  </p>
                  <p style={{ fontSize: 14, color: COLORS.muted, marginTop: 2 }}>
                    {r.dose.antigen} dose {r.dose.dose_number}
                  </p>
                  <p style={{ fontSize: 14, color: COLORS.muted, marginTop: 2 }}>{r.dose.reason}</p>
                </button>
                <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                  <StatusBadge status={r.dose.status} />
                  {r.priority && (
                    <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 999, fontWeight: 500, color: PRIORITY_META[r.priority].color, backgroundColor: PRIORITY_META[r.priority].bg }}>
                      {PRIORITY_META[r.priority].label}
                    </span>
                  )}
                  {r.dose.status === "defaulter" && (
                    activeCase ? (
                      <button
                        onClick={() => onOpenCase(r.child, activeCase)}
                        style={{
                          fontSize: 12, padding: "3px 10px", borderRadius: 999, fontWeight: 500, textDecoration: "underline",
                          border: "none", cursor: "pointer",
                          color: "#8A6A1F", backgroundColor: "#FBF1DC",
                        }}
                      >
                        View case
                      </button>
                    ) : (
                      <button
                        onClick={() => onAssign(r.child, r.dose, r.priority)}
                        style={{ fontSize: 12, padding: "4px 12px", borderRadius: 999, fontWeight: 500, color: "#fff", backgroundColor: COLORS.primary, border: "none", cursor: "pointer" }}
                      >
                        Assign
                      </button>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p style={{ fontSize: 12, color: COLORS.muted, marginTop: 20, lineHeight: 1.6 }}>
        Priority on defaulter cases is a transparent, weighted score (days overdue + number of
        missed doses) computed by the backend — not a black-box prediction.
      </p>
    </div>
  );
}
