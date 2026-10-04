import React, { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { api } from "../api/client.js";
import { COLORS, CONTENT_MAX_WIDTH, SESSION_TYPES, todayIso } from "../constants.js";
import { ErrorText, Label, PrimaryButton, SelectInput, TextInput } from "../components/ui.jsx";

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

// ---------------------------------------------------------------------------
// New 3-step report: Organizational Unit -> Data (vaccines) -> Period.
// A separate, additional report from the Aggregate report above — this one
// always returns ONE set of totals for ONE chosen unit (a country, district,
// chiefdom or facility), with a per-vaccine dose breakdown.
// ---------------------------------------------------------------------------

const LEVEL_LABELS = { country: "Country", district: "District", chiefdom: "Chiefdom", facility: "Facility" };

function OrgUnitPicker({ token, role, onChange }) {
  // What this role's filter cascade needs. Each role starts fixed at its
  // own assigned level and may narrow further, down to one facility:
  //   admin:               Country -> District -> Chiefdom -> Facility (all optional)
  //   national_user:       Country fixed -> District -> Chiefdom -> Facility (all optional)
  //   district_manager:    District fixed -> Chiefdom -> Facility (all optional)
  //   facility_supervisor: Chiefdom fixed -> Facility (optional)
  //   facility_focal_person: no picker at all — see the !needsAnyPicker branch below.
  const needsAnyPicker = role !== "facility_focal_person";
  const needsCountry = role === "system_admin";
  const needsDistrict = role === "system_admin" || role === "national_user";
  const needsChiefdom = role === "system_admin" || role === "national_user" || role === "district_manager";
  // facility_supervisor's own chiefdom is fixed and fetched directly
  // (no District step for them — same as their Create-user assignment).

  const [countries, setCountries] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [chiefdoms, setChiefdoms] = useState([]);
  const [facilities, setFacilities] = useState([]);
  const [fixedFacility, setFixedFacility] = useState(null);

  const [countryId, setCountryId] = useState("");
  const [districtId, setDistrictId] = useState("");
  const [chiefdomId, setChiefdomId] = useState("");
  const [facilityId, setFacilityId] = useState("");

  // facility_focal_person: fetch their one fixed facility and stop — no
  // cascading UI, no filtering, per the access rules for this role.
  useEffect(() => {
    if (role !== "facility_focal_person") return;
    api.listFacilities(token).then((list) => { if (list[0]) setFixedFacility(list[0]); }).catch(() => {});
  }, [role, token]);

  // Country: admin sees every country; national_user's own country is
  // fetched directly and fixed.
  useEffect(() => {
    if (!needsAnyPicker) return;
    if (role === "system_admin") {
      api.listCountries(token).then((list) => {
        setCountries(list);
        if (list.length === 1) setCountryId(list[0].id);
      }).catch(() => {});
    } else if (role === "national_user") {
      api.listCountries(token).then((list) => { if (list[0]) setCountryId(list[0].id); }).catch(() => {});
    }
  }, [needsAnyPicker, role, token]);

  // District: admin/national_user narrow from their country; district_manager's
  // own district is fixed; facility_supervisor has no District step.
  useEffect(() => {
    if (!needsAnyPicker) return;
    if (role === "district_manager") {
      api.listDistricts(token).then((list) => { if (list[0]) setDistrictId(list[0].id); }).catch(() => {});
    } else if (needsDistrict && countryId) {
      api.listDistricts(token, { countryId }).then(setDistricts).catch(() => {});
    }
  }, [needsAnyPicker, needsDistrict, role, countryId, token]);

  // Chiefdom: within the fixed/chosen District for admin/national/district;
  // facility_supervisor's own chiefdom is fetched directly and fixed.
  useEffect(() => {
    if (!needsAnyPicker) return;
    setChiefdomId(""); setFacilityId(""); setFacilities([]);
    if (role === "facility_supervisor") {
      api.listChiefdoms(token).then((list) => { if (list[0]) setChiefdomId(list[0].id); }).catch(() => {});
    } else if (needsChiefdom && districtId) {
      api.listChiefdoms(token, { districtId }).then(setChiefdoms).catch(() => {});
    } else {
      setChiefdoms([]);
    }
  }, [needsAnyPicker, needsChiefdom, role, districtId, token]);

  // Facility: an optional narrowing within the fixed/chosen Chiefdom, for
  // every role that reaches this step.
  useEffect(() => {
    if (!needsAnyPicker || !chiefdomId) { setFacilities([]); return; }
    api.listFacilities(token, { chiefdomId }).then(setFacilities).catch(() => {});
    setFacilityId("");
  }, [needsAnyPicker, chiefdomId, token]);

  useEffect(() => {
    if (!needsAnyPicker) {
      if (fixedFacility) onChange({ level: "facility", unitId: fixedFacility.id, label: fixedFacility.name });
      return;
    }
    if (facilityId) return onChange({ level: "facility", unitId: facilityId });
    if (chiefdomId) return onChange({ level: "chiefdom", unitId: chiefdomId });
    if (districtId) return onChange({ level: "district", unitId: districtId });
    if (countryId) return onChange({ level: "country", unitId: countryId });
    onChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsAnyPicker, fixedFacility, countryId, districtId, chiefdomId, facilityId]);

  if (!needsAnyPicker) {
    return (
      <p style={{ fontSize: 14, color: COLORS.ink, margin: 0 }}>
        <strong>Facility:</strong> {fixedFacility ? fixedFacility.name : "Loading…"}
        <span style={{ display: "block", fontSize: 12, color: COLORS.muted, marginTop: 4 }}>
          Your account is assigned to this one facility — no other data is available to filter in.
        </span>
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {needsCountry && (
        <div>
          <Label>Country</Label>
          <SelectInput value={countryId} onChange={(e) => setCountryId(e.target.value)}>
            <option value="">Select a country…</option>
            {countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </SelectInput>
        </div>
      )}
      {needsDistrict && (role === "system_admin" ? countryId : true) && (
        <div>
          <Label>District <span style={{ color: COLORS.muted, fontWeight: 400 }}>(optional — leave blank for the whole {role === "national_user" ? "country" : "selection"})</span></Label>
          <SelectInput value={districtId} onChange={(e) => setDistrictId(e.target.value)}>
            <option value="">All districts</option>
            {districts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </SelectInput>
        </div>
      )}
      {needsChiefdom && districtId && (
        <div>
          <Label>Chiefdom <span style={{ color: COLORS.muted, fontWeight: 400 }}>(optional — leave blank for the whole district)</span></Label>
          <SelectInput value={chiefdomId} onChange={(e) => setChiefdomId(e.target.value)}>
            <option value="">All chiefdoms</option>
            {chiefdoms.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </SelectInput>
        </div>
      )}
      {chiefdomId && (
        <div>
          <Label>Facility <span style={{ color: COLORS.muted, fontWeight: 400 }}>(optional — leave blank for the whole chiefdom)</span></Label>
          <SelectInput value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
            <option value="">All facilities</option>
            {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </SelectInput>
        </div>
      )}
    </div>
  );
}

function generatedReportToCsv(report) {
  const meta = `Organizational unit,${report.unit_level} — ${report.unit_name}\nVaccines,${report.vaccines_included.join("; ")}\nPeriod,${report.start_date || "all time"} to ${report.end_date || "present"}\n\n`;
  const summary = `Children registered,${report.registered}\nFully immunized (FIC),${report.fully_immunized}\nNeed attention,${report.needs_attention}\nDoses given (total),${report.doses_given_total}\nOpen cases,${report.cases_open}\nCases returned to service,${report.cases_returned}\n\n`;
  const header = "Vaccine,Doses given\n";
  const body = report.doses_by_vaccine.map((r) => `"${r.antigen}",${r.doses_given}`).join("\n");
  return meta + summary + header + body + "\n";
}

function GeneratedReportSection({ token, role }) {
  const [vaccines, setVaccines] = useState([]);
  const [selectedVaccines, setSelectedVaccines] = useState([]);
  const [orgUnit, setOrgUnit] = useState(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.listVaccines(token).then((list) => {
      setVaccines(list);
      setSelectedVaccines(list.map((v) => v.antigen)); // all selected by default
    }).catch(() => {});
  }, [token]);

  function toggleVaccine(antigen) {
    setSelectedVaccines((prev) => prev.includes(antigen) ? prev.filter((a) => a !== antigen) : [...prev, antigen]);
  }

  async function generate() {
    if (!orgUnit) return setError("Choose an organizational unit first.");
    if (startDate && endDate && startDate > endDate) return setError("Start date can't be after end date.");
    setError("");
    setLoading(true);
    try {
      const allSelected = selectedVaccines.length === vaccines.length;
      const data = await api.generateReport(token, {
        level: orgUnit.level,
        unitId: orgUnit.unitId,
        antigens: allSelected ? [] : selectedVaccines, // omitting = "all vaccines" server-side too
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setReport(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const statRow = { padding: "10px 14px", textAlign: "right", color: COLORS.muted };

  return (
    <div style={{ marginTop: 32 }}>
      <h3 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "#6B6660", marginBottom: 12 }}>
        Generate report
      </h3>
      <div style={{ borderRadius: 12, border: `1px solid ${COLORS.border}`, padding: 20, backgroundColor: COLORS.white, marginBottom: 20, display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink, margin: "0 0 10px" }}>1. Organizational unit</p>
          <OrgUnitPicker token={token} role={role} onChange={setOrgUnit} />
        </div>

        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink, margin: "0 0 10px" }}>2. Vaccines</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {vaccines.map((v) => {
              const checked = selectedVaccines.includes(v.antigen);
              return (
                <label
                  key={v.antigen}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 999, fontSize: 13, cursor: "pointer",
                    border: `1px solid ${checked ? COLORS.primary : COLORS.inputBorder}`,
                    backgroundColor: checked ? COLORS.primary : COLORS.white,
                    color: checked ? "#fff" : COLORS.ink,
                  }}
                >
                  <input type="checkbox" checked={checked} onChange={() => toggleVaccine(v.antigen)} style={{ display: "none" }} />
                  {v.antigen}
                </label>
              );
            })}
          </div>
        </div>

        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink, margin: "0 0 10px" }}>3. Period</p>
          <div className="responsive-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <Label>Start date <span style={{ color: COLORS.muted, fontWeight: 400 }}>(optional)</span></Label>
              <TextInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} max={todayIso()} />
            </div>
            <div>
              <Label>End date <span style={{ color: COLORS.muted, fontWeight: 400 }}>(optional)</span></Label>
              <TextInput type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} max={todayIso()} />
            </div>
          </div>
        </div>

        <ErrorText>{error}</ErrorText>
        <div style={{ display: "flex", gap: 12 }}>
          <PrimaryButton onClick={generate} disabled={loading}>{loading ? "Generating…" : "Generate report"}</PrimaryButton>
          {report && (
            <button
              onClick={() => downloadCsv(generatedReportToCsv(report), `idts-report-${report.unit_level}-${todayIso()}.csv`)}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 8, fontSize: 14, fontWeight: 500, color: COLORS.ink, backgroundColor: COLORS.white, border: `1px solid ${COLORS.inputBorder}`, cursor: "pointer" }}
            >
              <Download size={15} /> Download CSV
            </button>
          )}
        </div>
      </div>

      {report && (
        <div style={{ borderRadius: 12, border: `1px solid ${COLORS.border}`, backgroundColor: COLORS.white, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: `1px solid ${COLORS.border}`, backgroundColor: COLORS.subtleBg }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: COLORS.ink, margin: 0 }}>
              {LEVEL_LABELS[report.unit_level]}: {report.unit_name}
            </p>
            <p style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>
              {report.vaccines_included.join(", ")} · {report.start_date || "all time"} to {report.end_date || "present"}
            </p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, backgroundColor: COLORS.border }}>
            {[
              ["Children registered", report.registered],
              ["Fully immunized (FIC)", report.fully_immunized],
              ["Need attention", report.needs_attention],
              ["Doses given", report.doses_given_total],
              ["Open cases", report.cases_open],
              ["Returned to service", report.cases_returned],
            ].map(([label, value]) => (
              <div key={label} style={{ backgroundColor: COLORS.white, padding: "14px 16px" }}>
                <p style={{ fontSize: 20, fontWeight: 600, margin: 0, color: COLORS.ink }}>{value}</p>
                <p style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>{label}</p>
              </div>
            ))}
          </div>
          {report.doses_by_vaccine.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ backgroundColor: COLORS.subtleBg }}>
                  <th style={{ textAlign: "left", padding: "10px 14px", color: COLORS.ink, fontWeight: 600, borderTop: `1px solid ${COLORS.border}` }}>Vaccine</th>
                  <th style={{ textAlign: "right", padding: "10px 14px", color: COLORS.ink, fontWeight: 600, borderTop: `1px solid ${COLORS.border}` }}>Doses given</th>
                </tr>
              </thead>
              <tbody>
                {report.doses_by_vaccine.map((r, i) => (
                  <tr key={r.antigen} style={{ borderTop: i === 0 ? "none" : `1px solid ${COLORS.border}` }}>
                    <td style={{ padding: "10px 14px", color: COLORS.ink }}>{r.antigen}</td>
                    <td style={statRow}>{r.doses_given}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export default function ReportsPage({ token, currentUser }) {
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
    <div style={{ maxWidth: CONTENT_MAX_WIDTH, margin: "0 auto" }}>
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
      <GeneratedReportSection token={token} role={currentUser.role} />
    </div>
  );
}
