import React, { useState } from "react";
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
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
    </div>
  );
}
