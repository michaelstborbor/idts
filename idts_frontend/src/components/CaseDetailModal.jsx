import React, { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { api } from "../api/client.js";
import { CASE_STATUS_META, CLOSURE_REASONS, COLORS, PRIORITY_META, TRACING_METHODS, TRACING_OUTCOMES, fmtDate } from "../constants.js";
import { ErrorText, Label, Modal, PrimaryButton, SecondaryButton, SelectInput, TextInput } from "../components/ui.jsx";

export default function CaseDetailModal({ token, child, defaulterCase, tracingAttempts, onAttemptRecorded, onCaseClosed, onClose }) {
  const [method, setMethod] = useState(TRACING_METHODS[0].value);
  const [outcome, setOutcome] = useState(TRACING_OUTCOMES[0].value);
  const [nextFollowup, setNextFollowup] = useState("");
  const [notes, setNotes] = useState("");
  const [showClosure, setShowClosure] = useState(false);
  const [closureReason, setClosureReason] = useState(CLOSURE_REASONS[0].value);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const attempts = [...tracingAttempts].sort((a, b) => new Date(b.attempt_date) - new Date(a.attempt_date));
  const statusMeta = CASE_STATUS_META[defaulterCase.status] || CASE_STATUS_META.assigned;

  async function submitAttempt() {
    setSubmitting(true);
    setError("");
    try {
      await api.recordTracingAttempt(token, defaulterCase.id, {
        method,
        outcome,
        next_followup_date: nextFollowup || null,
        notes: notes.trim() || null,
      });
      setNotes("");
      setNextFollowup("");
      onAttemptRecorded();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmClosure() {
    setSubmitting(true);
    setError("");
    try {
      await api.closeCase(token, defaulterCase.id, closureReason);
      onCaseClosed();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`${child.full_name} — follow-up case`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 999, fontWeight: 500, color: statusMeta.color, backgroundColor: statusMeta.bg }}>
              {statusMeta.label}
            </span>
            <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 999, fontWeight: 500, color: PRIORITY_META[defaulterCase.priority].color, backgroundColor: PRIORITY_META[defaulterCase.priority].bg }}>
              {PRIORITY_META[defaulterCase.priority].label}
            </span>
          </div>
          <p style={{ fontSize: 14, color: COLORS.ink, margin: 0 }}>{defaulterCase.reason}</p>
          <p style={{ fontSize: 14, color: COLORS.muted, marginTop: 4 }}>
            Identified {fmtDate(defaulterCase.date_identified)}
          </p>
          {defaulterCase.status === "return_pending_confirmation" && (
            <div style={{ display: "flex", gap: 8, marginTop: 8, padding: "10px 14px", borderRadius: 8, backgroundColor: "#E4F1EA", color: "#2F6B4F", fontSize: 14 }}>
              <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>A vaccination was recorded for this dose. Confirm below to close this case.</span>
            </div>
          )}
        </div>

        <div>
          <h4 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "#6B6660", marginBottom: 8 }}>
            Tracing attempts
          </h4>
          {attempts.length === 0 ? (
            <p style={{ fontSize: 14, color: COLORS.muted }}>No attempts recorded yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {attempts.map((a) => (
                <div key={a.id} style={{ fontSize: 14, padding: "10px 14px", borderRadius: 8, backgroundColor: COLORS.subtleBg }}>
                  <p style={{ margin: 0, color: COLORS.ink }}>
                    <strong>{fmtDate(a.attempt_date)}</strong> · {TRACING_METHODS.find((m) => m.value === a.method)?.label} — {TRACING_OUTCOMES.find((o) => o.value === a.outcome)?.label}
                  </p>
                  {a.next_followup_date && <p style={{ margin: 0, color: COLORS.muted }}>Next follow-up: {fmtDate(a.next_followup_date)}</p>}
                  {a.notes && <p style={{ margin: "4px 0 0", color: COLORS.muted, fontStyle: "italic" }}>{a.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        {defaulterCase.status !== "closed" && !showClosure && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 16, borderTop: `1px solid ${COLORS.border}` }}>
            <h4 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "#6B6660", margin: 0 }}>
              Record a tracing attempt
            </h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <Label>Method</Label>
                <SelectInput value={method} onChange={(e) => setMethod(e.target.value)} style={{ fontSize: 14, padding: "8px 12px" }}>
                  {TRACING_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </SelectInput>
              </div>
              <div>
                <Label>Outcome</Label>
                <SelectInput value={outcome} onChange={(e) => setOutcome(e.target.value)} style={{ fontSize: 14, padding: "8px 12px" }}>
                  {TRACING_OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </SelectInput>
              </div>
            </div>
            <div>
              <Label>Next follow-up date <span style={{ color: COLORS.muted, fontWeight: 400 }}>(optional)</span></Label>
              <TextInput type="date" value={nextFollowup} onChange={(e) => setNextFollowup(e.target.value)} />
            </div>
            <div>
              <Label>Notes <span style={{ color: COLORS.muted, fontWeight: 400 }}>(optional)</span></Label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${COLORS.inputBorder}`, fontSize: 15, outline: "none", resize: "none", boxSizing: "border-box", fontFamily: "inherit" }}
              />
            </div>
            <ErrorText>{error}</ErrorText>
            <div style={{ display: "flex", gap: 12 }}>
              <SecondaryButton onClick={() => setShowClosure(true)} style={{ flex: 1 }}>Close case…</SecondaryButton>
              <PrimaryButton onClick={submitAttempt} disabled={submitting} style={{ flex: 1 }}>
                {submitting ? "Saving…" : "Save attempt"}
              </PrimaryButton>
            </div>
          </div>
        )}

        {defaulterCase.status !== "closed" && showClosure && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 16, borderTop: `1px solid ${COLORS.border}` }}>
            <h4 style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "#6B6660", margin: 0 }}>
              Close this case
            </h4>
            <SelectInput value={closureReason} onChange={(e) => setClosureReason(e.target.value)}>
              {CLOSURE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </SelectInput>
            <ErrorText>{error}</ErrorText>
            <div style={{ display: "flex", gap: 12 }}>
              <SecondaryButton onClick={() => setShowClosure(false)} style={{ flex: 1 }}>Back</SecondaryButton>
              <PrimaryButton onClick={confirmClosure} disabled={submitting} style={{ flex: 1 }}>
                {submitting ? "Closing…" : "Confirm closure"}
              </PrimaryButton>
            </div>
          </div>
        )}

        {defaulterCase.status === "closed" && (
          <p style={{ fontSize: 14, padding: "10px 14px", borderRadius: 8, color: "#6B6660", backgroundColor: "#EDEBE6", margin: 0 }}>
            Closed: {CLOSURE_REASONS.find((r) => r.value === defaulterCase.closure_reason)?.label || defaulterCase.closure_reason}
            {defaulterCase.closed_at ? ` on ${fmtDate(defaulterCase.closed_at.slice(0, 10))}` : ""}
          </p>
        )}
      </div>
    </Modal>
  );
}
