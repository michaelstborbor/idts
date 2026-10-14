import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Menu as MenuIcon, UserPlus } from "lucide-react";
import { api, clearOfflineData, getStoredToken, onUnauthorized, setSessionUser, setStoredToken } from "./api/client.js";
import { onSynced } from "./offline/sync.js";
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
import Dhis2Page from "./pages/Dhis2Page.jsx";
import AssignCaseModal from "./components/AssignCaseModal.jsx";
import CaseDetailModal from "./components/CaseDetailModal.jsx";
import Sidebar, { navSections } from "./components/Sidebar.jsx";
import { SyncPanel, SyncPill, useSyncState } from "./components/SyncStatus.jsx";
import { Modal, PrimaryButton, SecondaryButton } from "./components/ui.jsx";

// Views where the "Register child" quick-action makes sense
const REGISTER_BUTTON_VIEWS = ["dashboard", "list", "due", "followup"];
const ADMIN_VIEWS = ["admin", "activity", "security", "system", "dhis2"];
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
  const sync = useSyncState();
  const [syncPanelOpen, setSyncPanelOpen] = useState(false);
  const [packInfo, setPackInfo] = useState(null);
  const [refreshingPack, setRefreshingPack] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

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
        setSessionUser(me.id);
        setCurrentUser(me);
      } catch (err) {
        // Offline with nothing saved yet: keep the stored session and show
        // sign-in; only a refused token is thrown away.
        if (err.status !== 0) {
          setStoredToken(null);
          setSessionUser(null);
        }
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
    // Each list loads on its own, so one that was never saved on this
    // device doesn't blank the others while offline.
    const results = await Promise.allSettled([
      api.listFacilities(token),
      api.listChildren(token),
      api.getDueList(token),
      api.listDefaulterCases(token),
      api.listDefaulterCases(token, "closed"),
      api.getDashboardStats(token),
    ]);
    const [facilityList, childList, due, open, closed, dashboardStats] = results.map((r) => (r.status === "fulfilled" ? r.value : null));
    if (facilityList) setFacilities(facilityList);
    if (childList) setChildren(childList);
    if (due) setDueRows(due);
    if (open) setOpenCases(open);
    if (closed) setClosedCases(closed);
    if (dashboardStats) setFullyImmunizedIds(new Set(dashboardStats.fully_immunized_child_ids || []));
    const failure = results.find((r) => r.status === "rejected" && r.reason?.status !== 0);
    if (failure) setDataError(failure.reason.message);
    else if (!childList) setDataError(results.find((r) => r.status === "rejected")?.reason?.message || "");
    setDataLoading(false);
  }, [token]);

  const refreshPack = useCallback(async (force = false) => {
    if (!token || !navigator.onLine) return;
    setRefreshingPack(true);
    try {
      setPackInfo(await api.refreshOfflinePack(token, { maxAgeMs: force ? 0 : undefined }));
    } catch { /* keep the previous copy */ } finally {
      setRefreshingPack(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token || !currentUser) return undefined;
    api.getOfflinePackInfo().then(setPackInfo).catch(() => {});
    refreshPack();
    // When queued entries reach the server, reload so lists show the
    // server's own records (real IDTS numbers, recalculated statuses).
    return onSynced(() => { loadAll(); refreshPack(true); });
  }, [token, currentUser, loadAll, refreshPack]);

  useEffect(() => {
    if (online && token && currentUser) { loadAll(); refreshPack(); }
  }, [online]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onUnauthorized(() => {
      // Session expired: back to sign-in, but keep this person's saved
      // records and queued entries for when they sign in again.
      setStoredToken(null);
      setSessionUser(null);
      setToken(null);
      setCurrentUser(null);
      setSessionExpired(true);
    });
  }, []);

  useEffect(() => { if (token && currentUser) loadAll(); }, [token, currentUser, loadAll]);

  function handleLogin(newToken, me) {
    setSessionUser(me.id);
    setSessionExpired(false);
    setToken(newToken);
    setCurrentUser(me);
    api.getMe(newToken).catch(() => {}); // saves the profile for offline restarts
  }

  function requestLogout() {
    if (sync && sync.pending + sync.failed > 0) setConfirmLogout(true);
    else handleLogout();
  }

  function handleLogout() {
    const userId = currentUser?.id;
    setConfirmLogout(false);
    setStoredToken(null);
    setSessionUser(null);
    clearOfflineData(userId);
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
    return <LoginPage onLogin={handleLogin} notice={sessionExpired ? "Your session has ended. Sign in again to keep working; anything saved on this device will then sync." : ""} />;
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
    dhis2: "DHIS2 integration",
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
        onLogout={requestLogout}
      />

      <div className="app-main">
      <header className="topbar">
        <button className="topbar-menu" onClick={() => setDrawerOpen(true)} aria-label="Open menu" aria-expanded={drawerOpen}>
          <MenuIcon size={22} />
        </button>
        <h1 className="page-title" style={{ fontSize: 26, fontWeight: 700, color: COLORS.ink, margin: 0, flex: 1, minWidth: 0 }}>{viewTitle}</h1>
        <SyncPill online={online} sync={sync} onOpen={() => setSyncPanelOpen(true)} />
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
          You're offline. Keep working: new registrations, doses and follow-up are saved on this device and sync when the connection is back.
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
        ) : view === "dhis2" && isAdmin ? (
          <Dhis2Page token={token} />
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

      {syncPanelOpen && (
        <SyncPanel
          online={online}
          sync={sync}
          packInfo={packInfo}
          refreshingPack={refreshingPack}
          onRefreshPack={() => refreshPack(true)}
          onClose={() => setSyncPanelOpen(false)}
        />
      )}

      {confirmLogout && (
        <Modal title="Sign out with unsynced entries?" onClose={() => setConfirmLogout(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ fontSize: 16, margin: 0, lineHeight: 1.55 }}>
              {sync.pending + sync.failed} {sync.pending + sync.failed === 1 ? "entry hasn't" : "entries haven't"} reached the server yet.
              They stay on this device and sync the next time you sign in here.
            </p>
            <div style={{ display: "flex", gap: 12 }}>
              <SecondaryButton onClick={() => setConfirmLogout(false)} style={{ flex: 1 }}>Stay signed in</SecondaryButton>
              <PrimaryButton onClick={handleLogout} style={{ flex: 1 }}>Sign out</PrimaryButton>
            </div>
          </div>
        </Modal>
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
