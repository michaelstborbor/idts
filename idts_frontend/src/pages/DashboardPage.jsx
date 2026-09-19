import React, { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client.js";
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

export default function DashboardPage({ token, childrenCount }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api.getDashboardStats(token)
      .then((data) => { if (!cancelled) setStats(data); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, childrenCount]);

  if (loading) return <p style={{ textAlign: "center", color: COLORS.muted }}>Loading…</p>;
  if (error) return <p style={{ textAlign: "center", color: "#8C2E1C" }}>{error}</p>;

  if (childrenCount === 0 || !stats) {
    return (
      <div style={{ maxWidth: 640, margin: "0 auto", textAlign: "center", padding: "64px 0", borderRadius: 12, border: `1px solid ${COLORS.border}` }}>
        <Users size={28} style={{ color: "#B8B2A5", margin: "0 auto" }} />
        <p style={{ marginTop: 12, fontWeight: 500, color: COLORS.ink }}>Nothing to show yet</p>
        <p style={{ fontSize: 14, color: COLORS.muted, marginTop: 4 }}>Register a few children to see the dashboard fill in.</p>
      </div>
    );
  }

  const chartData = STATUS_ORDER.filter((s) => stats.dose_status_counts[s] > 0).map((s) => ({
    status: s,
    label: STATUS_META[s].label,
    count: stats.dose_status_counts[s],
  }));

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 24 }}>
        <SummaryCard label="Children registered" value={stats.registered} />
        <SummaryCard label="Fully immunized (for age)" value={stats.fully_immunized} color="#2F6B4F" />
        <SummaryCard label="Need attention" value={stats.needs_attention_children} color="#B4472F" />
        <SummaryCard label="Doses given" value={stats.given_total} color="#2F6B4F" />
        <SummaryCard label="Cases in tracing" value={stats.cases_in_tracing} color="#8A6A1F" />
        <SummaryCard label="Pending return confirmation" value={stats.cases_pending_confirmation} color="#8A6A1F" />
      </div>

      <h3 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "#6B6660", marginBottom: 12 }}>
        All scheduled doses, by status
      </h3>
      <div style={{ borderRadius: 12, border: `1px solid ${COLORS.border}`, padding: 16, backgroundColor: COLORS.white }}>
        {chartData.length === 0 ? (
          <p style={{ fontSize: 14, color: COLORS.muted, textAlign: "center", padding: "20px 0" }}>No data yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ top: 8, right: 12, left: -12, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6B6660" }} interval={0} angle={-20} textAnchor="end" height={55} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#6B6660" }} />
              <Tooltip cursor={{ fill: COLORS.subtleBg }} contentStyle={{ borderRadius: 8, borderColor: COLORS.border, fontSize: 13 }} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {chartData.map((d) => <Cell key={d.status} fill={STATUS_META[d.status].color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      <p style={{ fontSize: 12, color: COLORS.muted, marginTop: 12, lineHeight: 1.6 }}>
        "Fully immunized (for age)" means everything a child is currently old enough to need has
        been given — it updates automatically as they age into new doses, it isn't a one-time
        finish line.
      </p>
    </div>
  );
}
