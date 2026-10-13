import React, { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { COLORS, CONTENT_MAX_WIDTH, STATUS_META } from "../constants.js";
import { ErrorText, Label, PrimaryButton, SecondaryButton, TextInput } from "../components/ui.jsx";

const NAME_FIELDS = ["programme_name", "organisation_name"];
const DAY_FIELDS = ["due_soon_window_days", "overdue_window_days", "defaulter_threshold_days"];

function Card({ title, description, children }) {
  return (
    <section style={{ backgroundColor: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 14, padding: 22, marginBottom: 20 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px", color: COLORS.ink }}>{title}</h2>
      {description && <p style={{ fontSize: 15, color: COLORS.muted, margin: "0 0 18px", lineHeight: 1.55, maxWidth: 760 }}>{description}</p>}
      {children}
    </section>
  );
}

// Mirrors app/domain/schedule_engine.py: counting days since a dose became
// due, it is "due soon" first, then "overdue", then "due" until the
// defaulter threshold, then "defaulter".
function segmentsFor(ds, ow, dt) {
  return [
    { status: "due_soon", from: 0, to: ds },
    { status: "overdue", from: ds + 1, to: ds + ow },
    { status: "due", from: ds + ow + 1, to: dt },
    { status: "defaulter", from: dt + 1, to: null },
  ].filter((seg) => seg.to === null || seg.to >= seg.from);
}

function rowValid(r) {
  const n = [r.due_soon_window_days, r.overdue_window_days, r.defaulter_threshold_days].map(Number);
  return [r.due_soon_window_days, r.overdue_window_days, r.defaulter_threshold_days].every((v) => v !== "")
    && n.every((v) => Number.isInteger(v) && v >= 0) && n[2] > n[0] + n[1];
}

function StatusBar({ ds, ow, dt, height = 14 }) {
  const end = Math.max(dt + Math.round(dt * 0.25), 10);
  return (
    <div style={{ display: "flex", height, borderRadius: 6, overflow: "hidden", minWidth: 120 }} aria-hidden="true">
      {segmentsFor(ds, ow, dt).map((seg) => (
        <div
          key={seg.status}
          style={{ flex: `${Math.max((seg.to === null ? end : seg.to) - seg.from + 1, 1)} 1 0`, backgroundColor: STATUS_META[seg.status].chart, minWidth: 4 }}
        />
      ))}
    </div>
  );
}

function StatusLegend({ ds, ow, dt }) {
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 6 }}>
      {segmentsFor(ds, ow, dt).map((seg) => {
        const meta = STATUS_META[seg.status];
        const range = seg.to === null ? `from day ${seg.from}` : seg.from === seg.to ? `day ${seg.from}` : `days ${seg.from} to ${seg.to}`;
        return (
          <li key={seg.status} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15 }}>
            <span style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: meta.chart, flexShrink: 0 }} />
            <strong style={{ minWidth: 86 }}>{meta.label}</strong>
            <span style={{ color: COLORS.muted }}>{range} after the dose becomes due</span>
          </li>
        );
      })}
    </ul>
  );
}

function ageLabelDays(days) {
  if (days === 0) return "At birth";
  if (days < 7 * 15) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30.4)} months`;
}

function ThresholdsCard({ token }) {
  const [saved, setSaved] = useState(null);
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getScheduleThresholds(token)
      .then((list) => { setSaved(list); setRows(list.map((r) => ({ ...r }))); setSelected(list[0]?.id || null); })
      .catch((err) => setError(err.message));
  }, [token]);

  if (!rows) return error ? <ErrorText>{error}</ErrorText> : <p style={{ color: COLORS.muted }}>Loading…</p>;

  const savedById = Object.fromEntries(saved.map((r) => [r.id, r]));
  const changed = rows.filter((r) => DAY_FIELDS.some((k) => String(savedById[r.id][k]) !== String(r[k])));
  const allValid = rows.every(rowValid);
  const sel = rows.find((r) => r.id === selected) || rows[0];

  function setCell(id, key, value) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [key]: value } : r)));
    setSelected(id);
  }

  async function save() {
    if (!window.confirm(
      `Save new thresholds for ${changed.length} dose${changed.length === 1 ? "" : "s"}? Every child's dose status, including who counts as a defaulter, is recalculated straight away.`
    )) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const next = await api.updateScheduleThresholds(token, changed.map((r) => ({
        id: r.id,
        due_soon_window_days: Number(r.due_soon_window_days),
        overdue_window_days: Number(r.overdue_window_days),
        defaulter_threshold_days: Number(r.defaulter_threshold_days),
      })));
      setSaved(next);
      setRows(next.map((r) => ({ ...r })));
      setNotice("Thresholds saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const numInput = (r, k) => (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      value={r[k]}
      onChange={(e) => setCell(r.id, k, e.target.value)}
      onFocus={() => setSelected(r.id)}
      aria-label={`${r.antigen} dose ${r.dose_number}: ${k.replace(/_/g, " ")}`}
      style={{
        width: 76, minHeight: 40, padding: "6px 10px", borderRadius: 8, fontSize: 16, fontWeight: 700, color: COLORS.ink,
        border: `1.5px solid ${rowValid(r) ? COLORS.inputBorder : COLORS.danger}`, backgroundColor: COLORS.white,
      }}
    />
  );

  return (
    <>
      <div style={{ padding: 16, borderRadius: 12, backgroundColor: COLORS.subtleBg, marginBottom: 16 }}>
        <p style={{ fontSize: 16, fontWeight: 700, margin: "0 0 10px" }}>{sel.antigen} dose {sel.dose_number}</p>
        <StatusBar ds={Number(sel.due_soon_window_days)} ow={Number(sel.overdue_window_days)} dt={Number(sel.defaulter_threshold_days)} height={28} />
        {rowValid(sel)
          ? <StatusLegend ds={Number(sel.due_soon_window_days)} ow={Number(sel.overdue_window_days)} dt={Number(sel.defaulter_threshold_days)} />
          : <p style={{ color: COLORS.danger, fontWeight: 600, margin: "10px 0 0" }}>The defaulter threshold must be longer than the due-soon and overdue windows added together.</p>}
      </div>

      <div style={{ overflowX: "auto", border: `1px solid ${COLORS.border}`, borderRadius: 12 }}>
        <table className="data-table middle">
          <thead>
            <tr>
              <th>Dose</th>
              <th>Given at</th>
              <th>Due soon (days)</th>
              <th>Overdue (days)</th>
              <th>Defaulter after (days)</th>
              <th style={{ minWidth: 160 }}>Timeline</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isChanged = changed.includes(r);
              return (
                <tr
                  key={r.id}
                  onClick={() => setSelected(r.id)}
                  style={{ backgroundColor: r.id === sel.id ? COLORS.primaryTint : isChanged ? "#FFF8E1" : undefined, cursor: "pointer" }}
                >
                  <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{r.antigen} {r.dose_number}{isChanged && <span style={{ color: "#6A4300", fontWeight: 700 }}> · edited</span>}</td>
                  <td style={{ color: COLORS.muted, whiteSpace: "nowrap" }}>{ageLabelDays(r.recommended_age_days)}</td>
                  <td>{numInput(r, "due_soon_window_days")}</td>
                  <td>{numInput(r, "overdue_window_days")}</td>
                  <td>{numInput(r, "defaulter_threshold_days")}</td>
                  <td style={{ verticalAlign: "middle" }}>
                    {rowValid(r)
                      ? <StatusBar ds={Number(r.due_soon_window_days)} ow={Number(r.overdue_window_days)} dt={Number(r.defaulter_threshold_days)} />
                      : <span style={{ color: COLORS.danger, fontWeight: 600 }}>Check values</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
        <PrimaryButton onClick={save} disabled={changed.length === 0 || !allValid || saving}>
          {saving ? "Saving…" : changed.length ? `Save ${changed.length} change${changed.length === 1 ? "" : "s"}` : "Save thresholds"}
        </PrimaryButton>
        {changed.length > 0 && <SecondaryButton onClick={() => setRows(saved.map((r) => ({ ...r })))}>Discard changes</SecondaryButton>}
        {notice && <span role="status" style={{ fontSize: 16, color: COLORS.protect, fontWeight: 600 }}>{notice}</span>}
      </div>
      {error && <div style={{ marginTop: 14 }}><ErrorText>{error}</ErrorText></div>}
    </>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ padding: "14px 16px", borderRadius: 12, backgroundColor: COLORS.subtleBg }}>
      <p style={{ fontSize: 26, fontWeight: 700, margin: 0, color: COLORS.ink, fontVariantNumeric: "tabular-nums" }}>{value}</p>
      <p style={{ fontSize: 15, fontWeight: 600, margin: "4px 0 0", color: COLORS.muted }}>{label}</p>
    </div>
  );
}

export default function SystemSettingsPage({ token, onProgrammeNameChange }) {
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(null);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSystemSettings(token).then((s) => { setSaved(s); setForm(s); }).catch((err) => setError(err.message));
    api.getSystemInfo(token).then(setInfo).catch(() => {});
  }, [token]);

  const dirty = form && saved && NAME_FIELDS.some((k) => saved[k] !== form[k]);
  const namesValid = form && NAME_FIELDS.every((k) => form[k].trim().length > 0);

  async function save() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const next = await api.updateSystemSettings(token, {
        programme_name: form.programme_name.trim(),
        organisation_name: form.organisation_name.trim(),
      });
      setSaved(next);
      setForm(next);
      onProgrammeNameChange?.(next.programme_name);
      setNotice("Programme details saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div style={{ maxWidth: CONTENT_MAX_WIDTH, margin: "0 auto" }}>
      <Card title="Programme details" description="Shown on the sign-in page and at the top of the menu.">
        {!form ? (error ? <ErrorText>{error}</ErrorText> : <p style={{ color: COLORS.muted }}>Loading…</p>) : (
          <>
            <div className="settings-grid">
              <div>
                <Label>Programme name</Label>
                <TextInput value={form.programme_name} onChange={set("programme_name")} maxLength={120} />
              </div>
              <div>
                <Label>Organisation</Label>
                <TextInput value={form.organisation_name} onChange={set("organisation_name")} maxLength={120} />
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
              <PrimaryButton onClick={save} disabled={!dirty || !namesValid || saving}>{saving ? "Saving…" : "Save programme details"}</PrimaryButton>
              {dirty && <SecondaryButton onClick={() => setForm(saved)}>Discard changes</SecondaryButton>}
              {notice && <span role="status" style={{ fontSize: 16, color: COLORS.protect, fontWeight: 600 }}>{notice}</span>}
            </div>
            {error && <div style={{ marginTop: 14 }}><ErrorText>{error}</ErrorText></div>}
          </>
        )}
      </Card>

      <Card
        title="Dose status thresholds"
        description="For each dose, how many days after it becomes due it moves to the next status. These drive the due list, defaulter follow-up and every dashboard count. The current values are programme placeholders until the EPI team confirms them."
      >
        <ThresholdsCard token={token} />
      </Card>

      {info && (
        <Card title="System overview" description={`API version ${info.api_version}, ${info.database === "postgresql" ? "PostgreSQL" : info.database} database.`}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12 }}>
            <Stat label="Active users" value={info.users_active} />
            <Stat label="Deactivated users" value={info.users_inactive} />
            <Stat label="Locked accounts" value={info.users_locked} />
            <Stat label="Districts" value={info.districts} />
            <Stat label="Health facilities" value={info.facilities} />
            <Stat label="Children registered" value={info.children} />
            <Stat label="Doses recorded" value={info.vaccinations} />
            <Stat label="Open follow-up cases" value={info.open_defaulter_cases} />
            <Stat label="Schedule doses" value={info.schedule_entries} />
            <Stat label="Activity, last 7 days" value={info.audit_events_last_7_days} />
          </div>
        </Card>
      )}
    </div>
  );
}
