import React, { useState } from "react";
import { api, setStoredToken } from "../api/client.js";
import { ShieldCheck, Syringe, Users } from "lucide-react";
import { COLORS, FONT_STACK } from "../constants.js";
import { ErrorText, Label, PrimaryButton, TextInput } from "../components/ui.jsx";

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!username || !password) {
      setError("Enter both a username and password.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { access_token } = await api.login(username, password);
      setStoredToken(access_token);
      const me = await api.getMe(access_token);
      onLogin(access_token, me);
    } catch (err) {
      setError(err.status === 401 ? "Incorrect username or password." : err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell" style={{ minHeight: "100vh", display: "flex", backgroundColor: COLORS.bg, fontFamily: FONT_STACK, color: COLORS.ink }}>
      <section className="login-brand" style={{ flex: "1 1 46%", backgroundColor: COLORS.primaryDark, color: COLORS.white, padding: "48px 56px", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span aria-hidden="true" style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: COLORS.white, color: COLORS.primaryDark, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Syringe size={26} strokeWidth={2.25} />
          </span>
          <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: "0.02em" }}>IDTS</span>
        </div>
        <div style={{ maxWidth: 460 }}>
          <h1 style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.15, margin: 0 }}>
            Immunization &amp; Defaulter Tracking
          </h1>
          <p style={{ fontSize: 18, lineHeight: 1.55, color: "rgba(255,255,255,0.86)", margin: "16px 0 0" }}>
            Register children, record every dose, and follow up with families before a child misses protection.
          </p>
        </div>
        <ul className="login-points" style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12, fontSize: 16, color: "rgba(255,255,255,0.9)" }}>
          <li style={{ display: "flex", gap: 10, alignItems: "center" }}><ShieldCheck size={20} color="#5FD39A" /> Ministry of Health EPI schedule</li>
          <li style={{ display: "flex", gap: 10, alignItems: "center" }}><Users size={20} color="#5FD39A" /> Defaulter tracing with community health workers</li>
        </ul>
      </section>

      <main style={{ flex: "1 1 54%", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
        <div style={{ width: "100%", maxWidth: 420 }}>
          <h2 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 6px" }}>Sign in</h2>
          <p style={{ fontSize: 16, color: COLORS.muted, margin: "0 0 24px" }}>Use the username and password your system administrator gave you.</p>

          <div style={{ backgroundColor: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 28, boxShadow: "0 4px 18px rgba(7,63,99,0.08)" }}>
            <div style={{ marginBottom: 18 }}>
              <Label>Username</Label>
              <TextInput
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                autoComplete="username"
                autoCapitalize="none"
                autoFocus
              />
            </div>
            <div style={{ marginBottom: 22 }}>
              <Label>Password</Label>
              <TextInput
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                autoComplete="current-password"
              />
            </div>
            {error && <div style={{ marginBottom: 18 }}><ErrorText>{error}</ErrorText></div>}
            <PrimaryButton onClick={submit} disabled={loading} style={{ width: "100%", minHeight: 50, fontSize: 17 }}>
              {loading ? "Signing in…" : "Sign in"}
            </PrimaryButton>
          </div>

          {import.meta.env.DEV && (
            <p style={{ fontSize: 14, color: COLORS.muted, marginTop: 16, lineHeight: 1.5 }}>
              Connects to the API at{" "}
              <code style={{ backgroundColor: COLORS.chipBg, padding: "1px 5px", borderRadius: 4 }}>
                {import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000"}
              </code>
              . Change this in <code>.env.local</code> if your backend lives somewhere else.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
