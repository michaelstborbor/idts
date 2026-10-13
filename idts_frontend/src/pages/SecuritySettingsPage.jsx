import React, { useEffect, useState } from "react";
import { Clock, KeyRound, Lock, ShieldAlert } from "lucide-react";
import { api } from "../api/client.js";
import { COLORS, CONTENT_MAX_WIDTH } from "../constants.js";
import { ErrorText, PrimaryButton, SecondaryButton, TextInput } from "../components/ui.jsx";

// Same ranges the backend enforces (app/services/settings_service.py).
const FIELDS = [
  {
    key: "session_timeout_minutes", icon: Clock, label: "Session length", unit: "minutes", min: 5, max: 1440,
    help: "How long a sign-in lasts before the person must sign in again. Shorter is safer on shared clinic devices; longer suits outreach days.",
  },
  {
    key: "password_min_length", icon: KeyRound, label: "Minimum password length", unit: "characters", min: 8, max: 64,
    help: "Applies to new accounts, password resets and password changes. Existing passwords keep working.",
  },
  {
    key: "max_failed_logins", icon: ShieldAlert, label: "Failed sign-ins before lockout", unit: "attempts", min: 0, max: 20,
    help: "After this many wrong passwords in a row the account is locked. Set to 0 to turn lockout off.",
  },
  {
    key: "lockout_minutes", icon: Lock, label: "Lockout duration", unit: "minutes", min: 1, max: 1440,
    help: "How long a locked account stays locked. An administrator can unlock it sooner from User management.",
  },
];

export default function SecuritySettingsPage({ token }) {
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState(null);

  useEffect(() => {
    api.getSecuritySettings(token)
      .then((s) => { setSaved(s); setForm(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, String(v)]))); })
      .catch((err) => setError(err.message));
    api.getSystemInfo(token).then(setInfo).catch(() => {});
  }, [token]);

  if (!form) {
    return <div style={{ maxWidth: CONTENT_MAX_WIDTH, margin: "0 auto" }}>{error ? <ErrorText>{error}</ErrorText> : <p style={{ color: COLORS.muted }}>Loading…</p>}</div>;
  }

  const invalid = FIELDS.find((f) => {
    const n = Number(form[f.key]);
    return form[f.key] === "" || !Number.isInteger(n) || n < f.min || n > f.max;
  });
  const dirty = FIELDS.some((f) => String(saved[f.key]) !== form[f.key]);

  async function save() {
    if (invalid) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const body = Object.fromEntries(FIELDS.map((f) => [f.key, Number(form[f.key])]));
      const next = await api.updateSecuritySettings(token, body);
      setSaved(next);
      setForm(Object.fromEntries(Object.entries(next).map(([k, v]) => [k, String(v)])));
      setNotice("Security settings saved. New sign-ins use them straight away.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const lockoutOff = Number(form.max_failed_logins) === 0;

  return (
    <div style={{ maxWidth: CONTENT_MAX_WIDTH, margin: "0 auto" }}>
      <p style={{ fontSize: 16, color: COLORS.muted, margin: "0 0 20px", maxWidth: 760 }}>
        These rules protect children's records on every device that signs in. Changes are recorded in the activity log.
      </p>

      {info && info.users_locked > 0 && (
        <p role="status" style={{ fontSize: 16, padding: "12px 16px", borderRadius: 10, color: "#6A4300", backgroundColor: "#FFF1CC", borderLeft: "4px solid #D08A00", margin: "0 0 20px" }}>
          {info.users_locked} account{info.users_locked === 1 ? " is" : "s are"} locked right now. Unlock {info.users_locked === 1 ? "it" : "them"} from User management.
        </p>
      )}

      <div className="settings-grid">
        {FIELDS.map((f) => {
          const Icon = f.icon;
          const n = Number(form[f.key]);
          const bad = form[f.key] === "" || !Number.isInteger(n) || n < f.min || n > f.max;
          const disabled = f.key === "lockout_minutes" && lockoutOff;
          return (
            <section key={f.key} style={{ backgroundColor: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 14, padding: 20, opacity: disabled ? 0.6 : 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                <span style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: COLORS.primaryTint, color: COLORS.primaryDark, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Icon size={21} />
                </span>
                <label htmlFor={f.key} style={{ fontSize: 18, fontWeight: 700, color: COLORS.ink }}>{f.label}</label>
              </div>
              <p style={{ fontSize: 15, color: COLORS.muted, margin: "0 0 14px", lineHeight: 1.55 }}>{f.help}</p>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <TextInput
                  id={f.key}
                  type="number"
                  inputMode="numeric"
                  min={f.min}
                  max={f.max}
                  value={form[f.key]}
                  disabled={disabled}
                  onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                  aria-invalid={bad}
                  style={{ width: 120, fontWeight: 700, borderColor: bad ? COLORS.danger : undefined }}
                />
                <span style={{ fontSize: 16, color: COLORS.muted }}>{f.unit}</span>
              </div>
              {bad && <p style={{ fontSize: 14, color: COLORS.danger, margin: "8px 0 0" }}>Enter a whole number from {f.min} to {f.max}.</p>}
              {f.key === "max_failed_logins" && lockoutOff && (
                <p style={{ fontSize: 14, color: "#6A4300", margin: "8px 0 0", fontWeight: 600 }}>Lockout is off: anyone can keep guessing passwords.</p>
              )}
            </section>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 24, flexWrap: "wrap" }}>
        <PrimaryButton onClick={save} disabled={!dirty || !!invalid || saving}>{saving ? "Saving…" : "Save security settings"}</PrimaryButton>
        {dirty && (
          <SecondaryButton onClick={() => setForm(Object.fromEntries(Object.entries(saved).map(([k, v]) => [k, String(v)])))}>
            Discard changes
          </SecondaryButton>
        )}
        {notice && <span role="status" style={{ fontSize: 16, color: COLORS.protect, fontWeight: 600 }}>{notice}</span>}
      </div>
      {error && <div style={{ marginTop: 16 }}><ErrorText>{error}</ErrorText></div>}
    </div>
  );
}
