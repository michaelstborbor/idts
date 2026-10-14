import React from "react";
import { X } from "lucide-react";
import { COLORS, STATUS_META } from "../constants.js";

export function Modal({ title, onClose, children }) {
  return (
    <div
      className="modal-overlay"
      style={{
        position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16, zIndex: 50, backgroundColor: "rgba(16,34,46,0.55)",
      }}
      onClick={onClose}
    >
      <div
        role="dialog" aria-modal="true" aria-label={title}
        style={{ width: "100%", maxWidth: 520, borderRadius: 14, overflow: "hidden", backgroundColor: COLORS.white, maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 48px rgba(7,63,99,0.28)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 14px 20px", borderBottom: `1px solid ${COLORS.border}`, backgroundColor: COLORS.subtleBg }}>
          <h3 style={{ fontWeight: 700, fontSize: 19, color: COLORS.ink, margin: 0 }}>{title}</h3>
          <button onClick={onClose} aria-label="Close" style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 10, background: "none", border: "none", cursor: "pointer" }}>
            <X size={22} style={{ color: COLORS.muted }} />
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
        padding: "4px 12px 4px 10px", borderRadius: 999, fontSize: 14, fontWeight: 700, whiteSpace: "nowrap",
        border: `1px solid ${meta.border || "transparent"}`,
      }}
    >
      <Icon size={16} strokeWidth={2.5} />
      {meta.label}
    </span>
  );
}

export function Pill({ label, color, bg }) {
  return (
    <span style={{ fontSize: 14, padding: "2px 10px", borderRadius: 999, fontWeight: 600, color, backgroundColor: bg, whiteSpace: "nowrap" }}>
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
      className="btn-primary"
      style={{
        minHeight: 44, padding: "10px 20px", borderRadius: 10, fontSize: 16, fontWeight: 600, color: COLORS.white,
        backgroundColor: disabled ? "#9DBBD0" : COLORS.primary, border: "none", cursor: disabled ? "not-allowed" : "pointer",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({ children, onClick, type = "button", style, disabled }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="btn-secondary"
      style={{
        minHeight: 44, padding: "10px 20px", borderRadius: 10, fontSize: 16, fontWeight: 600, color: COLORS.primaryDark,
        backgroundColor: COLORS.white, border: `1px solid ${COLORS.inputBorder}`, cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
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
        width: "100%", minHeight: 46, padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${COLORS.inputBorder}`,
        fontSize: 16, color: COLORS.ink, backgroundColor: COLORS.white, outline: "none", boxSizing: "border-box", ...props.style,
      }}
    />
  );
}

export function SelectInput({ children, ...props }) {
  return (
    <select
      {...props}
      style={{
        width: "100%", minHeight: 46, padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${COLORS.inputBorder}`,
        fontSize: 16, color: COLORS.ink, backgroundColor: COLORS.white, outline: "none", backgroundColor: COLORS.white, boxSizing: "border-box", ...props.style,
      }}
    >
      {children}
    </select>
  );
}

export function Label({ children }) {
  return <label style={{ display: "block", fontSize: 16, fontWeight: 600, marginBottom: 6, color: COLORS.ink }}>{children}</label>;
}

export function ErrorText({ children }) {
  if (!children) return null;
  return (
    <p role="alert" style={{ fontSize: 16, padding: "12px 16px", borderRadius: 10, color: COLORS.danger, backgroundColor: COLORS.dangerTint, borderLeft: `4px solid ${COLORS.danger}`, margin: 0 }}>
      {children}
    </p>
  );
}
