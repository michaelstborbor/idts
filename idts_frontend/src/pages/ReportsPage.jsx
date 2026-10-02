import React, { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { api } from "../api/client.js";
import { COLORS, SESSION_TYPES, todayIso } from "../constants.js";
import { ErrorText, Label, PrimaryButton, TextInput } from "../components/ui.jsx";

function sessionLabel(value) {
  return SESSION_TYPES.find((s) => s.value === value)?.label || value;
}

function toCsv(rows, startDate, endDate) {
  const header = "Antigen,Session Type,Doses Given\n";
  const body = rows.map((r) => `"${r.antigen}","${sessionLabel(r.session_type)}",${r.count}`).join("\n");
  const meta = `Report period,${startDate || "all time"} to ${endDate || "present"}\n\n`;
  return meta + header + body + "\n";
}

function downloadCsv(csvText, filename) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const GROUP_LABELS = {
  facility: "By facility",
  user: "By user",
  chiefdom: "By chiefdom",
  district: "By district",
  country: "By country",
};

function aggregateToCsv(report) {
  const isUser = report.group_by === "user";
  const header = isUser
    ? "Name,Details,Doses recorded,Tracing attempts,Cases assigned"
    : "Name,Details,Children registered,Fully immunized (FIC),Need attention,Doses given,Open cases,Cases returned";
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const line = (r) =>
    isUser
      ? [q(r.label), q(r.sublabel), r.doses_given, r.tracing_attempts ?? 0, r.cases_assigned ?? 0].join(",")
      : [q(r.label), q(r.sublabel), r.registered ?? 0, r.fully_immunized ?? 0, r.needs_attention ?? 0, r.doses_given, r.cases_open ?? 0, r.cases_returned ?? 0].join(",");
  const meta = `Scope,${q(report.scope_label)}\nBreakdown,${report.group_by}\nPeriod,${report.start_date || "all time"} to ${report.end_date || "present"}\n\n`;
  return meta + header + "\n" + [...report.rows, report.totals].map(line).join("\n") + "\n";
}

function AggregateSection({ token, startDate, endDate }) {
  const [scope, setScope] = useState(null);
  const [groupBy, setGroupBy] = useState("facility");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getReportScope(token)
      .then((info) => {
        setScope(info);
        if (!info.allowed_group_by.includes("facility")) setGroupBy(info.allowed_group_by[0]);
      })
      .catch((err) => setError(err.message));
  }, [token]);

  async function run() {
    if (startDate && endDate && startDate > endDate) return setError("Start date can't be after end date.");
    setError("");
    setLoading(true);
    try {
      setReport(await api.getAggregateReport(token, { groupBy, startDate: startDate || undefined, endDate: endDate || undefined }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!scope) return error ? <ErrorText>{error}</ErrorText> : null;

  const isUser = groupBy === "user";
  const th = { textAlign: "right", padding: "10px 14px", color: COLORS.ink, fontWeight: 600, borderBottom: `1px solid ${COLORS.border}`, whiteSpace: "nowrap" };
  const td = { padding: "10px 14px", textAlign: "right", color: COLORS.muted };
  const tdTotal = { ...td, color: COLORS.ink };

  return (
    <div style={{ marginTop: 32 }}>
      <h3 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "#6B6660", marginBottom: 12 }}>
        Aggregate report
      </h3>
      <div style={{ borderRadius: 12, border: `1px solid ${COLORS.border}`, padding: 20, backgroundColor: COLORS.white, marginBottom: 20 }}>
        <p style={{ fontSize: 13, color: COLORS.muted, margin: "0 0 12px" }}>
          Showing data for: <strong style={{ color: COLORS.ink }}>{scope.scope_label}</strong>. Uses the dates above for doses and tracing activity; child counts are as of today.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {scope.allowed_group_by.map((g) => (
            <button
              key={g}
              onClick={() => { setGroupBy(g); setReport(null); }}
              style={{
                padding: "6px 14px", borderRadius: 999, fontSize: 14, fontWeight: 500, cursor: "pointer",
                border: `1px solid ${groupBy === g ? COLORS.primary : COLORS.inputBorder}`,
                backgroundColor: groupBy === g ? COLORS.primary : COLORS.white,
                color: groupBy === g ? "#fff" : COLORS.ink,
              }}
            >
              {GROUP_LABELS[g] || g}
            </button>
          ))}
        </div>
        <ErrorText>{error}</ErrorText>
        <div style={{ display: "flex", gap: 12, marginTop: error ? 12 : 0 }}>
          <PrimaryButton onClick={run} disabled={loading}>{loading ? "Running…" : "Run aggregate report"}</PrimaryButton>
          {report && (
            <button
              onClick={() => downloadCsv(aggregateToCsv(report), `idts-aggregate-${report.group_by}-${todayIso()}.csv`)}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 8, fontSize: 14, fontWeight: 500, color: COLORS.ink, backgroundColor: COLORS.white, border: `1px solid ${COLORS.inputBorder}`, cursor: "pointer" }}
            >
              <Download size={15} /> Download CSV
            </button>
          )}
        </div>
      </div>

      {report && (
        report.rows.length === 0 ? (
          <p style={{ textAlign: "center", color: COLORS.muted }}>No data for this breakdown.</p>
        ) : (
          <div style={{ borderRadius: 12, border: `1px solid ${COLORS.border}`, overflow: "auto", backgroundColor: COLORS.white }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ backgroundColor: COLORS.subtleBg }}>
                  <th style={{ ...th, textAlign: "left" }}>{(GROUP_LABELS[report.group_by] || "By name").replace("By ", "")}</th>
                  {isUser ? (
                    <>
                      <th style={th}>Doses recorded</th>
                      <th style={th}>Tracing attempts</th>
                      <th style={th}>Cases assigned</th>
                    </>
                  ) : (
                    <>
                      <th style={th}>Children</th>
                      <th style={th}>Fully immunized</th>
                      <th style={th}>Need attention</th>
                      <th style={th}>Doses given</th>
                      <th style={th}>Open cases</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r, i) => (
                  <tr key={r.key} style={{ borderTop: i === 0 ? "none" : `1px solid ${COLORS.border}` }}>
                    <td style={{ padding: "10px 14px", color: COLORS.ink, textAlign: "left" }}>
                      {r.label}
                      {r.sublabel && <div style={{ fontSize: 12, color: COLORS.muted }}>{r.sublabel}</div>}
                    </td>
                    {isUser ? (
                      <>
                        <td style={td}>{r.doses_given}</td>
                        <td style={td}>{r.tracing_attempts ?? 0}</td>
                        <td style={td}>{r.cases_assigned ?? 0}</td>
                      </>
                    ) : (
                      <>
                        <td style={td}>{r.registered ?? 0}</td>
                        <td style={td}>{r.fully_immunized ?? 0}</td>
                        <td style={td}>{r.needs_attention ?? 0}</td>
                        <td style={td}>{r.doses_given}</td>
                        <td style={td}>{r.cases_open ?? 0}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: `1px solid ${COLORS.border}`, backgroundColor: COLORS.subtleBg, fontWeight: 600 }}>
                  <td style={{ padding: "10px 14px", color: COLORS.ink, textAlign: "left" }}>Total</td>
                  {isUser ? (
                    <>
                      <td style={tdTotal}>{report.totals.doses_given}</td>
                      <td style={tdTotal}>{report.totals.tracing_attempts ?? 0}</td>
                      <td style={tdTotal}>{report.totals.cases_assigned ?? 0}</td>
                    </>
                  ) : (
                    <>
                      <td style={tdTotal}>{report.totals.registered ?? 0}</td>
                      <td style={tdTotal}>{report.totals.fully_immunized ?? 0}</td>
                      <td style={tdTotal}>{report.totals.needs_attention ?? 0}</td>
                      <td style={tdTotal}>{report.totals.doses_given}</td>
                      <td style={tdTotal}>{report.totals.cases_open ?? 0}</td>
                    </>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>
        )
      )}
    </div>
  );
}

export default function ReportsPage({ token }) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function runReport() {
    if (startDate && endDate && startDate > endDate) {
      return setError("Start date can't be after end date.");
    }
    setError("");
    setLoading(true);
    try {
      const data = await api.getVaccinationsSummary(token, { startDate: startDate || undefined, endDate: endDate || undefined });
      setReport(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleDownload() {
    if (!report) return;
    const csv = toCsv(report.rows, report.start_date, report.end_date);
    const stamp = todayIso();
    downloadCsv(csv, `idts-vaccinations-summary-${stamp}.csv`);
  }

  // Pivot rows into an antigen x session-type table for easier on-screen reading
  const sessionTypeValues = SESSION_TYPES.map((s) => s.value);
  const antigens = report ? Array.from(new Set(report.rows.map((r) => r.antigen))).sort() : [];
  const countFor = (antigen, sessionType) =>
    report?.rows.find((r) => r.antigen === antigen && r.session_type === sessionType)?.count || 0;

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <div style={{ borderRadius: 12, border: `1px solid ${COLORS.border}`, padding: 20, backgroundColor: COLORS.white, marginBottom: 20 }}>
        <div className="responsive-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <div>
            <Label>Start date <span style={{ color: COLORS.muted, fontWeight: 400 }}>(optional)</span></Label>
            <TextInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} max={todayIso()} />
          </div>
          <div>
            <Label>End date <span style={{ color: COLORS.muted, fontWeight: 400 }}>(optional)</span></Label>
            <TextInput type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} max={todayIso()} />
          </div>
        </div>
        <ErrorText>{error}</ErrorText>
        <div style={{ display: "flex", gap: 12, marginTop: error ? 12 : 0 }}>
          <PrimaryButton onClick={runReport} disabled={loading}>
            {loading ? "Running…" : "Run report"}
          </PrimaryButton>
          {report && (
            <button
              onClick={handleDownload}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 8, fontSize: 14, fontWeight: 500, color: COLORS.ink, backgroundColor: COLORS.white, border: `1px solid ${COLORS.inputBorder}`, cursor: "pointer" }}
            >
              <Download size={15} /> Download CSV
            </button>
          )}
        </div>
      </div>

      {report && (
        report.rows.length === 0 ? (
          <p style={{ textAlign: "center", color: COLORS.muted }}>No vaccinations recorded in this period.</p>
        ) : (
          <div style={{ borderRadius: 12, border: `1px solid ${COLORS.border}`, overflow: "auto", backgroundColor: COLORS.white }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ backgroundColor: COLORS.subtleBg }}>
                  <th style={{ textAlign: "left", padding: "10px 14px", color: COLORS.ink, fontWeight: 600, borderBottom: `1px solid ${COLORS.border}` }}>Antigen</th>
                  {sessionTypeValues.map((sv) => (
                    <th key={sv} style={{ textAlign: "right", padding: "10px 14px", color: COLORS.ink, fontWeight: 600, borderBottom: `1px solid ${COLORS.border}` }}>
                      {sessionLabel(sv)}
                    </th>
                  ))}
                  <th style={{ textAlign: "right", padding: "10px 14px", color: COLORS.ink, fontWeight: 600, borderBottom: `1px solid ${COLORS.border}` }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {antigens.map((antigen, i) => {
                  const rowTotal = sessionTypeValues.reduce((sum, sv) => sum + countFor(antigen, sv), 0);
                  return (
                    <tr key={antigen} style={{ borderTop: i === 0 ? "none" : `1px solid ${COLORS.border}` }}>
                      <td style={{ padding: "10px 14px", color: COLORS.ink }}>{antigen}</td>
                      {sessionTypeValues.map((sv) => (
                        <td key={sv} style={{ padding: "10px 14px", textAlign: "right", color: COLORS.muted }}>{countFor(antigen, sv)}</td>
                      ))}
                      <td style={{ padding: "10px 14px", textAlign: "right", color: COLORS.ink, fontWeight: 500 }}>{rowTotal}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: `1px solid ${COLORS.border}`, backgroundColor: COLORS.subtleBg }}>
                  <td style={{ padding: "10px 14px", fontWeight: 600, color: COLORS.ink }}>Total</td>
                  {sessionTypeValues.map((sv) => {
                    const colTotal = antigens.reduce((sum, a) => sum + countFor(a, sv), 0);
                    return <td key={sv} style={{ padding: "10px 14px", textAlign: "right", fontWeight: 600, color: COLORS.ink }}>{colTotal}</td>;
                  })}
                  <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: COLORS.ink }}>{report.total_doses}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      )}

      <AggregateSection token={token} startDate={startDate} endDate={endDate} />
    </div>
  );
}
