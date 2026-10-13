import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Menu as MenuIcon, UserPlus, Wifi, WifiOff } from "lucide-react";
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
import ActivityLogPage from "./pages/ActivityLogPage.jsx";
import SecuritySettingsPage from "./pages/SecuritySettingsPage.jsx";
import SystemSettingsPage from "./pages/SystemSettingsPage.jsx";
import AssignCaseModal from "./components/AssignCaseModal.jsx";
import CaseDetailModal from "./components/CaseDetailModal.jsx";
import Sidebar, { navSections } from "./components/Sidebar.jsx";

// Views where the "Register child" quick-action makes sense
const REGISTER_BUTTON_VIEWS = ["dashboard", "list", "due", "followup"];
const ADMIN_VIEWS = ["admin", "activity", "security", "system"];
const COLLAPSED_KEY = "idts:sidebar-collapsed";
const DEFAULT_PROGRAMME = "Expanded Programme on Immunization";

function readCollapsed() {
  try { return localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; }
}

function useOnlineStatus() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  return online;
}

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
  const [viewBeforeAccount, setViewBeforeAccount] = useState("dashboard");
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [programmeName, setProgrammeName] = useState(DEFAULT_PROGRAMME);
  const online = useOnlineStatus();

  useEffect(() => {
    api.getPublicSettings().then((s) => s?.programme_name && setProgrammeName(s.programme_name)).catch(() => {});
  }, []);

  function toggleCollapsed() {
    setCollapsed((c) => {
      try { localStorage.setItem(COLLAPSED_KEY, c ? "0" : "1"); } catch { /* per-device preference only */ }
      return !c;
    });
  }

  function navigate(next) {
    if (next === "account" && view !== "account") setViewBeforeAccount(view);
    setView(next);
    setDrawerOpen(false);
    window.scrollTo(0, 0);
  }

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
  const sections = navSections({ canSeeReports, isAdmin });
  const showRegisterButton = REGISTER_BUTTON_VIEWS.includes(view);

  const viewTitle = {
    dashboard: "Dashboard",
    list: "Children & immunization status",
    due: "Due & defaulter list",
    followup: "Defaulter follow-up",
    aefi: "Adverse events following immunization (AEFI)",
    reports: "Reports",
    admin: "User management",
    activity: "Activity log",
    security: "Security settings",
    system: "System settings",
    account: "Account settings",
    register: "Register a child",
    profile: "Child record",
    edit: editingChild ? `Edit ${editingChild.full_name}` : "Edit child",
  }[view] || "Children & immunization status";

  return (
    <div className="app-shell" style={{ backgroundColor: COLORS.bg, minHeight: "100vh", fontFamily: FONT_STACK, color: COLORS.ink }}>
      {drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" />}
      <Sidebar
        sections={sections}
        view={view}
        onNavigate={navigate}
        badges={{ followup: activeCaseCount }}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        drawerOpen={drawerOpen}
        onCloseDrawer={() => setDrawerOpen(false)}
        currentUser={currentUser}
        programmeName={programmeName}
        onAccount={() => navigate("account")}
        onLogout={handleLogout}
      />

      <div className="app-main">
      <header className="topbar">
        <button className="topbar-menu" onClick={() => setDrawerOpen(true)} aria-label="Open menu" aria-expanded={drawerOpen}>
          <MenuIcon size={22} />
        </button>
        <h1 className="page-title" style={{ fontSize: 26, fontWeight: 700, color: COLORS.ink, margin: 0, flex: 1, minWidth: 0 }}>{viewTitle}</h1>
        <span
          className={`net-status${online ? "" : " offline"}`}
          role="status"
          title={online ? "Connected" : "No connection: changes can't be saved until you're back online"}
        >
          {online ? <Wifi size={16} /> : <WifiOff size={16} />}
          <span className="net-status-label">{online ? "Online" : "Offline"}</span>
        </span>
        {showRegisterButton && (
          <button
            onClick={() => navigate("register")}
            className="icon-btn btn-primary topbar-register"
            style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, padding: "0 18px", borderRadius: 10, fontSize: 16, fontWeight: 600, color: COLORS.white, backgroundColor: COLORS.primary, border: "none", cursor: "pointer", flexShrink: 0 }}
          >
            <UserPlus size={18} /> <span className="topbar-register-label">Register child</span>
          </button>
        )}
      </header>

      {!online && (
        <p role="alert" className="offline-banner">
          You're offline. You can keep reading what's on screen, but new records won't save until the connection is back.
        </p>
      )}
      {dataError && (
        <div style={{ padding: "16px 24px 0" }}>
          <p role="alert" style={{ maxWidth: CONTENT_MAX_WIDTH, margin: "0 auto", fontSize: 16, color: COLORS.danger, backgroundColor: COLORS.dangerTint, padding: "12px 16px", borderRadius: 10 }}>
            {dataError}
          </p>
        </div>
      )}

      <main className="app-content">
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
        ) : view === "activity" && isAdmin ? (
          <ActivityLogPage token={token} />
        ) : view === "security" && isAdmin ? (
          <SecuritySettingsPage token={token} />
        ) : view === "system" && isAdmin ? (
          <SystemSettingsPage token={token} onProgrammeNameChange={setProgrammeName} />
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
      </main>
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
