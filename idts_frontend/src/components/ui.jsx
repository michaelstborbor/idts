import React from "react";
import { X } from "lucide-react";
import { COLORS, STATUS_META } from "../constants.js";

export function Modal({ title, onClose, children }) {
  return (
    <div
      className="modal-overlay"
      style={{
        position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16, zIndex: 50, backgroundColor: "rgba(43,43,40,0.45)",
      }}
      onClick={onClose}
    >
      <div
        style={{ width: "100%", maxWidth: 480, borderRadius: 12, overflow: "hidden", backgroundColor: COLORS.white, maxHeight: "90vh", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: `1px solid ${COLORS.border}` }}>
          <h3 style={{ fontWeight: 600, fontSize: 16, color: COLORS.ink, margin: 0 }}>{title}</h3>
          <button onClick={onClose} aria-label="Close" style={{ padding: 4, borderRadius: 6, background: "none", border: "none", cursor: "pointer" }}>
            <X size={18} style={{ color: COLORS.muted }} />
          </button>
        </div>
        <div style={{ padding: 20, overflowY: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

export function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.not_yet_due;
  const Icon = meta.icon;
  return (
    <span
      style={{
        color: meta.color, backgroundColor: meta.bg, display: "inline-flex", alignItems: "center", gap: 6,
        padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 500, whiteSpace: "nowrap",
      }}
    >
      <Icon size={13} strokeWidth={2.25} />
      {meta.label}
    </span>
  );
}

export function Pill({ label, color, bg }) {
  return (
    <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 999, fontWeight: 500, color, backgroundColor: bg }}>
      {label}
    </span>
  );
}

export function PrimaryButton({ children, onClick, type = "button", style, disabled }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "10px 16px", borderRadius: 8, fontSize: 14, fontWeight: 500, color: COLORS.white,
        backgroundColor: disabled ? "#A9C4C0" : COLORS.primary, border: "none", cursor: disabled ? "not-allowed" : "pointer",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({ children, onClick, type = "button", style }) {
  return (
    <button
      type={type}
      onClick={onClick}
      style={{
        padding: "10px 16px", borderRadius: 8, fontSize: 14, fontWeight: 500, color: COLORS.ink,
        backgroundColor: COLORS.white, border: `1px solid ${COLORS.inputBorder}`, cursor: "pointer",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function TextInput(props) {
  return (
    <input
      {...props}
      style={{
        width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${COLORS.inputBorder}`,
        fontSize: 15, outline: "none", boxSizing: "border-box", ...props.style,
      }}
    />
  );
}

export function SelectInput({ children, ...props }) {
  return (
    <select
      {...props}
      style={{
        width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${COLORS.inputBorder}`,
        fontSize: 15, outline: "none", backgroundColor: COLORS.white, boxSizing: "border-box", ...props.style,
      }}
    >
      {children}
    </select>
  );
}

export function Label({ children }) {
  return <label style={{ display: "block", fontSize: 14, fontWeight: 500, marginBottom: 6, color: COLORS.ink }}>{children}</label>;
}

export function ErrorText({ children }) {
  if (!children) return null;
  return (
    <p style={{ fontSize: 14, padding: "10px 14px", borderRadius: 8, color: "#8C2E1C", backgroundColor: "#F6D9D2", margin: 0 }}>
      {children}
    </p>
  );
}
