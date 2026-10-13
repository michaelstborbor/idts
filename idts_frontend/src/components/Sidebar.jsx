import React from "react";
import {
  Activity, AlertTriangle, BarChart3, ChevronsLeft, ChevronsRight, ClipboardList, LayoutDashboard,
  LogOut, PhoneCall, ServerCog, ShieldCheck, Syringe, UserCircle2, Users, UsersRound, X,
} from "lucide-react";
import { COLORS } from "../constants.js";

// Navigation grouped by the job it serves. Administration only renders for
// system administrators; Reports is hidden from roles the backend refuses.
export function navSections({ canSeeReports, isAdmin }) {
  return [
    {
      title: "Immunization",
      items: [
        { value: "dashboard", label: "Dashboard", icon: LayoutDashboard },
        { value: "list", label: "All children", icon: UsersRound },
        { value: "due", label: "Due & defaulters", icon: ClipboardList },
        { value: "followup", label: "Follow-up", icon: PhoneCall, badgeKey: "followup" },
        { value: "aefi", label: "AEFI", icon: AlertTriangle },
      ],
    },
    ...(canSeeReports ? [{ title: "Analysis", items: [{ value: "reports", label: "Reports", icon: BarChart3 }] }] : []),
    ...(isAdmin
      ? [{
          title: "Administration",
          items: [
            { value: "admin", label: "User management", icon: Users },
            { value: "activity", label: "Activity log", icon: Activity },
            { value: "security", label: "Security settings", icon: ShieldCheck },
            { value: "system", label: "System settings", icon: ServerCog },
          ],
        }]
      : []),
  ];
}

function initials(name) {
  return (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

export default function Sidebar({
  sections, view, onNavigate, badges, collapsed, onToggleCollapsed, drawerOpen, onCloseDrawer,
  currentUser, programmeName, onAccount, onLogout,
}) {
  const roleLabel = currentUser.role.replace(/_/g, " ");
  return (
    <aside
      className={`sidebar${collapsed ? " collapsed" : ""}${drawerOpen ? " open" : ""}`}
      aria-label="Main navigation"
    >
      <div className="sidebar-brand">
        <span aria-hidden="true" className="sidebar-logo">
          <Syringe size={22} strokeWidth={2.25} />
        </span>
        <div className="nav-label" style={{ minWidth: 0 }}>
          <p style={{ fontSize: 19, fontWeight: 700, margin: 0, lineHeight: 1.15, letterSpacing: "0.02em" }}>IDTS</p>
          <p style={{ fontSize: 13, margin: 0, color: "rgba(255,255,255,0.78)", lineHeight: 1.3 }}>{programmeName}</p>
        </div>
        <button className="sidebar-close" onClick={onCloseDrawer} aria-label="Close menu">
          <X size={22} />
        </button>
      </div>

      <nav className="sidebar-nav">
        {sections.map((section) => (
          <div key={section.title} className="sidebar-section">
            <p className="sidebar-section-title nav-label">{section.title}</p>
            {section.items.map((item) => {
              const active = view === item.value;
              const Icon = item.icon;
              const badge = item.badgeKey ? badges[item.badgeKey] : 0;
              return (
                <button
                  key={item.value}
                  onClick={() => onNavigate(item.value)}
                  className={`sidebar-item${active ? " active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  title={collapsed ? item.label : undefined}
                >
                  <span className="sidebar-icon">
                    <Icon size={21} strokeWidth={active ? 2.4 : 2} />
                    {badge > 0 && collapsed && <span className="sidebar-dot" aria-hidden="true" />}
                  </span>
                  <span className="nav-label" style={{ flex: 1 }}>{item.label}</span>
                  {badge > 0 && <span className="sidebar-badge nav-label" aria-label={`${badge} open`}>{badge}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button
          className={`sidebar-item${view === "account" ? " active" : ""}`}
          onClick={onAccount}
          title="Account settings"
          aria-label="Account settings"
        >
          <span className="sidebar-avatar" aria-hidden="true">{initials(currentUser.full_name)}</span>
          <span className="nav-label" style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
            <span style={{ display: "block", fontWeight: 600, color: COLORS.white, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {currentUser.full_name}
            </span>
            <span style={{ display: "block", fontSize: 14, textTransform: "capitalize", color: "rgba(255,255,255,0.75)" }}>{roleLabel}</span>
          </span>
          <UserCircle2 className="nav-label" size={18} aria-hidden="true" />
        </button>
        <button className="sidebar-item" onClick={onLogout} title={collapsed ? "Sign out" : undefined}>
          <span className="sidebar-icon"><LogOut size={21} /></span>
          <span className="nav-label">Sign out</span>
        </button>
        <button
          className="sidebar-item sidebar-collapse"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : undefined}
        >
          <span className="sidebar-icon">{collapsed ? <ChevronsRight size={21} /> : <ChevronsLeft size={21} />}</span>
          <span className="nav-label">Collapse sidebar</span>
        </button>
      </div>
    </aside>
  );
}
