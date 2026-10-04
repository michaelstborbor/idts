import React, { useState } from "react";
import { Search, ShieldCheck, Users, X } from "lucide-react";
import { api } from "../api/client.js";
import { COLORS, CONTENT_MAX_WIDTH, ageLabel } from "../constants.js";
import { ErrorText, Label, PrimaryButton, TextInput } from "../components/ui.jsx";
import { StatusBadge } from "../components/ui.jsx";

/**
 * Trained first step before registering a child: search by name, system
 * ID, date of birth or caregiver name. Scoped on the backend to the
 * searcher's whole DISTRICT (wider than their everyday facility/chiefdom
 * access — see district_search_scope_facility_ids in app/core/scope.py),
 * so a child who moved facilities within the district is still found
 * before a duplicate gets registered. Results show full detail so the
 * searcher can judge whether it's really the same child — deliberately
 * not a link into the normal child profile page, since a match outside
 * the searcher's everyday access would 404 there; this search response
 * IS the full record, shown inline.
 */
function SearchForChildPane({ token, onSearched }) {
  const [name, setName] = useState("");
  const [systemId, setSystemId] = useState("");
  const [dob, setDob] = useState("");
  const [caregiverName, setCaregiverName] = useState("");
  const [results, setResults] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function search() {
    if (!name.trim() && !systemId.trim() && !dob && !caregiverName.trim()) {
      return setError("Enter at least a name, ID, date of birth, or caregiver name.");
    }
    setError("");
    setLoading(true);
    try {
      const found = await api.searchChildren(token, {
        name: name.trim() || undefined,
        systemId: systemId.trim() || undefined,
        dob: dob || undefined,
        caregiverName: caregiverName.trim() || undefined,
      });
      setResults(found);
      onSearched();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ borderRadius: 12, border: `1px solid ${COLORS.border}`, padding: 20, backgroundColor: COLORS.white, marginBottom: 20 }}>
      <p style={{ fontSize: 13, fontWeight: 600, color: COLORS.ink, margin: "0 0 4px" }}>Search for a child</p>
      <p style={{ fontSize: 13, color: COLORS.muted, margin: "0 0 14px" }}>
        Check across the whole district before registering, in case this child already has a record at a different facility.
      </p>
      <div className="responsive-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <Label>Child's name</Label>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fatmata Kamara" />
        </div>
        <div>
          <Label>System ID <span style={{ color: COLORS.muted, fontWeight: 400 }}>(optional)</span></Label>
          <TextInput value={systemId} onChange={(e) => setSystemId(e.target.value)} placeholder="e.g. IDTS-000123" />
        </div>
        <div>
          <Label>Date of birth <span style={{ color: COLORS.muted, fontWeight: 400 }}>(optional)</span></Label>
          <TextInput type="date" value={dob} onChange={(e) => setDob(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
        </div>
        <div>
          <Label>Caregiver name <span style={{ color: COLORS.muted, fontWeight: 400 }}>(optional)</span></Label>
          <TextInput value={caregiverName} onChange={(e) => setCaregiverName(e.target.value)} placeholder="e.g. Mariama Kamara" />
        </div>
      </div>
      <ErrorText>{error}</ErrorText>
      <PrimaryButton onClick={search} disabled={loading} style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Search size={15} /> {loading ? "Searching…" : "Search"}
      </PrimaryButton>

      {results && (
        results.length === 0 ? (
          <p style={{ fontSize: 14, color: COLORS.muted, marginTop: 16 }}>No matching record found in the district. Safe to register.</p>
        ) : (
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: "#8A6A1F", margin: 0 }}>
              {results.length} possible match{results.length > 1 ? "es" : ""} found:
            </p>
            {results.map((c) => (
              <div key={c.id} style={{ padding: "12px 14px", borderRadius: 8, backgroundColor: "#FBF1DC", border: "1px solid #F0DDAE" }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: COLORS.ink, margin: 0 }}>
                  {c.full_name} <span style={{ fontWeight: 400, color: COLORS.muted }}>· {c.system_id}</span>
                  {c.fully_immunized && <span style={{ marginLeft: 8 }}><ShieldCheck size={13} style={{ verticalAlign: "-2px" }} color="#2F6B4F" /></span>}
                </p>
                <p style={{ fontSize: 13, color: COLORS.muted, marginTop: 4, lineHeight: 1.6 }}>
                  {ageLabel(c.dob)} · {c.sex === "F" ? "Female" : "Male"} · {c.facility_name || "Unknown facility"}
                  {c.caregiver_name ? <><br />Caregiver: {c.caregiver_name}{c.caregiver_phone ? ` · ${c.caregiver_phone}` : ""}</> : null}
                  {c.address ? <><br />Address: {c.address}</> : null}
                </p>
              </div>
            ))}
            <p style={{ fontSize: 12, color: COLORS.muted, margin: 0 }}>
              If none of these is the child in front of you, go ahead and register.
            </p>
          </div>
        )
      )}
    </div>
  );
}

export default function ChildrenListPage({ token, children, dueRowsByChildId, fullyImmunizedIds, loading, onOpenChild, onRegisterClick }) {
  const [showSearch, setShowSearch] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  function handleRegisterClick() {
    if (!hasSearched) {
      const proceed = window.confirm(
        "You haven't searched for this child yet. It's best to check for an existing record first, in case they're already registered at a different facility.\n\nContinue to registration anyway?"
      );
      if (!proceed) {
        setShowSearch(true);
        return;
      }
    }
    onRegisterClick();
  }

  if (loading) return <p style={{ textAlign: "center", color: COLORS.muted }}>Loading…</p>;

  const searchAndRegisterBar = (
    <div style={{ maxWidth: CONTENT_MAX_WIDTH, margin: "0 auto 20px", display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button
        onClick={() => setShowSearch((s) => !s)}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 8, fontSize: 14, fontWeight: 500, color: COLORS.ink, backgroundColor: COLORS.white, border: `1px solid ${COLORS.inputBorder}`, cursor: "pointer" }}
      >
        {showSearch ? <X size={15} /> : <Search size={15} />} {showSearch ? "Hide search" : "Search for child"}
      </button>
      <button
        onClick={handleRegisterClick}
        style={{ padding: "10px 16px", borderRadius: 8, fontSize: 14, fontWeight: 500, color: "#fff", backgroundColor: COLORS.primary, border: "none", cursor: "pointer" }}
      >
        Register child
      </button>
    </div>
  );

  if (children.length === 0) {
    return (
      <div>
        {searchAndRegisterBar}
        {showSearch && (
          <div style={{ maxWidth: CONTENT_MAX_WIDTH, margin: "0 auto" }}>
            <SearchForChildPane token={token} onSearched={() => setHasSearched(true)} />
          </div>
        )}
        <div style={{ maxWidth: CONTENT_MAX_WIDTH, margin: "0 auto", textAlign: "center", padding: "64px 0", borderRadius: 12, border: `1px solid ${COLORS.border}` }}>
          <Users size={28} style={{ color: "#B8B2A5", margin: "0 auto" }} />
          <p style={{ marginTop: 12, fontWeight: 500, color: COLORS.ink }}>No children registered yet</p>
          <p style={{ fontSize: 14, color: COLORS.muted, marginTop: 4 }}>
            Register the first child to see auto-calculated due dates.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {searchAndRegisterBar}
      {showSearch && (
        <div style={{ maxWidth: CONTENT_MAX_WIDTH, margin: "0 auto" }}>
          <SearchForChildPane token={token} onSearched={() => setHasSearched(true)} />
        </div>
      )}
      <div style={{ maxWidth: CONTENT_MAX_WIDTH, margin: "0 auto", borderRadius: 12, border: `1px solid ${COLORS.border}`, overflow: "hidden", backgroundColor: COLORS.white }}>
        {children.map((c, i) => {
          const next = dueRowsByChildId ? dueRowsByChildId[c.id] : null;
          const isFullyImmunized = fullyImmunizedIds && fullyImmunizedIds.has(c.id);
          return (
            <button
              key={c.id}
              onClick={() => onOpenChild(c.id)}
              style={{
                width: "100%", textAlign: "left", padding: "14px 16px", display: "flex", alignItems: "center",
                justifyContent: "space-between", gap: 12, background: "none", border: "none", cursor: "pointer",
                borderTop: i === 0 ? "none" : `1px solid ${COLORS.border}`,
              }}
            >
              <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 10 }}>
                {isFullyImmunized && (
                  <span title="Fully Immunized (FIC)" aria-label="Fully Immunized" style={{ flexShrink: 0, display: "flex", backgroundColor: "#2F6B4F", borderRadius: 999, padding: 7 }}>
                    <ShieldCheck size={18} color="#FFFFFF" />
                  </span>
                )}
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontWeight: 500, fontSize: 15, color: COLORS.ink, margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.full_name}</p>
                  <p style={{ fontSize: 14, color: COLORS.muted, marginTop: 2 }}>{ageLabel(c.dob)} · {c.system_id}</p>
                </div>
              </div>
              {next ? (
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <StatusBadge status={next.dose.status} />
                  <p style={{ fontSize: 12, color: COLORS.muted, marginTop: 4 }}>{next.dose.antigen} dose {next.dose.dose_number}</p>
                </div>
              ) : isFullyImmunized ? (
                <span style={{ fontSize: 12, fontWeight: 500, color: "#2F6B4F", flexShrink: 0 }}>Fully Immunized</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
