import React, { useMemo } from "react";
import { Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { COLORS, STATUS_META } from "../constants.js";

const STATUS_ORDER = ["not_yet_due", "due_soon", "due", "overdue", "defaulter", "administered", "not_applicable"];

function SummaryCard({ label, value, color }) {
  return (
    <div style={{ borderRadius: 12, border: `1px solid ${COLORS.border}`, padding: "14px 16px", backgroundColor: COLORS.white }}>
      <p style={{ fontSize: 24, fontWeight: 600, margin: 0, color: color || COLORS.ink }}>{value}</p>
      <p style={{ fontSize: 14, color: COLORS.muted, marginTop: 2 }}>{label}</p>
    </div>
  );
}

export default function DashboardPage({ children, dueRows, allCases, loading }) {
  const stats = useMemo(() => {
    const counts = { not_yet_due: 0, due_soon: 0, due: 0, overdue: 0, defaulter: 0, administered: 0, not_applicable: 0 };
    // dueRows only covers "needs attention" doses (not_yet_due/administered/not_applicable
    // aren't included by the backend's due-list, by design — it's a worklist, not a full
    // census). So the chart here reflects what needs attention, which is what a health
    // worker actually cares about; a full per-dose breakdown would need a dedicated
    // aggregate endpoint, noted as a nice-to-have for a later milestone.
    dueRows.forEach((r) => { counts[r.dose.status] = (counts[r.dose.status] || 0) + 1; });

    const childrenNeedingAttention = new Set(dueRows.map((r) => r.child.id)).size;
    const defaulterDoseCount = counts.defaulter;

    const activeCases = allCases.filter((c) => c.status !== "closed");
    const inTracing = activeCases.filter((c) => c.status === "assigned" || c.status === "in_tracing").length;
    const pendingConfirmation = activeCases.filter((c) => c.status === "return_pending_confirmation").length;
    const returned = allCases.filter(
      (c) => c.status === "closed" && (c.closure_reason === "vaccinated_returned" || c.closure_reason === "vaccinated_elsewhere")
    ).length;

    const chartData = STATUS_ORDER.filter((s) => counts[s] > 0).map((s) => ({
      status: s,
      label: STATUS_META[s].label,
      count: counts[s],
    }));

    return { registered: children.length, childrenNeedingAttention, defaulterDoseCount, inTracing, pendingConfirmation, returned, chartData };
  }, [children, dueRows, allCases]);

  if (loading) return <p style={{ textAlign: "center", color: COLORS.muted }}>Loading…</p>;

  if (children.length === 0) {
    return (
      <div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center", padding: "64px 0", borderRadius: 12, border: `1px solid ${COLORS.border}` }}>
        <Users size={28} style={{ color: "#B8B2A5", margin: "0 auto" }} />
        <p style={{ marginTop: 12, fontWeight: 500, color: COLORS.ink }}>Nothing to show yet</p>
        <p style={{ fontSize: 14, color: COLORS.muted, marginTop: 4 }}>Register a few children to see the dashboard fill in.</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 24 }}>
        <SummaryCard label="Children registered" value={stats.registered} />
        <SummaryCard label="Need attention (due+)" value={stats.childrenNeedingAttention} color="#B4472F" />
        <SummaryCard label="Defaulter doses" value={stats.defaulterDoseCount} color="#8C2E1C" />
        <SummaryCard label="Cases in tracing" value={stats.inTracing} color="#8A6A1F" />
        <SummaryCard label="Pending return confirmation" value={stats.pendingConfirmation} color="#2F6B4F" />
        <SummaryCard label="Returned to service" value={stats.returned} color="#2F6B4F" />
      </div>

      <h3 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "#6B6660", marginBottom: 12 }}>
        Doses needing attention, by status
      </h3>
      <div style={{ borderRadius: 12, border: `1px solid ${COLORS.border}`, padding: 16, backgroundColor: COLORS.white }}>
        {stats.chartData.length === 0 ? (
          <p style={{ fontSize: 14, color: COLORS.muted, textAlign: "center", padding: "20px 0" }}>
            Nothing due, overdue, or defaulting right now.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={stats.chartData} margin={{ top: 8, right: 12, left: -12, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6B6660" }} interval={0} angle={-20} textAnchor="end" height={55} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#6B6660" }} />
              <Tooltip cursor={{ fill: COLORS.subtleBg }} contentStyle={{ borderRadius: 8, borderColor: COLORS.border, fontSize: 13 }} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {stats.chartData.map((d) => <Cell key={d.status} fill={STATUS_META[d.status].color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
