import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, Link2, Link2Off, PlugZap, Search, Send, Sparkles } from "lucide-react";
import { api } from "../api/client.js";
import { COLORS, CONTENT_MAX_WIDTH } from "../constants.js";
import { ErrorText, Label, Modal, PrimaryButton, SecondaryButton, SelectInput, TextInput } from "../components/ui.jsx";

const TABS = [
  { value: "connection", label: "1. Connection" },
  { value: "facilities", label: "2. Facilities" },
  { value: "vaccines", label: "3. Vaccines" },
  { value: "send", label: "4. Send monthly data" },
];

const STATUS_TONE = {
  success: { label: "Accepted", color: COLORS.protect, bg: "#DDF3E6" },
  warning: { label: "Accepted with warnings", color: "#6A4300", bg: "#FFF1CC" },
  error: { label: "Failed", color: COLORS.danger, bg: COLORS.dangerTint },
};

function Card({ title, description, children, actions }) {
  return (
    <section style={{ backgroundColor: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 14, padding: 22, marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ minWidth: 0, flex: "1 1 320px" }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px", color: COLORS.ink }}>{title}</h2>
          {description && <p style={{ fontSize: 15, color: COLORS.muted, margin: "0 0 18px", lineHeight: 1.55, maxWidth: 760 }}>{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Notice({ tone = "info", children }) {
  const tones = {
    info: { color: COLORS.primaryDark, bg: COLORS.primaryTint, border: COLORS.primary },
    ok: { color: "#0B5530", bg: "#DDF3E6", border: COLORS.protect },
    warn: { color: "#6A4300", bg: "#FFF1CC", border: "#D08A00" },
    error: { color: COLORS.danger, bg: COLORS.dangerTint, border: COLORS.danger },
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} style={{ fontSize: 15, lineHeight: 1.55, padding: "12px 16px", borderRadius: 10, color: tones.color, backgroundColor: tones.bg, borderLeft: `4px solid ${tones.border}`, margin: "0 0 16px" }}>
      {children}
    </div>
  );
}

function monthOptions() {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < 18; i += 1) {
    const value = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({ value, label: d.toLocaleDateString(undefined, { month: "long", year: "numeric" }) });
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

function fmtWhen(iso) {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------- connection

function ConnectionTab({ token, connection, onSaved }) {
  const [form, setForm] = useState({
    base_url: connection.base_url, auth_type: connection.auth_type || "token", username: connection.username,
    secret: "", data_set_uid: connection.data_set_uid, data_set_name: connection.data_set_name,
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [testResult, setTestResult] = useState(null);
  const [dataSets, setDataSets] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setSaving(true); setError(""); setNotice("");
    try {
      await api.saveDhis2Connection(token, form);
      setForm((f) => ({ ...f, secret: "" }));
      setNotice("Connection saved.");
      onSaved();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }

  async function test() {
    setTesting(true); setError(""); setTestResult(null);
    try {
      setTestResult(await api.testDhis2(token));
      setDataSets(await api.listDhis2DataSets(token));
    } catch (err) { setError(err.message); } finally { setTesting(false); }
  }

  const dirty = form.base_url !== connection.base_url || form.auth_type !== connection.auth_type
    || form.username !== connection.username || form.secret !== "" || form.data_set_uid !== connection.data_set_uid;

  return (
    <Card
      title="Connect to DHIS2"
      description="IDTS sends each month's immunization counts to your DHIS2 instance (the national HMIS). Use a DHIS2 account created for this purpose, with permission to enter data for the facilities you link. A personal access token is safer than a password: it can be limited and withdrawn in DHIS2 without changing anyone's sign-in."
    >
      {connection.secret_unreadable && (
        <Notice tone="warn">The saved password or token can no longer be read (the server's secret key changed). Enter it again.</Notice>
      )}
      <div className="settings-grid" style={{ marginBottom: 16 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <Label>DHIS2 address</Label>
          <TextInput value={form.base_url} onChange={set("base_url")} placeholder="https://hmis.example.org" inputMode="url" />
        </div>
        <div>
          <Label>Sign in with</Label>
          <SelectInput value={form.auth_type} onChange={set("auth_type")}>
            <option value="token">Personal access token (recommended)</option>
            <option value="basic">Username and password</option>
          </SelectInput>
        </div>
        {form.auth_type === "basic" && (
          <div>
            <Label>DHIS2 username</Label>
            <TextInput value={form.username} onChange={set("username")} autoComplete="off" />
          </div>
        )}
        <div>
          <Label>{form.auth_type === "basic" ? "Password" : "Access token"}</Label>
          <TextInput
            type="password" value={form.secret} onChange={set("secret")} autoComplete="new-password"
            placeholder={connection.has_secret ? "Saved. Leave blank to keep it" : form.auth_type === "basic" ? "" : "d2pat_…"}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <PrimaryButton onClick={save} disabled={!dirty || saving || !form.base_url}>{saving ? "Saving…" : "Save connection"}</PrimaryButton>
        <SecondaryButton onClick={test} disabled={testing || dirty || !connection.base_url} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <PlugZap size={18} /> {testing ? "Testing…" : "Test connection"}
        </SecondaryButton>
        {dirty && connection.base_url && <span style={{ alignSelf: "center", fontSize: 14, color: COLORS.muted }}>Save before testing.</span>}
      </div>

      {notice && <Notice tone="ok">{notice}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {testResult && (
        <Notice tone={testResult.can_send_data ? "ok" : "warn"}>
          Connected to <strong>{testResult.server_name || "DHIS2"}</strong> (version {testResult.version}) as <strong>{testResult.display_name || testResult.username}</strong>.
          {!testResult.can_send_data && " This account can't enter data values yet. Give it the \"Add data value\" authority in DHIS2 before sending."}
        </Notice>
      )}

      <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 16 }}>
        <Label>Data set</Label>
        <p style={{ fontSize: 15, color: COLORS.muted, margin: "0 0 10px", lineHeight: 1.5 }}>
          The DHIS2 data set that holds monthly EPI figures. Its data elements are offered in the Vaccines step.
        </p>
        {dataSets ? (
          <SelectInput
            value={form.data_set_uid}
            onChange={(e) => {
              const ds = dataSets.find((d) => d.id === e.target.value);
              setForm((f) => ({ ...f, data_set_uid: e.target.value, data_set_name: ds?.name || "" }));
            }}
            style={{ maxWidth: 520 }}
          >
            <option value="">Choose a data set</option>
            {dataSets.map((d) => <option key={d.id} value={d.id}>{d.name}{d.period_type ? ` (${d.period_type})` : ""}</option>)}
          </SelectInput>
        ) : (
          <p style={{ fontSize: 15, margin: 0 }}>
            {connection.data_set_uid
              ? <><strong>{connection.data_set_name || connection.data_set_uid}</strong> <span style={{ color: COLORS.muted }}>· test the connection to change it</span></>
              : <span style={{ color: COLORS.muted }}>Test the connection to choose one.</span>}
          </p>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- facilities

function OrgUnitSearch({ token, facility, onPick, onClose }) {
  const [q, setQ] = useState(facility.name);
  const [results, setResults] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState("");

  const search = useCallback(async (term) => {
    if (term.trim().length < 2) return;
    setBusy(true); setError("");
    try { setResults(await api.searchDhis2OrgUnits(token, term.trim())); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }, [token]);

  useEffect(() => { search(facility.name); }, [facility.name, search]);

  return (
    <Modal title={`Link ${facility.name}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); search(q); }} style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <TextInput value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search DHIS2 organisation units" placeholder="Name or id" />
        <PrimaryButton type="submit" disabled={busy}><Search size={18} /></PrimaryButton>
      </form>
      {error && <ErrorText>{error}</ErrorText>}
      {busy && <p style={{ color: COLORS.muted, fontSize: 15 }}>Searching DHIS2…</p>}
      {results && !busy && (
        results.length === 0 ? (
          <p style={{ color: COLORS.muted, fontSize: 15 }}>No organisation units match. Try a shorter part of the name.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, border: `1px solid ${COLORS.border}`, borderRadius: 10 }}>
            {results.map((ou, i) => (
              <li key={ou.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderTop: i ? `1px solid ${COLORS.border}` : "none" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>{ou.name}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 14, color: COLORS.muted }}>
                    {[ou.parent, ou.level ? `level ${ou.level}` : null, ou.id].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <SecondaryButton onClick={() => onPick({ id: ou.id, name: ou.name })} style={{ padding: "6px 14px", minHeight: 40 }}>Link</SecondaryButton>
              </li>
            ))}
          </ul>
        )
      )}
      <div style={{ borderTop: `1px solid ${COLORS.border}`, marginTop: 16, paddingTop: 14 }}>
        <Label>Or enter the organisation unit id</Label>
        <div style={{ display: "flex", gap: 8 }}>
          <TextInput value={manual} onChange={(e) => setManual(e.target.value.trim())} placeholder="11 letters and digits" />
          <SecondaryButton onClick={() => onPick({ id: manual, name: "" })} disabled={!/^[A-Za-z][A-Za-z0-9]{10}$/.test(manual)}>Link</SecondaryButton>
        </div>
      </div>
    </Modal>
  );
}

function FacilitiesTab({ token, facilities, connected, onSaved }) {
  const [picking, setPicking] = useState(null);
  const [error, setError] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");

  async function save(items) {
    setError("");
    try { await api.saveDhis2OrgUnits(token, items); onSaved(); } catch (err) { setError(err.message); }
  }

  // Proposes the DHIS2 unit whose name matches exactly (ignoring case and
  // punctuation) for each unlinked facility; nothing is linked until confirmed.
  async function suggest() {
    setSuggesting(true); setError("");
    try {
      const found = await api.suggestDhis2OrgUnits(token);
      setSuggestions(found.map((x) => ({ facility: { id: x.facility_id, name: x.facility }, target: { id: x.id, name: x.name }, parent: x.parent })));
    } catch (err) { setError(err.message); } finally { setSuggesting(false); }
  }

  const linked = facilities.filter((f) => f.org_unit).length;
  const q = query.trim().toLowerCase();
  const shown = facilities
    .filter((f) => filter === "all" || (filter === "unlinked" ? !f.org_unit : !!f.org_unit))
    .filter((f) => !q || f.name.toLowerCase().includes(q) || (f.org_unit?.name || "").toLowerCase().includes(q));

  return (
    <Card
      title="Link facilities to DHIS2 organisation units"
      description="Doses are reported against the facility where they were given. A facility that isn't linked is left out of the export and listed as a warning."
      actions={(
        <SecondaryButton onClick={suggest} disabled={!connected || suggesting || linked === facilities.length} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={18} /> {suggesting ? "Looking up names…" : "Suggest matches by name"}
        </SecondaryButton>
      )}
    >
      {!connected && <Notice tone="warn">Save and test the connection first to search DHIS2.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {suggestions && (
        <Notice tone={suggestions.length ? "info" : "warn"}>
          {suggestions.length === 0 ? "No exact name matches found. Link the remaining facilities one by one." : (
            <>
              <p style={{ margin: "0 0 8px", fontWeight: 600 }}>{suggestions.length} exact name match{suggestions.length === 1 ? "" : "es"} found. Check them, then link:</p>
              <ul style={{ margin: "0 0 10px", paddingLeft: 20, maxHeight: 240, overflowY: "auto" }}>
                {suggestions.map((s) => <li key={s.facility.id}>{s.facility.name} → {s.target.name}{s.parent ? ` (${s.parent})` : ""}</li>)}
              </ul>
              <div style={{ display: "flex", gap: 8 }}>
                <PrimaryButton onClick={async () => { await save(Object.fromEntries(suggestions.map((s) => [s.facility.id, s.target]))); setSuggestions(null); }}>
                  Link all {suggestions.length}
                </PrimaryButton>
                <SecondaryButton onClick={() => setSuggestions(null)}>Dismiss</SecondaryButton>
              </div>
            </>
          )}
        </Notice>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ flex: "1 1 260px", maxWidth: 360 }}>
          <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search facilities" aria-label="Search facilities" />
        </div>
        {[["all", `All (${facilities.length})`], ["unlinked", `Not linked (${facilities.length - linked})`], ["linked", `Linked (${linked})`]].map(([v, l]) => (
          <button key={v} type="button" onClick={() => setFilter(v)} aria-pressed={filter === v} className="chip"
            style={{ minHeight: 38, padding: "0 14px", borderRadius: 999, fontSize: 15, fontWeight: 600, cursor: "pointer", border: `1.5px solid ${filter === v ? COLORS.primary : COLORS.inputBorder}`, backgroundColor: filter === v ? COLORS.primaryTint : COLORS.white, color: filter === v ? COLORS.primaryDark : COLORS.ink }}>
            {l}
          </button>
        ))}
      </div>

      <div style={{ overflowX: "auto", border: `1px solid ${COLORS.border}`, borderRadius: 12 }}>
        <table className="data-table middle">
          <thead><tr><th>IDTS facility</th><th>DHIS2 organisation unit</th><th style={{ width: 1 }} aria-label="Actions" /></tr></thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={3} style={{ textAlign: "center", color: COLORS.muted, padding: "28px 16px" }}>No facilities match.</td></tr>
            )}
            {shown.slice(0, 200).map((f) => (
              <tr key={f.id}>
                <td style={{ fontWeight: 600 }}>{f.name}</td>
                <td>
                  {f.org_unit ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <CheckCircle2 size={18} color={COLORS.protect} aria-hidden="true" />
                      <span>{f.org_unit.name || "Linked"} <span style={{ color: COLORS.muted }}>· {f.org_unit.id}</span></span>
                    </span>
                  ) : <span style={{ color: "#8F3305", fontWeight: 600 }}>Not linked</span>}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <SecondaryButton onClick={() => setPicking(f)} disabled={!connected} style={{ padding: "6px 14px", minHeight: 40, display: "flex", alignItems: "center", gap: 6 }}>
                      <Link2 size={16} /> {f.org_unit ? "Change" : "Link"}
                    </SecondaryButton>
                    {f.org_unit && (
                      <button type="button" onClick={() => save({ [f.id]: null })} aria-label={`Unlink ${f.name}`} title="Unlink"
                        style={{ width: 40, height: 40, borderRadius: 8, border: `1.5px solid ${COLORS.inputBorder}`, background: COLORS.white, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Link2Off size={17} color={COLORS.muted} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length > 200 && (
        <p style={{ fontSize: 14, color: COLORS.muted, margin: "10px 0 0" }}>Showing 200 of {shown.length}. Search to narrow the list.</p>
      )}
      {picking && (
        <OrgUnitSearch
          token={token}
          facility={picking}
          onClose={() => setPicking(null)}
          onPick={async (target) => { await save({ [picking.id]: target }); setPicking(null); }}
        />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- vaccines

function VaccinesTab({ token, doses, connection, connected, onSaved }) {
  const [elements, setElements] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [rows, setRows] = useState(() => Object.fromEntries(doses.map((d) => [d.id, { data_element: "", coc: "", coc_over1: "", ...(d.mapping || {}) }])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!connected || !connection.data_set_uid) return;
    api.listDhis2DataElements(token).then(setElements).catch((err) => setLoadError(err.message));
  }, [token, connected, connection.data_set_uid]);

  const byId = useMemo(() => Object.fromEntries((elements || []).map((e) => [e.id, e])), [elements]);
  const original = useMemo(() => Object.fromEntries(doses.map((d) => [d.id, d.mapping || {}])), [doses]);
  const changed = doses.filter((d) => {
    const a = original[d.id]; const b = rows[d.id];
    return (a.data_element || "") !== (b.data_element || "") || (a.coc || "") !== (b.coc || "") || (a.coc_over1 || "") !== (b.coc_over1 || "");
  });

  function update(id, patch) {
    setNotice("");
    setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  }

  async function save() {
    setSaving(true); setError(""); setNotice("");
    try {
      const body = Object.fromEntries(changed.map((d) => {
        const r = rows[d.id];
        if (!r.data_element) return [d.id, null];
        const de = byId[r.data_element];
        const comboName = (id) => de?.category_option_combos.find((c) => c.id === id)?.name || "";
        return [d.id, {
          data_element: r.data_element, data_element_name: de?.name || r.data_element_name || "",
          coc: r.coc || null, coc_name: comboName(r.coc), coc_over1: r.coc_over1 || null, coc_over1_name: comboName(r.coc_over1),
        }];
      }));
      await api.saveDhis2Doses(token, body);
      setNotice(`Saved ${changed.length} dose${changed.length === 1 ? "" : "s"}.`);
      onSaved();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }

  const mapped = doses.filter((d) => rows[d.id].data_element).length;
  const useSelects = !!elements;

  return (
    <Card
      title="Match each dose to a DHIS2 data element"
      description="Choose where each dose is counted in DHIS2. Most EPI data sets split doses by age: pick the under-12-months option, and the 12-months-and-older option if the data set has one. Leave a dose blank to keep it out of the export."
    >
      {!connected && <Notice tone="warn">Save and test the connection first.</Notice>}
      {connected && !connection.data_set_uid && <Notice tone="warn">Choose a data set in the Connection step to pick data elements from a list.</Notice>}
      {loadError && <Notice tone="warn">Couldn't load data elements ({loadError}). You can still enter ids by hand.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      <div style={{ overflowX: "auto", border: `1px solid ${COLORS.border}`, borderRadius: 12 }}>
        <table className="data-table middle">
          <thead>
            <tr><th>Dose</th><th>DHIS2 data element</th><th>Under 12 months</th><th>12 months and older</th></tr>
          </thead>
          <tbody>
            {doses.map((d) => {
              const r = rows[d.id];
              const combos = byId[r.data_element]?.category_option_combos || [];
              return (
                <tr key={d.id}>
                  <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{d.antigen} {d.dose_number}</td>
                  <td style={{ minWidth: 220 }}>
                    {useSelects ? (
                      <SelectInput aria-label={`Data element for ${d.antigen} ${d.dose_number}`} value={r.data_element}
                        onChange={(e) => {
                          const cs = byId[e.target.value]?.category_option_combos || [];
                          const guess = (re) => cs.find((c) => re.test(c.name))?.id || "";
                          update(d.id, {
                            data_element: e.target.value,
                            coc: cs.length === 1 ? cs[0].id : guess(/(<|under|less).{0,6}(1|12)|0-11/i),
                            coc_over1: guess(/(>|over|1\+|plus|12.?m.*(above|older)|1-?\d+ ?y)/i),
                          });
                        }}>
                        <option value="">Not sent</option>
                        {r.data_element && !byId[r.data_element] && <option value={r.data_element}>{r.data_element_name || r.data_element}</option>}
                        {elements.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                      </SelectInput>
                    ) : (
                      <TextInput aria-label={`Data element id for ${d.antigen} ${d.dose_number}`} value={r.data_element} placeholder={r.data_element_name || "Data element id"}
                        onChange={(e) => update(d.id, { data_element: e.target.value.trim() })} />
                    )}
                  </td>
                  {["coc", "coc_over1"].map((key) => (
                    <td key={key} style={{ minWidth: 180 }}>
                      {useSelects && byId[r.data_element] ? (
                        <SelectInput aria-label={`${key === "coc" ? "Under 12 months" : "12 months and older"} option for ${d.antigen} ${d.dose_number}`}
                          value={r[key] || ""} onChange={(e) => update(d.id, { [key]: e.target.value })}>
                          <option value="">{key === "coc" ? "Default" : "Same as under 12 months"}</option>
                          {combos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </SelectInput>
                      ) : (
                        <TextInput aria-label={`${key === "coc" ? "Under 12 months" : "12 months and older"} option id for ${d.antigen} ${d.dose_number}`}
                          value={r[key] || ""} disabled={!r.data_element} placeholder={r[`${key}_name`] || (key === "coc" ? "Default" : "Same as under 12")}
                          onChange={(e) => update(d.id, { [key]: e.target.value.trim() })} />
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
        <PrimaryButton onClick={save} disabled={!changed.length || saving}>{saving ? "Saving…" : changed.length ? `Save ${changed.length} change${changed.length === 1 ? "" : "s"}` : "Save"}</PrimaryButton>
        <span style={{ fontSize: 15, color: COLORS.muted }}>{mapped} of {doses.length} doses matched</span>
        {notice && <span role="status" style={{ fontSize: 15, color: COLORS.protect, fontWeight: 600 }}>{notice}</span>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- send

function SendTab({ token, connected, history, onSent }) {
  const months = useMemo(monthOptions, []);
  const [period, setPeriod] = useState(months[1].value);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setLoading(true); setError(""); setResult(null);
    api.previewDhis2Export(token, period).then(setPreview).catch((err) => { setPreview(null); setError(err.message); }).finally(() => setLoading(false));
  }, [token, period]);

  async function push(dryRun) {
    setBusy(dryRun ? "test" : "send"); setError(""); setResult(null); setConfirming(false);
    try { setResult(await api.pushDhis2Export(token, period, dryRun)); onSent(); } catch (err) { setError(err.message); } finally { setBusy(""); }
  }

  async function downloadFile() {
    setBusy("download"); setError("");
    try { await api.downloadDhis2Export(token, period); } catch (err) { setError(err.message); } finally { setBusy(""); }
  }

  const monthLabel = months.find((m) => m.value === period)?.label;
  const values = preview?.payload.dataValues.length || 0;
  const tone = result && STATUS_TONE[result.status];

  return (
    <>
      <Card
        title="Send monthly immunization data"
        description="Counts every dose given in the month at each linked facility, split by the child's age on the day. Sending again for the same month replaces the earlier figures in DHIS2, so corrections are safe to resend."
      >
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 18 }}>
          <div style={{ minWidth: 220 }}>
            <Label>Month</Label>
            <SelectInput value={period} onChange={(e) => setPeriod(e.target.value)}>
              {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </SelectInput>
          </div>
        </div>

        {loading && <p style={{ color: COLORS.muted }}>Counting doses…</p>}
        {error && <Notice tone="error">{error}</Notice>}
        {preview && !loading && (
          <>
            <div className="dhis2-stats">
              {[
                ["Doses given", preview.doses_counted],
                ["Ready to send", preview.doses_mappable],
                ["DHIS2 values", values],
              ].map(([label, value]) => (
                <div key={label} style={{ border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "12px 16px" }}>
                  <p style={{ margin: 0, fontSize: 14, color: COLORS.muted, fontWeight: 600 }}>{label}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 26, fontWeight: 700 }}>{value.toLocaleString()}</p>
                </div>
              ))}
            </div>
            {preview.unmapped_facilities.length > 0 && (
              <Notice tone="warn">
                Left out because the facility isn't linked: {preview.unmapped_facilities.map((f) => `${f.name} (${f.doses})`).join(", ")}.
              </Notice>
            )}
            {preview.unmapped_doses.length > 0 && (
              <Notice tone="warn">
                Left out because the dose isn't matched to a data element: {preview.unmapped_doses.map((d) => `${d.name} (${d.doses})`).join(", ")}.
              </Notice>
            )}
            {preview.doses_counted === 0 && <Notice tone="info">No doses were recorded in {monthLabel}.</Notice>}

            {preview.rows.length > 0 && (
              <details style={{ marginBottom: 16 }}>
                <summary style={{ cursor: "pointer", fontSize: 16, fontWeight: 600, color: COLORS.primary, padding: "6px 0" }}>Show the {preview.rows.length} counts</summary>
                <div style={{ overflowX: "auto", border: `1px solid ${COLORS.border}`, borderRadius: 12, marginTop: 8 }}>
                  <table className="data-table">
                    <thead><tr><th>Facility</th><th>Dose</th><th>Age group</th><th style={{ textAlign: "right" }}>Doses</th><th>DHIS2</th></tr></thead>
                    <tbody>
                      {preview.rows.map((r, i) => (
                        <tr key={i}>
                          <td>{r.facility}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{r.dose}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{r.age_group}</td>
                          <td style={{ textAlign: "right", fontWeight: 700 }}>{r.count}</td>
                          <td style={{ whiteSpace: "nowrap", color: r.status === "ok" ? COLORS.muted : "#8F3305", fontWeight: r.status === "ok" ? 400 : 600 }}>
                            {r.status === "ok" ? (r.data_element_name || r.data_element) : r.status === "facility_not_mapped" ? "Facility not linked" : "Dose not matched"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <PrimaryButton onClick={() => setConfirming(true)} disabled={!connected || !values || !!busy}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Send size={18} /> {busy === "send" ? "Sending…" : "Send to DHIS2"}</span>
              </PrimaryButton>
              <SecondaryButton onClick={() => push(true)} disabled={!connected || !values || !!busy}>
                {busy === "test" ? "Checking…" : "Test send (no changes)"}
              </SecondaryButton>
              <SecondaryButton onClick={downloadFile} disabled={!values || !!busy} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Download size={18} /> {busy === "download" ? "Preparing…" : "Download file"}
              </SecondaryButton>
            </div>
            {!connected && values > 0 && (
              <p style={{ fontSize: 14, color: COLORS.muted, margin: "10px 0 0" }}>
                Not connected: download the file and import it in DHIS2's Import/Export app instead.
              </p>
            )}
          </>
        )}

        {result && tone && (
          <div style={{ marginTop: 18, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, backgroundColor: tone.bg }}>
            <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: tone.color }}>
              {result.dry_run ? "Test send: " : ""}{tone.label}
            </p>
            <p style={{ margin: "6px 0 0", fontSize: 15 }}>
              {result.values_sent} values sent · {result.imported} new · {result.updated} updated · {result.ignored} ignored
              {result.dry_run ? ". Nothing was saved in DHIS2." : "."}
            </p>
            {result.conflicts.length > 0 && (
              <ul style={{ margin: "10px 0 0", paddingLeft: 20, fontSize: 15 }}>
                {result.conflicts.map((c, i) => <li key={i}><strong>{c.object}</strong>: {c.value}</li>)}
              </ul>
            )}
          </div>
        )}
      </Card>

      <Card title="Send history" description="The last 20 sends and test sends, with what DHIS2 reported back.">
        {history.length === 0 ? <p style={{ color: COLORS.muted, margin: 0 }}>Nothing sent yet.</p> : (
          <div style={{ overflowX: "auto", border: `1px solid ${COLORS.border}`, borderRadius: 12 }}>
            <table className="data-table">
              <thead><tr><th>When</th><th>Month</th><th>Type</th><th>Result</th><th style={{ textAlign: "right" }}>Values</th><th>By</th></tr></thead>
              <tbody>
                {history.map((h) => {
                  const t = STATUS_TONE[h.status] || STATUS_TONE.error;
                  const m = `${h.period.slice(0, 4)}-${h.period.slice(4)}`;
                  return (
                    <tr key={h.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtWhen(h.created_at)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</td>
                      <td>{h.dry_run ? "Test" : "Send"}</td>
                      <td>
                        <span style={{ fontSize: 14, fontWeight: 700, padding: "2px 10px", borderRadius: 999, color: t.color, backgroundColor: t.bg, whiteSpace: "nowrap" }}>{t.label}</span>
                        {h.status === "error" && h.message && <span style={{ display: "block", fontSize: 14, color: COLORS.muted, marginTop: 4 }}>{h.message}</span>}
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{h.values_sent} <span style={{ color: COLORS.muted }}>({h.imported} new, {h.updated} upd.)</span></td>
                      <td>{h.by || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {confirming && (
        <Modal title={`Send ${monthLabel} to DHIS2?`} onClose={() => setConfirming(false)}>
          <p style={{ fontSize: 16, lineHeight: 1.55, margin: "0 0 16px" }}>
            {values} values go to DHIS2 for {monthLabel}. Figures already there for the same facilities and data elements are replaced.
            {(preview.unmapped_facilities.length > 0 || preview.unmapped_doses.length > 0) && " Some doses are left out (see the warnings)."}
          </p>
          <div style={{ display: "flex", gap: 12 }}>
            <SecondaryButton onClick={() => setConfirming(false)} style={{ flex: 1 }}>Cancel</SecondaryButton>
            <PrimaryButton onClick={() => push(false)} style={{ flex: 1 }}>Send</PrimaryButton>
          </div>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- page

export default function Dhis2Page({ token }) {
  const [config, setConfig] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("connection");

  const load = useCallback(async () => {
    try {
      const next = await api.getDhis2Config(token);
      setConfig(next);
      return next;
    } catch (err) { setError(err.message); return null; }
  }, [token]);

  useEffect(() => {
    load().then((c) => { if (c && c.connection.base_url && c.connection.has_secret) setTab("send"); });
  }, [load]);

  if (!config) {
    return <div style={{ maxWidth: CONTENT_MAX_WIDTH, margin: "0 auto" }}>{error ? <ErrorText>{error}</ErrorText> : <p style={{ color: COLORS.muted }}>Loading…</p>}</div>;
  }

  const connected = !!(config.connection.base_url && config.connection.has_secret);
  const linked = config.facilities.filter((f) => f.org_unit).length;
  const matched = config.doses.filter((d) => d.mapping?.data_element).length;
  const lastSend = config.history.find((h) => !h.dry_run && h.status !== "error");
  const steps = {
    connection: connected,
    facilities: linked > 0,
    vaccines: matched > 0,
    send: !!lastSend,
  };

  return (
    <div style={{ maxWidth: CONTENT_MAX_WIDTH, margin: "0 auto" }}>
      <p style={{ fontSize: 16, color: COLORS.muted, margin: "0 0 18px", maxWidth: 800, lineHeight: 1.55 }}>
        Report immunization figures to DHIS2 without retyping them. IDTS sends monthly dose counts per facility as aggregate
        data; no child's name or details leave IDTS. Every change and send is recorded in the activity log.
      </p>

      <div className="dhis2-summary">
        {[
          ["Connection", connected ? (config.connection.base_url.replace(/^https?:\/\//, "")) : "Not set up", connected],
          ["Facilities linked", `${linked} of ${config.facilities.length}`, linked === config.facilities.length && linked > 0],
          ["Doses matched", `${matched} of ${config.doses.length}`, matched > 0],
          ["Last sent", lastSend ? fmtWhen(lastSend.created_at) : "Never", !!lastSend],
        ].map(([label, value, ok]) => (
          <div key={label} style={{ backgroundColor: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "12px 16px", minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 14, color: COLORS.muted, fontWeight: 600 }}>{label}</p>
            <p style={{ margin: "2px 0 0", fontSize: 17, fontWeight: 700, color: ok ? COLORS.ink : "#8F3305", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</p>
          </div>
        ))}
      </div>

      <div role="tablist" aria-label="DHIS2 setup steps" className="dhis2-tabs">
        {TABS.map((t) => (
          <button key={t.value} role="tab" type="button" aria-selected={tab === t.value} onClick={() => setTab(t.value)}
            className={`dhis2-tab${tab === t.value ? " active" : ""}`}>
            {steps[t.value] && <CheckCircle2 size={17} aria-hidden="true" />} {t.label}
          </button>
        ))}
      </div>

      {tab === "connection" && <ConnectionTab key={JSON.stringify(config.connection)} token={token} connection={config.connection} onSaved={load} />}
      {tab === "facilities" && <FacilitiesTab token={token} facilities={config.facilities} connected={connected} onSaved={load} />}
      {tab === "vaccines" && <VaccinesTab key={JSON.stringify(config.doses.map((d) => d.mapping))} token={token} doses={config.doses} connection={config.connection} connected={connected} onSaved={load} />}
      {tab === "send" && <SendTab token={token} connected={connected} history={config.history} onSent={load} />}
    </div>
  );
}
