import React, { useEffect, useState } from "react";
import { ShieldCheck, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client.js";
import { COLORS, CONTENT_MAX_WIDTH, STATUS_META } from "../constants.js";

const STATUS_ORDER = ["not_yet_due", "due_soon", "due", "overdue", "defaulter", "administered", "not_applicable"];

function SummaryCard({ label, value, color }) {
  return (
    <div style={{ borderRadius: 14, border: `1px solid ${COLORS.border}`, borderLeft: `6px solid ${color || COLORS.primary}`, padding: "16px 18px", backgroundColor: COLORS.white }}>
      <p style={{ fontSize: 34, fontWeight: 700, margin: 0, lineHeight: 1.1, color: color || COLORS.ink, fontVariantNumeric: "tabular-nums" }}>{value}</p>
      <p style={{ fontSize: 16, fontWeight: 600, color: COLORS.muted, margin: "6px 0 0" }}>{label}</p>
    </div>
  );
}

// Visually distinct from the plain white stat cards — a filled badge with
// a shield icon, specifically so "Fully Immunized (FIC)" stands out at a
// glance rather than reading as just another number among several.
function FullyImmunizedCard({ value }) {
  return (
    <div className="stat-feature" style={{ borderRadius: 14, padding: "16px 18px", backgroundColor: COLORS.protect, display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 999, padding: 10, display: "flex", flexShrink: 0 }}>
        <ShieldCheck size={28} color="#FFFFFF" />
      </div>
      <div>
        <p style={{ fontSize: 34, fontWeight: 700, margin: 0, lineHeight: 1.1, color: "#FFFFFF", fontVariantNumeric: "tabular-nums" }}>{value}</p>
        <p style={{ fontSize: 16, fontWeight: 600, color: "#E9F8EF", margin: "6px 0 0" }}>Fully immunized children (FIC)</p>
      </div>
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
  if (error) return <p style={{ textAlign: "center", color: "#A1131B" }}>{error}</p>;

  if (childrenCount === 0 || !stats) {
    return (
      <div style={{ maxWidth: CONTENT_MAX_WIDTH, margin: "0 auto", textAlign: "center", padding: "64px 0", borderRadius: 12, border: `1px solid ${COLORS.border}` }}>
        <Users size={28} style={{ color: "#8FA3B1", margin: "0 auto" }} />
        <p style={{ marginTop: 12, fontWeight: 600, color: COLORS.ink }}>Nothing to show yet</p>
        <p style={{ fontSize: 16, color: COLORS.muted, marginTop: 4 }}>Register a few children to see the dashboard fill in.</p>
      </div>
    );
  }

  const chartData = [
    ...STATUS_ORDER.filter((s) => stats.dose_status_counts[s] > 0).map((s) => ({
      status: s,
      label: STATUS_META[s].label,
      count: stats.dose_status_counts[s],
    })),
    { status: "fully_immunized", label: "Fully immunized (FIC)", count: stats.fully_immunized },
  ];

  const aefiBySeverity = stats.aefi_by_severity || { mild: 0, moderate: 0, severe: 0 };
  const aefiChartData = [
    { key: "mild", label: "Mild", count: aefiBySeverity.mild || 0, color: "#10633B" },
    { key: "moderate", label: "Moderate", count: aefiBySeverity.moderate || 0, color: "#D08A00" },
    { key: "severe", label: "Severe", count: aefiBySeverity.severe || 0, color: "#A33A06" },
  ];

  return (
    <div style={{ maxWidth: CONTENT_MAX_WIDTH, margin: "0 auto" }}>
      {stats.scope_label && (
        <p style={{ fontSize: 15, color: COLORS.muted, margin: "0 0 12px" }}>
          Showing data for: <strong style={{ color: COLORS.ink }}>{stats.scope_label}</strong>
        </p>
      )}
      <div className="stat-grid" style={{ marginBottom: 32 }}>
        <FullyImmunizedCard value={stats.fully_immunized} />
        <SummaryCard label="Children registered" value={stats.registered} color={COLORS.primary} />
        <SummaryCard label="Need attention now" value={stats.needs_attention_children} color="#A33A06" />
        <SummaryCard label="Doses given" value={stats.given_total} color="#10633B" />
        <SummaryCard label="Cases in tracing" value={stats.cases_in_tracing} color="#7A4D00" />
        <SummaryCard label="Pending return confirmation" value={stats.cases_pending_confirmation} color="#7A4D00" />
      </div>

      <h3 style={{ fontSize: 18, fontWeight: 700, color: "#10222E", marginBottom: 12 }}>
        All scheduled doses, by status (Fully immunized = number of children)
      </h3>
      <div style={{ borderRadius: 14, border: `1px solid ${COLORS.border}`, padding: 16, backgroundColor: COLORS.white }}>
        {chartData.length === 0 ? (
          <p style={{ fontSize: 16, color: COLORS.muted, textAlign: "center", padding: "20px 0" }}>No data yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ top: 8, right: 12, left: -12, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 13, fill: "#3E5160" }} interval={0} angle={-20} textAnchor="end" height={70} />
              <YAxis allowDecimals={false} tick={{ fontSize: 13, fill: "#3E5160" }} />
              <Tooltip cursor={{ fill: COLORS.subtleBg }} contentStyle={{ borderRadius: 8, borderColor: COLORS.border, fontSize: 15 }} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {chartData.map((d) => <Cell key={d.status} fill={d.status === "fully_immunized" ? "#0B4A2B" : STATUS_META[d.status].chart} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      <p style={{ fontSize: 15, color: COLORS.muted, marginTop: 12, lineHeight: 1.6, maxWidth: 820 }}>
        <strong>Fully Immunized (FIC)</strong> means a child has actually received every dose in
        the schedule up to and including Measles-Rubella dose 2 (MR2), per Ministry protocol — not
        merely that nothing is currently due for their age. A young infant correctly cannot be FIC
        yet even if nothing of theirs is overdue; "Need attention now" (age-relative) is a separate,
        operational measure for who needs a visit soon.
      </p>

      <h3 style={{ fontSize: 18, fontWeight: 700, color: "#10222E", margin: "32px 0 12px" }}>
        Adverse events following immunization (AEFI)
      </h3>
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <SummaryCard label="AEFI recorded" value={stats.aefi_total ?? 0} color={COLORS.primary} />
        <SummaryCard label="Serious AEFI" value={stats.aefi_serious ?? 0} color="#A33A06" />
        <SummaryCard label="Serious, report not yet sent" value={stats.aefi_serious_awaiting_report ?? 0} color={(stats.aefi_serious_awaiting_report ?? 0) > 0 ? "#A33A06" : "#10633B"} />
      </div>
      <div style={{ borderRadius: 14, border: `1px solid ${COLORS.border}`, padding: 16, backgroundColor: COLORS.white }}>
        {(stats.aefi_total ?? 0) === 0 ? (
          <p style={{ fontSize: 16, color: COLORS.muted, textAlign: "center", padding: "20px 0", margin: 0 }}>No adverse events recorded yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={aefiChartData} margin={{ top: 8, right: 12, left: -12, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 14, fill: "#3E5160" }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 13, fill: "#3E5160" }} />
              <Tooltip cursor={{ fill: COLORS.subtleBg }} contentStyle={{ borderRadius: 8, borderColor: COLORS.border, fontSize: 15 }} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {aefiChartData.map((d) => <Cell key={d.key} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      <p style={{ fontSize: 15, color: COLORS.muted, marginTop: 12, lineHeight: 1.6, maxWidth: 820 }}>
        Mild / moderate / severe describes how intense an event was. <strong>Serious</strong> is a separate
        WHO measure based on outcome (death, life-threatening, hospitalization, disability…) — serious events
        must be reported within 24 hours.
      </p>
    </div>
  );
}
