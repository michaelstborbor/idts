import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, LogOut, Menu as MenuIcon, Settings, Syringe, UserPlus } from "lucide-react";
import { api, getStoredToken, setStoredToken } from "./api/client.js";
import { COLORS, CONTENT_MAX_WIDTH, FONT_STACK } from "./constants.js";
import LoginPage from "./pages/LoginPage.jsx";
import ChildForm from "./pages/ChildForm.jsx";
import ChildrenListPage from "./pages/ChildrenListPage.jsx";
import ChildProfilePage from "./pages/ChildProfilePage.jsx";
import DueDefaulterListPage from "./pages/DueDefaulterListPage.jsx";
import FollowUpPage from "./pages/FollowUpPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import AdminPage from "./pages/AdminPage.jsx";
import AccountSettingsPage from "./pages/AccountSettingsPage.jsx";
import ReportsPage from "./pages/ReportsPage.jsx";
import AefiPage from "./pages/AefiPage.jsx";
import AssignCaseModal from "./components/AssignCaseModal.jsx";
import CaseDetailModal from "./components/CaseDetailModal.jsx";

const menuItemStyle = {
  width: "100%", textAlign: "left", padding: "0 16px", minHeight: 48, fontSize: 16, color: COLORS.ink,
  backgroundColor: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 12,
};

const BASE_NAV_TABS = [
  { value: "dashboard", label: "Dashboard" },
  { value: "list", label: "All children" },
  { value: "due", label: "Due & defaulters" },
  { value: "followup", label: "Follow-up" },
  { value: "aefi", label: "AEFI" },
  { value: "reports", label: "Reports" },
];

// Views where the tab bar shows at all
const TAB_BAR_VIEWS = ["dashboard", "list", "due", "followup", "aefi", "reports", "admin"];
// Views where the "Register child" quick-action makes sense
const REGISTER_BUTTON_VIEWS = ["dashboard", "list", "due", "followup"];

export default function App() {
  const [token, setToken] = useState(getStoredToken());
  const [currentUser, setCurrentUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [facilities, setFacilities] = useState([]);
  const [children, setChildren] = useState([]);
  const [dueRows, setDueRows] = useState([]);
  const [openCases, setOpenCases] = useState([]);
  const [closedCases, setClosedCases] = useState([]);
  const [fullyImmunizedIds, setFullyImmunizedIds] = useState(new Set());
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState("");

  const [view, setView] = useState("dashboard");
  const [activeChildId, setActiveChildId] = useState(null);
  const [editingChild, setEditingChild] = useState(null);
  const [assignTarget, setAssignTarget] = useState(null);
  const [caseModalTarget, setCaseModalTarget] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewBeforeAccount, setViewBeforeAccount] = useState("dashboard");

  // On load, if a token is already stored, verify it's still valid.
  useEffect(() => {
    (async () => {
      if (!token) { setAuthChecked(true); return; }
      try {
        const me = await api.getMe(token);
        setCurrentUser(me);
      } catch {
        setStoredToken(null);
        setToken(null);
      } finally {
        setAuthChecked(true);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadAll = useCallback(async () => {
    if (!token) return;
    setDataLoading(true);
    setDataError("");
    try {
      const [facilityList, childList, due, open, closed, dashboardStats] = await Promise.all([
        api.listFacilities(token),
        api.listChildren(token),
        api.getDueList(token),
        api.listDefaulterCases(token),
        api.listDefaulterCases(token, "closed"),
        api.getDashboardStats(token),
      ]);
      setFacilities(facilityList);
      setChildren(childList);
      setDueRows(due);
      setOpenCases(open);
      setClosedCases(closed);
      setFullyImmunizedIds(new Set(dashboardStats.fully_immunized_child_ids || []));
    } catch (err) {
      setDataError(err.message);
    } finally {
      setDataLoading(false);
    }
  }, [token]);

  useEffect(() => { if (token && currentUser) loadAll(); }, [token, currentUser, loadAll]);

  function handleLogin(newToken, me) {
    setToken(newToken);
    setCurrentUser(me);
  }

  function handleLogout() {
    setStoredToken(null);
    setToken(null);
    setCurrentUser(null);
    setView("dashboard");
  }

  const childrenById = useMemo(() => Object.fromEntries(children.map((c) => [c.id, c])), [children]);
  const activeCasesByKey = useMemo(() => {
    const map = {};
    openCases.forEach((c) => { map[`${c.child_id}:${c.schedule_entry_id}`] = c; });
    return map;
  }, [openCases]);

  const activeCaseCount = openCases.length;

  const resolvedCaseModalCase = caseModalTarget
    ? [...openCases, ...closedCases].find((c) => c.id === caseModalTarget.case.id) || caseModalTarget.case
    : null;

  if (!authChecked) {
    return <div style={{ minHeight: "100vh", backgroundColor: COLORS.bg }} />;
  }

  if (!token || !currentUser) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const isAdmin = currentUser.role === "system_admin";
  // Vaccinator and CHW get no Reports access at all (also enforced on the
  // backend — see app/core/scope.py REPORT_ROLES) — not hidden, removed.
  const canSeeReports = currentUser.role !== "vaccinator" && currentUser.role !== "chw";
  const navTabs = [
    ...BASE_NAV_TABS.filter((t) => t.value !== "reports" || canSeeReports),
    ...(isAdmin ? [{ value: "admin", label: "Admin" }] : []),
  ];
  const showTabBar = TAB_BAR_VIEWS.includes(view);
  const showRegisterButton = REGISTER_BUTTON_VIEWS.includes(view);

  const viewTitle = {
    dashboard: "Dashboard",
    list: "Children & immunization status",
    due: "Due & defaulter list",
    followup: "Defaulter follow-up",
    aefi: "Adverse events following immunization (AEFI)",
    reports: "Reports",
    admin: "User management",
    account: "Account settings",
    register: "Register a child",
    profile: "Child record",
    edit: editingChild ? `Edit ${editingChild.full_name}` : "Edit child",
  }[view] || "Children & immunization status";

  return (
    <div style={{ backgroundColor: COLORS.bg, minHeight: "100vh", fontFamily: FONT_STACK, color: COLORS.ink }}>
      <header className="app-bar" style={{ backgroundColor: COLORS.primaryDark, color: COLORS.white, padding: "0 20px", position: "sticky", top: 0, zIndex: 30, boxShadow: "0 2px 10px rgba(7,63,99,0.25)" }}>
        <div style={{ maxWidth: CONTENT_MAX_WIDTH, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 64 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
              <span aria-hidden="true" style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: COLORS.white, color: COLORS.primaryDark, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Syringe size={22} strokeWidth={2.25} />
              </span>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 19, fontWeight: 700, margin: 0, lineHeight: 1.1, letterSpacing: "0.02em" }}>IDTS</p>
                <p className="app-bar-tagline" style={{ fontSize: 14, margin: 0, color: "rgba(255,255,255,0.82)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  Immunization &amp; defaulter tracking
                </p>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <div className="app-bar-user" style={{ textAlign: "right", marginRight: 4 }}>
                <p style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>{currentUser.full_name}</p>
                <p style={{ fontSize: 14, margin: 0, color: "rgba(255,255,255,0.82)", textTransform: "capitalize" }}>{currentUser.role.replace(/_/g, " ")}</p>
              </div>
              {showRegisterButton && (
                <button
                  onClick={() => setView("register")}
                  className="icon-btn"
                  style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, padding: "0 16px", borderRadius: 10, fontSize: 16, fontWeight: 600, color: COLORS.primaryDark, backgroundColor: COLORS.white, border: "none", cursor: "pointer" }}
                >
                  <UserPlus size={18} /> Register child
                </button>
              )}
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => setMenuOpen((open) => !open)}
                  title="Menu"
                  aria-label="Menu"
                  aria-expanded={menuOpen}
                  className="icon-btn"
                  style={{ width: 44, height: 44, borderRadius: 10, color: COLORS.white, backgroundColor: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.35)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  <MenuIcon size={20} />
                </button>
                {menuOpen && (
                  <>
                    {/* Invisible full-screen layer: clicking anywhere outside the
                        menu closes it. Sits below the menu itself (lower z-index). */}
                    <div onClick={() => setMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 20 }} />
                    <div
                      className="menu-dropdown"
                      style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, minWidth: 220, backgroundColor: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 12, boxShadow: "0 12px 28px rgba(7,63,99,0.18)", overflow: "hidden", zIndex: 21 }}
                    >
                      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${COLORS.border}`, backgroundColor: COLORS.subtleBg }}>
                        <p style={{ fontSize: 15, fontWeight: 600, margin: 0, color: COLORS.ink }}>{currentUser.full_name}</p>
                        <p style={{ fontSize: 14, margin: 0, color: COLORS.muted, textTransform: "capitalize" }}>{currentUser.role.replace(/_/g, " ")}</p>
                      </div>
                      {canSeeReports && (
                        <button
                          onClick={() => { setView("reports"); setMenuOpen(false); }}
                          className="menu-item"
                          style={menuItemStyle}
                        >
                          <FileText size={18} /> Reports
                        </button>
                      )}
                      <button
                        onClick={() => { if (view !== "account") setViewBeforeAccount(view); setView("account"); setMenuOpen(false); }}
                        className="menu-item"
                        style={{ ...menuItemStyle, borderTop: `1px solid ${COLORS.border}` }}
                      >
                        <Settings size={18} /> Settings
                      </button>
                      <button
                        onClick={() => { setMenuOpen(false); handleLogout(); }}
                        className="menu-item"
                        style={{ ...menuItemStyle, color: COLORS.danger, borderTop: `1px solid ${COLORS.border}` }}
                      >
                        <LogOut size={18} /> Logout
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {showTabBar && (
            <nav className="app-nav" aria-label="Main" style={{ display: "flex", gap: 4, overflowX: "auto", margin: "0 -8px" }}>
              {navTabs.map((t) => {
                const active = view === t.value;
                return (
                  <button
                    key={t.value}
                    onClick={() => setView(t.value)}
                    aria-current={active ? "page" : undefined}
                    className={`nav-tab${active ? " active" : ""}`}
                    style={{
                      padding: "12px 14px 10px", fontSize: 16, fontWeight: active ? 700 : 500, border: "none", cursor: "pointer",
                      whiteSpace: "nowrap", flexShrink: 0, borderRadius: "8px 8px 0 0", backgroundColor: "transparent",
                      color: active ? COLORS.white : "rgba(255,255,255,0.8)",
                      borderBottom: `4px solid ${active ? "#5FD39A" : "transparent"}`,
                    }}
                  >
                    {t.label}
                    {t.value === "followup" && activeCaseCount > 0 && (
                      <span style={{ marginLeft: 8, padding: "1px 8px", borderRadius: 999, fontSize: 14, fontWeight: 700, backgroundColor: "#FFD24D", color: COLORS.ink }}>
                        {activeCaseCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          )}
        </div>
      </header>

      <div style={{ padding: "0 20px" }}>
        <div style={{ maxWidth: CONTENT_MAX_WIDTH, margin: "0 auto", padding: "28px 0 20px" }}>
          <h1 className="page-title" style={{ fontSize: 28, fontWeight: 700, color: COLORS.ink, margin: 0 }}>{viewTitle}</h1>
          {dataError && (
            <p role="alert" style={{ marginTop: 12, marginBottom: 0, fontSize: 16, color: COLORS.danger, backgroundColor: COLORS.dangerTint, padding: "12px 16px", borderRadius: 10 }}>
              {dataError}
            </p>
          )}
        </div>
      </div>

      <div style={{ padding: "0 20px 60px" }}>
        {view === "register" ? (
          <ChildForm
            token={token}
            facilities={facilities}
            currentUser={currentUser}
            mode="create"
            onSaved={() => { setView("list"); loadAll(); }}
            onCancel={() => setView("list")}
          />
        ) : view === "edit" && editingChild ? (
          <ChildForm
            token={token}
            facilities={facilities}
            currentUser={currentUser}
            mode="edit"
            initialChild={editingChild}
            onSaved={() => { setView("profile"); loadAll(); }}
            onCancel={() => setView("profile")}
          />
        ) : view === "profile" && activeChildId ? (
          <ChildProfilePage
            token={token}
            childId={activeChildId}
            facilities={facilities}
            onBack={() => { setView("list"); loadAll(); }}
            onEdit={(child) => { setEditingChild(child); setView("edit"); }}
            onDeleted={() => { setView("list"); loadAll(); }}
          />
        ) : view === "due" ? (
          <DueDefaulterListPage
            dueRows={dueRows}
            activeCasesByKey={activeCasesByKey}
            loading={dataLoading}
            onOpenChild={(id) => { setActiveChildId(id); setView("profile"); }}
            onAssign={(child, dose, priority) => setAssignTarget({ child: childrenById[child.id] || child, dose, priority })}
            onOpenCase={(child, defaulterCase) => setCaseModalTarget({ child, case: defaulterCase })}
          />
        ) : view === "followup" ? (
          <FollowUpPage
            cases={openCases}
            childrenById={childrenById}
            loading={dataLoading}
            onOpenCase={(child, defaulterCase) => setCaseModalTarget({ child, case: defaulterCase })}
          />
        ) : view === "aefi" ? (
          <AefiPage token={token} currentUser={currentUser} children={children} />
        ) : view === "reports" ? (
          <ReportsPage token={token} currentUser={currentUser} />
        ) : view === "admin" && isAdmin ? (
          <AdminPage token={token} facilities={facilities} currentUserId={currentUser.id} />
        ) : view === "account" ? (
          <AccountSettingsPage
            token={token}
            currentUser={currentUser}
            onProfileUpdated={(updated) => setCurrentUser(updated)}
            onBack={() => setView(viewBeforeAccount)}
          />
        ) : view === "dashboard" ? (
          <DashboardPage token={token} childrenCount={children.length} />
        ) : (
          <ChildrenListPage
            token={token}
            children={children}
            dueRowsByChildId={Object.fromEntries(dueRows.map((r) => [r.child.id, r]))}
            fullyImmunizedIds={fullyImmunizedIds}
            loading={dataLoading}
            onOpenChild={(id) => { setActiveChildId(id); setView("profile"); }}
            onRegisterClick={() => setView("register")}
          />
        )}
      </div>

      {assignTarget && (
        <AssignCaseModal
          token={token}
          child={assignTarget.child}
          dose={assignTarget.dose}
          priority={assignTarget.priority}
          onAssigned={(newCase) => {
            setAssignTarget(null);
            loadAll();
            setCaseModalTarget({ child: assignTarget.child, case: newCase });
          }}
          onClose={() => setAssignTarget(null)}
        />
      )}

      {caseModalTarget && resolvedCaseModalCase && (
        <CaseDetailModal
          token={token}
          child={caseModalTarget.child}
          defaulterCase={resolvedCaseModalCase}
          tracingAttempts={resolvedCaseModalCase.tracing_attempts || []}
          onAttemptRecorded={async () => {
            await loadAll();
          }}
          onCaseClosed={async () => {
            await loadAll();
            setCaseModalTarget(null);
          }}
          onClose={() => setCaseModalTarget(null)}
        />
      )}
    </div>
  );
}
