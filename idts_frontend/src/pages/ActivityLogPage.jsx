import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Download, Search } from "lucide-react";
import { api } from "../api/client.js";
import { COLORS, CONTENT_MAX_WIDTH } from "../constants.js";
import { ErrorText, Label, SecondaryButton, SelectInput, TextInput } from "../components/ui.jsx";

const PAGE_SIZE = 50;

// Plain-language names for the codes the backend records.
const ACTION_LABELS = {
  login: "Signed in",
  login_failed: "Failed sign-in",
  login_blocked: "Sign-in refused",
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  deactivate: "Deactivated",
  activate: "Reactivated",
  password_change: "Changed password",
  password_reset: "Reset password",
  unlock: "Unlocked account",
  assign: "Assigned case",
  trace: "Tracing attempt",
  close: "Closed case",
  export: "Exported",
  "aefi.create": "Reported AEFI",
  "aefi.update": "Updated AEFI",
};

const ENTITY_LABELS = {
  auth: "Sign-in",
  user: "User accounts",
  child: "Children",
  vaccination: "Vaccinations",
  defaulter_case: "Defaulter follow-up",
  aefi_event: "AEFI",
  security_settings: "Security settings",
  system_settings: "System settings",
  audit_log: "Activity log",
  dhis2: "DHIS2",
};

// Security-relevant events get a warning tone so they stand out when scanning.
const ALERT_ACTIONS = new Set(["login_failed", "login_blocked", "delete", "deactivate", "password_reset"]);

function fmtTimestamp(iso) {
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  return {
    date: d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
    time: d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
  };
}

function ActionPill({ action }) {
  const alert = ALERT_ACTIONS.has(action);
  return (
    <span style={{
      display: "inline-block", fontSize: 14, fontWeight: 700, padding: "2px 10px", borderRadius: 999, whiteSpace: "nowrap",
      color: alert ? COLORS.danger : COLORS.primaryDark, backgroundColor: alert ? COLORS.dangerTint : COLORS.primaryTint,
    }}>
      {ACTION_LABELS[action] || action}
    </span>
  );
}

function ChangeDetails({ before, after }) {
  const keys = Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})]));
  if (keys.length === 0) return null;
  const show = (v) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return (
    <table className="data-table" style={{ fontSize: 14, marginTop: 8, backgroundColor: COLORS.white, border: `1px solid ${COLORS.border}` }}>
      <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
      <tbody>
        {keys.map((k) => (
          <tr key={k}>
            <td style={{ fontWeight: 600 }}>{k.replace(/_/g, " ")}</td>
            <td>{show(before?.[k])}</td>
            <td>{show(after?.[k])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ActivityLogPage({ token }) {
  const [filters, setFilters] = useState({ q: "", entity: "", action: "", start_date: "", end_date: "" });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(0);
  const [data, setData] = useState({ total: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await api.listAuditLogs(token, { ...applied, limit: PAGE_SIZE, offset: page * PAGE_SIZE }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token, applied, page]);

  useEffect(() => { load(); }, [load]);

  function apply(e) {
    e?.preventDefault();
    setPage(0);
    setApplied(filters);
  }

  function clear() {
    const empty = { q: "", entity: "", action: "", start_date: "", end_date: "" };
    setFilters(empty);
    setPage(0);
    setApplied(empty);
  }

  async function exportCsv() {
    setExporting(true);
    setError("");
    try {
      await api.exportAuditLogs(token, applied);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const hasFilters = Object.values(applied).some(Boolean);

  return (
    <div style={{ maxWidth: CONTENT_MAX_WIDTH, margin: "0 auto" }}>
      <p style={{ fontSize: 16, color: COLORS.muted, margin: "0 0 20px", maxWidth: 760 }}>
        Every sign-in, account change, record edit and settings change, newest first. Entries can't be edited or
        deleted. Children appear by their IDTS number, never by name.
      </p>

      <form
        onSubmit={apply}
        style={{ backgroundColor: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 14, padding: 20, marginBottom: 20 }}
      >
        <div className="activity-filters">
          <div style={{ minWidth: 0 }}>
            <Label>Search</Label>
            <TextInput value={filters.q} onChange={set("q")} placeholder="Username, name or description" />
          </div>
          <div>
            <Label>Area</Label>
            <SelectInput value={filters.entity} onChange={set("entity")}>
              <option value="">All areas</option>
              {Object.entries(ENTITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </SelectInput>
          </div>
          <div>
            <Label>Action</Label>
            <SelectInput value={filters.action} onChange={set("action")}>
              <option value="">All actions</option>
              {Object.entries(ACTION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </SelectInput>
          </div>
          <div>
            <Label>From</Label>
            <TextInput type="date" value={filters.start_date} onChange={set("start_date")} />
          </div>
          <div>
            <Label>To</Label>
            <TextInput type="date" value={filters.end_date} onChange={set("end_date")} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          <button
            type="submit"
            className="btn-primary"
            style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, padding: "0 20px", borderRadius: 10, fontSize: 16, fontWeight: 600, color: COLORS.white, backgroundColor: COLORS.primary, border: "none", cursor: "pointer" }}
          >
            <Search size={18} /> Apply filters
          </button>
          {hasFilters && <SecondaryButton onClick={clear}>Clear</SecondaryButton>}
          <SecondaryButton onClick={exportCsv} style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <Download size={18} /> {exporting ? "Preparing…" : "Download CSV"}
          </SecondaryButton>
        </div>
      </form>

      {error && <div style={{ marginBottom: 16 }}><ErrorText>{error}</ErrorText></div>}

      <div style={{ backgroundColor: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 14, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${COLORS.border}`, fontSize: 15, color: COLORS.muted }}>
          {loading ? "Loading…" : `${data.total.toLocaleString()} ${data.total === 1 ? "entry" : "entries"}${hasFilters ? " match these filters" : ""}`}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 36 }} aria-label="Details" />
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Area</th>
                <th>Description</th>
                <th>IP address</th>
              </tr>
            </thead>
            <tbody>
              {!loading && data.items.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: "40px 16px", color: COLORS.muted }}>
                  {hasFilters ? "No activity matches these filters. Try a wider date range." : "No activity recorded yet."}
                </td></tr>
              )}
              {data.items.map((row) => {
                const ts = fmtTimestamp(row.timestamp);
                const hasDetails = row.before || row.after;
                const open = expanded === row.id;
                return (
                  <React.Fragment key={row.id}>
                    <tr className="list-row" style={{ cursor: hasDetails ? "pointer" : "default" }} onClick={() => hasDetails && setExpanded(open ? null : row.id)}>
                      <td>
                        {hasDetails && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setExpanded(open ? null : row.id); }}
                            aria-label={open ? "Hide changes" : "Show changes"}
                            aria-expanded={open}
                            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex", color: COLORS.primary }}
                          >
                            {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                          </button>
                        )}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <span style={{ display: "block", fontWeight: 600 }}>{ts.date}</span>
                        <span style={{ color: COLORS.muted }}>{ts.time}</span>
                      </td>
                      <td style={{ minWidth: 140 }}>
                        <span style={{ display: "block", fontWeight: 600 }}>{row.actor_name || row.actor_username || "Unknown"}</span>
                        {row.actor_username && <span style={{ color: COLORS.muted }}>@{row.actor_username}</span>}
                      </td>
                      <td><ActionPill action={row.action} /></td>
                      <td style={{ whiteSpace: "nowrap" }}>{ENTITY_LABELS[row.entity] || row.entity}</td>
                      <td style={{ minWidth: 220 }}>{row.summary || "—"}</td>
                      <td style={{ color: COLORS.muted, whiteSpace: "nowrap" }}>{row.ip_address || "—"}</td>
                    </tr>
                    {open && (
                      <tr>
                        <td />
                        <td colSpan={6} style={{ backgroundColor: COLORS.subtleBg }}>
                          <ChangeDetails before={row.before} after={row.after} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {data.total > PAGE_SIZE && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderTop: `1px solid ${COLORS.border}` }}>
            <SecondaryButton onClick={() => setPage((p) => Math.max(0, p - 1))} style={{ opacity: page === 0 ? 0.5 : 1 }}>
              Newer
            </SecondaryButton>
            <span style={{ fontSize: 15, color: COLORS.muted }}>Page {page + 1} of {pages}</span>
            <SecondaryButton onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} style={{ opacity: page >= pages - 1 ? 0.5 : 1 }}>
              Older
            </SecondaryButton>
          </div>
        )}
      </div>
    </div>
  );
}
