import React, { useEffect, useState } from "react";
import { AlertTriangle, CloudUpload, RefreshCw, Trash2, Wifi, WifiOff } from "lucide-react";
import { COLORS, fmtDate } from "../constants.js";
import { discard, retryFailed, subscribeSync, syncNow } from "../offline/sync.js";
import { Modal, PrimaryButton, SecondaryButton } from "./ui.jsx";

export function useSyncState() {
  const [state, setState] = useState(null);
  useEffect(() => subscribeSync(setState), []);
  return state;
}

function timeAgo(ms) {
  if (!ms) return "never";
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return fmtDate(new Date(ms).toISOString().slice(0, 10));
}

// The pill in the top bar: connection state plus how many entries are
// waiting. Opens the sync panel.
export function SyncPill({ online, sync, onOpen }) {
  const waiting = sync?.pending || 0;
  const failed = sync?.failed || 0;
  let cls = "net-status";
  let icon = <Wifi size={16} />;
  let label = "Online";
  let title = "Connected. Everything is saved to the server.";
  if (!online) {
    cls += " offline";
    icon = <WifiOff size={16} />;
    label = waiting ? `Offline · ${waiting} to sync` : "Offline";
    title = "No connection. New entries are saved on this device and sync when you're back online.";
  } else if (sync?.syncing) {
    cls += " syncing";
    icon = <RefreshCw size={16} className="spin" />;
    label = `Syncing ${waiting}`;
    title = "Sending entries saved on this device.";
  } else if (failed) {
    cls += " attention";
    icon = <AlertTriangle size={16} />;
    label = `${failed} need review`;
    title = "Some entries couldn't be saved on the server. Open to review them.";
  } else if (waiting) {
    cls += " syncing";
    icon = <CloudUpload size={16} />;
    label = `${waiting} to sync`;
    title = "Entries saved on this device are waiting to be sent.";
  }
  return (
    <button type="button" className={cls} onClick={onOpen} title={title} aria-label={`${label}. Open sync details`}>
      {icon}
      <span className="net-status-label">{label}</span>
    </button>
  );
}

export function SyncPanel({ online, sync, packInfo, onRefreshPack, refreshingPack, onClose }) {
  const items = sync?.items || [];
  const [busy, setBusy] = useState(false);
  async function run(fn) {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  }
  return (
    <Modal title="Offline and sync" onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <p style={{ fontSize: 16, margin: 0, lineHeight: 1.55, color: COLORS.ink }}>
          {online
            ? "You're online. Entries made on this device are sent to the server automatically."
            : "You're offline. Keep registering children, recording doses and logging follow-up. They're saved on this device and sent when the connection returns."}
        </p>

        <section>
          <h4 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 8px" }}>
            Waiting to sync ({items.length})
          </h4>
          {items.length === 0 ? (
            <p style={{ fontSize: 15, color: COLORS.muted, margin: 0 }}>
              Nothing waiting. Last sync: {timeAgo(sync?.lastSyncAt)}.
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, border: `1px solid ${COLORS.border}`, borderRadius: 10 }}>
              {items.map((op, i) => (
                <li key={op.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderTop: i ? `1px solid ${COLORS.border}` : "none" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{op.label}</p>
                    <p style={{ fontSize: 14, color: COLORS.muted, margin: "2px 0 0" }}>Saved on this device {timeAgo(op.createdAt)}</p>
                    {op.status === "failed" && (
                      <p style={{ fontSize: 14, color: COLORS.danger, margin: "4px 0 0", fontWeight: 600 }}>
                        Server refused this entry: {op.error}
                      </p>
                    )}
                  </div>
                  {op.status === "failed" && (
                    <button
                      type="button"
                      onClick={() => run(() => discard(op.id))}
                      aria-label={`Discard ${op.label}`}
                      title="Discard this entry"
                      style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 8, border: `1.5px solid #F2A9AD`, background: COLORS.dangerTint, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                    >
                      <Trash2 size={18} color={COLORS.danger} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {sync?.needsSignIn && (
            <p style={{ fontSize: 15, color: "#6A4300", margin: "8px 0 0", fontWeight: 600 }}>
              Your session has ended. Sign in again to send these entries.
            </p>
          )}
          {sync?.otherUsers > 0 && (
            <p style={{ fontSize: 14, color: COLORS.muted, margin: "8px 0 0" }}>
              {sync.otherUsers} {sync.otherUsers === 1 ? "entry" : "entries"} from another account on this device will sync when that person signs in.
            </p>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            {sync?.pending > 0 && (
              <PrimaryButton onClick={() => run(syncNow)} disabled={!online || busy || sync.syncing}>
                {sync.syncing ? "Syncing…" : "Sync now"}
              </PrimaryButton>
            )}
            {sync?.failed > 0 && (
              <SecondaryButton onClick={() => run(retryFailed)} disabled={!online || busy}>Try refused entries again</SecondaryButton>
            )}
          </div>
        </section>

        <section style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 16 }}>
          <h4 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 6px" }}>Records saved for offline use</h4>
          <p style={{ fontSize: 15, color: COLORS.muted, margin: 0, lineHeight: 1.5 }}>
            {packInfo
              ? `${packInfo.children.toLocaleString()} child records, updated ${timeAgo(packInfo.savedAt)}.${packInfo.truncated ? " Only the most recent records fit; older ones need a connection." : ""}`
              : "Not saved yet. This happens automatically while you're online."}
          </p>
          <div style={{ marginTop: 10 }}>
            <SecondaryButton onClick={onRefreshPack} disabled={!online || refreshingPack}>
              {refreshingPack ? "Updating…" : "Update now"}
            </SecondaryButton>
          </div>
        </section>
      </div>
    </Modal>
  );
}
