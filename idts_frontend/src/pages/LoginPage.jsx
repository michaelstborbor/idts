import React, { useState } from "react";
import { api, setStoredToken } from "../api/client.js";
import { COLORS } from "../constants.js";
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
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bg, fontFamily: "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <p style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: COLORS.primary, marginBottom: 4 }}>
          IDTS
        </p>
        <h1 style={{ fontSize: 24, fontWeight: 600, color: COLORS.ink, marginTop: 0, marginBottom: 24 }}>
          Immunization &amp; Defaulter Tracking
        </h1>

        <div style={{ backgroundColor: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 24 }}>
          <div style={{ marginBottom: 16 }}>
            <Label>Username</Label>
            <TextInput
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              autoFocus
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <Label>Password</Label>
            <TextInput
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
          {error && <div style={{ marginBottom: 16 }}><ErrorText>{error}</ErrorText></div>}
          <PrimaryButton onClick={submit} disabled={loading} style={{ width: "100%" }}>
            {loading ? "Signing in…" : "Sign in"}
          </PrimaryButton>
        </div>

        <p style={{ fontSize: 13, color: COLORS.muted, marginTop: 16, lineHeight: 1.5 }}>
          Connects to the API at{" "}
          <code style={{ backgroundColor: COLORS.chipBg, padding: "1px 5px", borderRadius: 4 }}>
            {import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000"}
          </code>
          . Change this in <code>.env.local</code> if your backend lives somewhere else.
        </p>
      </div>
    </div>
  );
}
