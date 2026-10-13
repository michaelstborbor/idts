import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronLeft, Plus, Search } from "lucide-react";
import { api } from "../api/client.js";
import { COLORS, CONTENT_MAX_WIDTH, ageLabel, fmtDate, todayIso } from "../constants.js";
import { ErrorText, Label, Pill, PrimaryButton, SecondaryButton, SelectInput, TextInput } from "../components/ui.jsx";

// Who may record/edit an AEFI (mirrors AEFI_WRITE_ROLES on the backend, which
// is what actually enforces it). National supervisors can view only.
const AEFI_WRITE_ROLES = ["system_admin", "facility_focal_person", "vaccinator", "chw", "facility_supervisor", "district_manager"];

const SEVERITY_STYLE = {
  mild: { color: "#10633B", bg: "#DDF3E6" },
  moderate: { color: "#7A4D00", bg: "#FFF1CC" },
  severe: { color: "#A1131B", bg: "#FDE1E2" },
};
const STATUS_STYLE = {
  done: { label: "done", color: "#10633B", bg: "#DDF3E6" },
  pending: { label: "due", color: "#7A4D00", bg: "#FFF1CC" },
  overdue: { label: "overdue", color: "#A1131B", bg: "#FDE1E2" },
};
const ACTION_GROUPS = [
  { key: "care", title: "Care at the facility" },
  { key: "referral", title: "Referral" },
  { key: "reporting", title: "Reporting & investigation" },
  { key: "followup", title: "Follow-up" },
];

function SeverityPill({ severity }) {
  const s = SEVERITY_STYLE[severity] || SEVERITY_STYLE.mild;
  return <Pill label={severity ? severity[0].toUpperCase() + severity.slice(1) : "—"} color={s.color} bg={s.bg} />;
}

function StatusPills({ record }) {
  if (!record.is_serious) return null;
  const r = STATUS_STYLE[record.report_status];
  const i = STATUS_STYLE[record.investigation_status];
  return (
    <>
      <Pill label="Serious" color="#A1131B" bg="#FDE1E2" />
      {r && <Pill label={`Report ${r.label}`} color={r.color} bg={r.bg} />}
      {i && <Pill label={`Investigation ${i.label}`} color={i.color} bg={i.bg} />}
    </>
  );
}

function vaccinationLabel(v) {
  return `${v.antigen} dose ${v.dose_number}`;
}

const checkboxRow = { display: "flex", alignItems: "flex-start", gap: 10, fontSize: 16, color: COLORS.ink, lineHeight: 1.4, cursor: "pointer" };
const textArea = {
  width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${COLORS.inputBorder}`,
  fontSize: 16, outline: "none", boxSizing: "border-box", fontFamily: "inherit", resize: "vertical",
};
const sectionTitle = { fontSize: 18, fontWeight: 700, color: "#10222E", margin: "0 0 12px" };
const card = { borderRadius: 12, border: `1px solid ${COLORS.border}`, padding: 20, backgroundColor: COLORS.white };

// ---------------------------------------------------------------------------
// Pick one registered child (search the list the user already has access to)
// ---------------------------------------------------------------------------
function ChildPicker({ children, selected, onSelect }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = q.length < 2
    ? []
    : children
        .filter((c) => c.full_name.toLowerCase().includes(q) || c.system_id.toLowerCase().includes(q))
        .slice(0, 8);

  if (selected) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 14px", borderRadius: 8, backgroundColor: COLORS.subtleBg, border: `1px solid ${COLORS.border}` }}>
        <div>
          <p style={{ fontSize: 16, fontWeight: 600, color: COLORS.ink, margin: 0 }}>{selected.full_name}</p>
          <p style={{ fontSize: 15, color: COLORS.muted, margin: "2px 0 0" }}>
            {[selected.system_id, selected.dob ? ageLabel(selected.dob) : null, selected.sex ? (selected.sex === "F" ? "Female" : "Male") : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        {onSelect && (
          <button type="button" onClick={() => onSelect(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, color: COLORS.primary }}>
            Change
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ position: "relative" }}>
        <Search size={15} style={{ position: "absolute", left: 12, top: 13, color: COLORS.muted }} />
        <TextInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type the child's name or ID…"
          style={{ paddingLeft: 34 }}
        />
      </div>
      {q.length >= 2 && (
        <div style={{ marginTop: 8, borderRadius: 8, border: `1px solid ${COLORS.border}`, overflow: "hidden" }}>
          {matches.length === 0 ? (
            <p style={{ fontSize: 16, color: COLORS.muted, margin: 0, padding: "12px 14px" }}>
              No registered child matches that. You can only record an AEFI for a child you have access to.
            </p>
          ) : (
            matches.map((c, i) => (
              <button
                type="button"
                key={c.id}
                onClick={() => onSelect(c)}
                style={{
                  width: "100%", textAlign: "left", padding: "10px 14px", background: COLORS.white, border: "none", cursor: "pointer",
                  borderTop: i === 0 ? "none" : `1px solid ${COLORS.border}`,
                }}
              >
                <span style={{ fontSize: 16, fontWeight: 600, color: COLORS.ink }}>{c.full_name}</span>
                <span style={{ fontSize: 15, color: COLORS.muted }}> · {c.system_id} · {ageLabel(c.dob)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Record / edit form
// ---------------------------------------------------------------------------
function AefiForm({ token, catalog, children, record, onSaved, onCancel }) {
  const isEdit = !!record;

  const [child, setChild] = useState(
    isEdit ? children.find((c) => c.id === record.child_id) || { id: record.child_id, full_name: record.child_name, system_id: record.child_system_id, dob: null, sex: "" } : null
  );
  const [vaccinations, setVaccinations] = useState([]);
  const [vaccinationIds, setVaccinationIds] = useState(isEdit ? record.vaccinations.map((v) => v.vaccination_event_id) : []);
  const [onsetDate, setOnsetDate] = useState(isEdit ? record.onset_date : todayIso());
  const [eventType, setEventType] = useState(isEdit ? record.event_type : "");
  const [eventDescription, setEventDescription] = useState(isEdit ? record.event_description || "" : "");
  const [severity, setSeverity] = useState(isEdit ? record.severity : "");
  const [criteria, setCriteria] = useState(isEdit ? record.serious_criteria : []);
  const [cluster, setCluster] = useState(isEdit ? record.part_of_cluster : false);
  const [cause, setCause] = useState(isEdit ? record.cause_category : "under_investigation");
  const [outcome, setOutcome] = useState(isEdit ? record.outcome : "unknown");
  const [actions, setActions] = useState(isEdit ? record.management_actions : []);
  const [notes, setNotes] = useState(isEdit ? record.management_notes || "" : "");
  const [reportedDate, setReportedDate] = useState(isEdit ? record.reported_date || "" : "");
  const [investigationDate, setInvestigationDate] = useState(isEdit ? record.investigation_date || "" : "");

  const [suggestion, setSuggestion] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const skipFirstSuggestionApply = useRef(isEdit);

  const eventMeta = catalog.event_types.find((e) => e.key === eventType);
  const isSerious = criteria.length > 0;

  // The child's recorded doses are the options for "which vaccine(s)?".
  useEffect(() => {
    if (!child) { setVaccinations([]); return; }
    api.aefiChildVaccinations(token, child.id).then(setVaccinations).catch((err) => setError(err.message));
  }, [child, token]);

  // Suggested management follows event type + severity + seriousness + cluster.
  // Opening an EXISTING record keeps its saved ticks until one of those changes.
  const criteriaKey = criteria.join(",");
  useEffect(() => {
    if (!eventType || !severity) { setSuggestion(null); return undefined; }
    let cancelled = false;
    api.aefiSuggest(token, { eventType, severity, seriousCriteria: criteria, partOfCluster: cluster })
      .then((s) => {
        if (cancelled) return;
        setSuggestion(s);
        if (skipFirstSuggestionApply.current) { skipFirstSuggestionApply.current = false; return; }
        setActions(s.actions);
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventType, severity, criteriaKey, cluster, token]);

  function toggle(list, setList, key) {
    setList(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
  }

  async function save() {
    if (!child) return setError("Choose the child first.");
    if (vaccinationIds.length === 0) return setError("Select the vaccine dose(s) this event followed.");
    if (!onsetDate) return setError("Enter the date the event started.");
    if (onsetDate > todayIso()) return setError("The onset date can't be in the future.");
    if (!eventType) return setError("Choose the type of event.");
    if (eventType === "other" && !eventDescription.trim()) return setError("Describe the event.");
    if (!severity) return setError("Choose mild, moderate or severe.");
    setError("");
    setSaving(true);
    const body = {
      vaccination_event_ids: vaccinationIds,
      onset_date: onsetDate,
      event_type: eventType,
      event_description: eventDescription.trim() || null,
      severity,
      serious_criteria: criteria,
      part_of_cluster: cluster,
      cause_category: cause,
      outcome,
      management_actions: actions,
      management_notes: notes.trim() || null,
      reported_date: reportedDate || null,
      investigation_date: investigationDate || null,
    };
    try {
      const saved = isEdit
        ? await api.updateAefi(token, record.id, body)
        : await api.createAefi(token, { child_id: child.id, ...body });
      onSaved(saved);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
      <button type="button" onClick={onCancel} style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", fontSize: 16, color: COLORS.primary, padding: 0 }}>
        <ChevronLeft size={16} /> Back to AEFI list
      </button>

      <p style={{ fontSize: 15, color: COLORS.muted, margin: 0, lineHeight: 1.5 }}>{catalog.disclaimer}</p>

      {/* 1. Child + vaccine */}
      <div style={card}>
        <p style={sectionTitle}>1. Child and vaccine</p>
        <Label>Child</Label>
        {isEdit ? (
          <ChildPicker children={children} selected={child} onSelect={null} />
        ) : (
          <ChildPicker children={children} selected={child} onSelect={(c) => { setChild(c); setVaccinationIds([]); }} />
        )}

        {child && (
          <div style={{ marginTop: 16 }}>
            <Label>Vaccine dose(s) the event followed</Label>
            {vaccinations.length === 0 ? (
              <p style={{ fontSize: 16, color: COLORS.muted, margin: 0 }}>
                This child has no recorded vaccinations yet. Record the dose first, then come back to record the AEFI.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {vaccinations.map((v) => (
                  <label key={v.vaccination_event_id} style={checkboxRow}>
                    <input
                      type="checkbox"
                      checked={vaccinationIds.includes(v.vaccination_event_id)}
                      onChange={() => toggle(vaccinationIds, setVaccinationIds, v.vaccination_event_id)}
                      style={{ marginTop: 2 }}
                    />
                    <span>
                      <strong>{vaccinationLabel(v)}</strong> — given {fmtDate(v.event_date)}
                      {v.batch_lot_number ? ` · lot ${v.batch_lot_number}` : ""}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. The event */}
      <div style={card}>
        <p style={sectionTitle}>2. The event</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <Label>Date the event started</Label>
            <TextInput type="date" value={onsetDate} max={todayIso()} onChange={(e) => setOnsetDate(e.target.value)} />
          </div>
          <div>
            <Label>Type of event</Label>
            <SelectInput value={eventType} onChange={(e) => setEventType(e.target.value)}>
              <option value="">Select the event…</option>
              {catalog.event_types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </SelectInput>
            {eventMeta && (
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 15, color: COLORS.muted, lineHeight: 1.5 }}>
                {eventMeta.guidance.map((g) => <li key={g}>{g}</li>)}
              </ul>
            )}
          </div>
          {(eventType === "other" || eventDescription) && (
            <div>
              <Label>Description {eventType !== "other" && <span style={{ color: COLORS.muted, fontWeight: 400 }}>(optional)</span>}</Label>
              <textarea rows={3} value={eventDescription} onChange={(e) => setEventDescription(e.target.value)} style={textArea} placeholder="What happened, in your own words" />
            </div>
          )}
          {eventType && eventType !== "other" && !eventDescription && (
            <button type="button" onClick={() => setEventDescription(" ")} style={{ alignSelf: "flex-start", background: "none", border: "none", cursor: "pointer", fontSize: 15, color: COLORS.primary, padding: 0 }}>
              + Add a description
            </button>
          )}
        </div>
      </div>

      {/* 3. Classification */}
      <div style={card}>
        <p style={sectionTitle}>3. Classification</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <Label>How intense was it?</Label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {catalog.severities.map((s) => {
                const style = SEVERITY_STYLE[s.key];
                const on = severity === s.key;
                return (
                  <label key={s.key} style={{ ...checkboxRow, padding: "10px 12px", borderRadius: 8, border: `1px solid ${on ? style.color : COLORS.border}`, backgroundColor: on ? style.bg : COLORS.white }}>
                    <input type="radio" name="severity" checked={on} onChange={() => setSeverity(s.key)} style={{ marginTop: 2 }} />
                    <span><strong style={{ color: style.color }}>{s.label}</strong><br /><span style={{ fontSize: 15, color: COLORS.muted }}>{s.description}</span></span>
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <Label>Did it meet any seriousness criterion?</Label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {catalog.serious_criteria.map((c) => (
                <label key={c.key} style={checkboxRow}>
                  <input type="checkbox" checked={criteria.includes(c.key)} onChange={() => toggle(criteria, setCriteria, c.key)} style={{ marginTop: 2 }} />
                  <span>{c.label}</span>
                </label>
              ))}
              <label style={checkboxRow}>
                <input type="checkbox" checked={cluster} onChange={() => setCluster(!cluster)} style={{ marginTop: 2 }} />
                <span>Part of a cluster (two or more cases linked by the same vial/lot, session, vaccinator or place)</span>
              </label>
            </div>
            {isSerious && (
              <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 8, backgroundColor: "#FDE1E2", color: "#A1131B", fontSize: 16, lineHeight: 1.5, display: "flex", gap: 8 }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>
                  <strong>Serious AEFI.</strong> Report to the district within {catalog.report_within_hours} hours and start the investigation within {catalog.investigate_within_hours} hours.
                </span>
              </div>
            )}
            {!isSerious && severity === "severe" && (
              <p style={{ fontSize: 15, color: "#7A4D00", margin: "10px 0 0" }}>
                Severe describes intensity, not outcome. Check the criteria above — if the child needed hospital care or was in danger, tick it.
              </p>
            )}
          </div>

          <div className="responsive-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <Label>Cause (WHO classification)</Label>
              <SelectInput value={cause} onChange={(e) => setCause(e.target.value)}>
                {catalog.cause_categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </SelectInput>
              <p style={{ fontSize: 14, color: COLORS.muted, margin: "6px 0 0" }}>
                {catalog.cause_categories.find((c) => c.key === cause)?.description}
              </p>
            </div>
            <div>
              <Label>Outcome so far</Label>
              <SelectInput value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                {catalog.outcomes.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </SelectInput>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Management */}
      <div style={card}>
        <p style={sectionTitle}>4. Management</p>
        {!suggestion ? (
          <p style={{ fontSize: 16, color: COLORS.muted, margin: 0 }}>
            Choose the type of event and how intense it was, and suggested management will be ticked for you. You can change any tick.
          </p>
        ) : (
          <>
            {suggestion.guidance.length > 0 && (
              <div style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 8, backgroundColor: "#FFF1CC", color: "#6A4300", fontSize: 15, lineHeight: 1.5 }}>
                <ul style={{ margin: 0, paddingLeft: 18 }}>{suggestion.guidance.map((g) => <li key={g}>{g}</li>)}</ul>
              </div>
            )}
            <p style={{ fontSize: 15, color: COLORS.muted, margin: "0 0 12px" }}>
              Ticked actions are suggested for this event — untick what doesn't apply and add anything else you did.
              {" "}Report timeline: <strong>{suggestion.report_timeline === "24h" ? `within ${catalog.report_within_hours} hours` : "routine (non-serious) report"}</strong>.
            </p>
          </>
        )}

        {suggestion && ACTION_GROUPS.map((g) => (
          <div key={g.key} style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: COLORS.ink, margin: "0 0 8px" }}>{g.title}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {catalog.management_actions.filter((a) => a.group === g.key).map((a) => (
                <label key={a.key} style={checkboxRow}>
                  <input type="checkbox" checked={actions.includes(a.key)} onChange={() => toggle(actions, setActions, a.key)} style={{ marginTop: 2 }} />
                  <span>
                    {a.label}
                    {suggestion.actions.includes(a.key) && <span style={{ marginLeft: 8 }}><Pill label="Suggested" color={COLORS.primary} bg="#DCEBF5" /></span>}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}

        <div style={{ marginTop: 6 }}>
          <Label>Notes <span style={{ color: COLORS.muted, fontWeight: 400 }}>(optional)</span></Label>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} style={textArea} placeholder="Treatment given, who was informed, anything else worth recording" />
        </div>

        <div className="responsive-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
          <div>
            <Label>Date reported to the district <span style={{ color: COLORS.muted, fontWeight: 400 }}>(optional)</span></Label>
            <TextInput type="date" value={reportedDate} max={todayIso()} onChange={(e) => setReportedDate(e.target.value)} />
          </div>
          <div>
            <Label>Date investigation started <span style={{ color: COLORS.muted, fontWeight: 400 }}>(optional)</span></Label>
            <TextInput type="date" value={investigationDate} max={todayIso()} onChange={(e) => setInvestigationDate(e.target.value)} />
          </div>
        </div>
      </div>

      <ErrorText>{error}</ErrorText>
      <div style={{ display: "flex", gap: 12 }}>
        <SecondaryButton onClick={onCancel} style={{ flex: 1 }}>Cancel</SecondaryButton>
        <PrimaryButton onClick={save} disabled={saving} style={{ flex: 1 }}>
          {saving ? "Saving…" : isEdit ? "Save changes" : "Save AEFI"}
        </PrimaryButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Read-only detail (for roles that can view but not edit)
// ---------------------------------------------------------------------------
function AefiDetail({ catalog, record, onBack }) {
  const label = (list, key) => list.find((x) => x.key === key)?.label || key;
  const row = (name, value) => (
    <div style={{ padding: "10px 0", borderTop: `1px solid ${COLORS.border}` }}>
      <p style={{ fontSize: 14, color: COLORS.muted, margin: 0 }}>{name}</p>
      <p style={{ fontSize: 16, color: COLORS.ink, margin: "2px 0 0", whiteSpace: "pre-wrap" }}>{value || "—"}</p>
    </div>
  );
  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <button type="button" onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", fontSize: 16, color: COLORS.primary, padding: 0, marginBottom: 16 }}>
        <ChevronLeft size={16} /> Back to AEFI list
      </button>
      <div style={card}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 19, color: COLORS.ink }}>{record.aefi_number}</h3>
          <SeverityPill severity={record.severity} />
          <StatusPills record={record} />
        </div>
        {row("Child", `${record.child_name} (${record.child_system_id})${record.facility_name ? ` · ${record.facility_name}` : ""}`)}
        {row("Vaccine(s)", record.vaccinations.map((v) => `${vaccinationLabel(v)} — ${fmtDate(v.event_date)}${v.batch_lot_number ? ` · lot ${v.batch_lot_number}` : ""}`).join("\n"))}
        {row("Event", `${record.event_type_label}${record.event_description ? `\n${record.event_description}` : ""}`)}
        {row("Onset date", fmtDate(record.onset_date))}
        {row("Seriousness", record.serious_criteria.map((k) => label(catalog.serious_criteria, k)).join("\n") || "Not serious")}
        {row("Part of a cluster", record.part_of_cluster ? "Yes" : "No")}
        {row("Cause (WHO classification)", label(catalog.cause_categories, record.cause_category))}
        {row("Outcome", label(catalog.outcomes, record.outcome))}
        {row("Management", record.management_actions.map((k) => `• ${label(catalog.management_actions, k)}`).join("\n"))}
        {row("Notes", record.management_notes)}
        {row("Reported to district", record.reported_date ? fmtDate(record.reported_date) : "Not yet")}
        {row("Investigation started", record.investigation_date ? fmtDate(record.investigation_date) : "Not yet")}
        {row("Recorded by", record.recorded_by_name)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The AEFI tab
// ---------------------------------------------------------------------------
export default function AefiPage({ token, currentUser, children }) {
  const canWrite = AEFI_WRITE_ROLES.includes(currentUser.role);
  const [catalog, setCatalog] = useState(null);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [seriousOnly, setSeriousOnly] = useState(false);
  const [view, setView] = useState({ mode: "list", record: null });

  useEffect(() => {
    api.aefiCatalog(token).then(setCatalog).catch((err) => setError(err.message));
  }, [token]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setRecords(await api.listAefi(token, { severity: severityFilter || undefined, seriousOnly }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [token, severityFilter, seriousOnly]);

  if (!catalog) {
    return error ? <ErrorText>{error}</ErrorText> : <p style={{ textAlign: "center", color: COLORS.muted }}>Loading…</p>;
  }

  if (view.mode === "form") {
    return (
      <AefiForm
        token={token}
        catalog={catalog}
        children={children}
        record={view.record}
        onCancel={() => setView({ mode: "list", record: null })}
        onSaved={() => { setView({ mode: "list", record: null }); load(); }}
      />
    );
  }
  if (view.mode === "detail") {
    return <AefiDetail catalog={catalog} record={view.record} onBack={() => setView({ mode: "list", record: null })} />;
  }

  const open = (record) => setView({ mode: canWrite ? "form" : "detail", record });

  return (
    <div style={{ maxWidth: CONTENT_MAX_WIDTH, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ minWidth: 160 }}>
            <SelectInput value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
              <option value="">All severities</option>
              {catalog.severities.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </SelectInput>
          </div>
          <label style={{ ...checkboxRow, alignItems: "center" }}>
            <input type="checkbox" checked={seriousOnly} onChange={() => setSeriousOnly(!seriousOnly)} />
            Serious only
          </label>
        </div>
        {canWrite && (
          <button
            onClick={() => setView({ mode: "form", record: null })}
            className="icon-btn"
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 8, fontSize: 16, fontWeight: 600, color: "#fff", backgroundColor: COLORS.primary, border: "none", cursor: "pointer" }}
          >
            <Plus size={16} /> Record AEFI
          </button>
        )}
      </div>

      {error && <ErrorText>{error}</ErrorText>}

      {loading ? (
        <p style={{ textAlign: "center", color: COLORS.muted }}>Loading…</p>
      ) : records.length === 0 ? (
        <div style={{ textAlign: "center", padding: "56px 16px", borderRadius: 12, border: `1px solid ${COLORS.border}`, backgroundColor: COLORS.white }}>
          <p style={{ margin: 0, fontWeight: 600, color: COLORS.ink }}>No adverse events recorded</p>
          <p style={{ fontSize: 16, color: COLORS.muted, margin: "4px 0 0" }}>
            {canWrite ? "Use Record AEFI to log an event for a registered child." : "Events recorded in your area will appear here."}
          </p>
        </div>
      ) : (
        <div style={{ borderRadius: 12, border: `1px solid ${COLORS.border}`, overflow: "hidden", backgroundColor: COLORS.white }}>
          {records.map((r, i) => (
            <button
              key={r.id}
              onClick={() => open(r)}
              style={{ width: "100%", textAlign: "left", padding: "14px 16px", background: "none", border: "none", cursor: "pointer", borderTop: i === 0 ? "none" : `1px solid ${COLORS.border}` }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: COLORS.ink }}>{r.child_name}</span>
                <span style={{ fontSize: 15, color: COLORS.muted }}>{r.child_system_id}</span>
                <SeverityPill severity={r.severity} />
                <StatusPills record={r} />
              </div>
              <p style={{ fontSize: 16, color: COLORS.ink, margin: "4px 0 0" }}>{r.event_type_label}</p>
              <p style={{ fontSize: 15, color: COLORS.muted, margin: "2px 0 0" }}>
                {r.aefi_number} · onset {fmtDate(r.onset_date)} · {r.vaccinations.map(vaccinationLabel).join(", ")}
                {r.facility_name ? ` · ${r.facility_name}` : ""}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
