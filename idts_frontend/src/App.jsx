import React, { useCallback, useEffect, useMemo, useState } from "react";
import { UserPlus } from "lucide-react";
import { api, getStoredToken, setStoredToken } from "./api/client.js";
import { COLORS } from "./constants.js";
import LoginPage from "./pages/LoginPage.jsx";
import RegisterForm from "./pages/RegisterForm.jsx";
import ChildrenListPage from "./pages/ChildrenListPage.jsx";
import ChildProfilePage from "./pages/ChildProfilePage.jsx";
import DueDefaulterListPage from "./pages/DueDefaulterListPage.jsx";
import FollowUpPage from "./pages/FollowUpPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import AssignCaseModal from "./components/AssignCaseModal.jsx";
import CaseDetailModal from "./components/CaseDetailModal.jsx";

const NAV_TABS = [
  { value: "dashboard", label: "Dashboard" },
  { value: "list", label: "All children" },
  { value: "due", label: "Due & defaulters" },
  { value: "followup", label: "Follow-up" },
];

export default function App() {
  const [token, setToken] = useState(getStoredToken());
  const [currentUser, setCurrentUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [facilities, setFacilities] = useState([]);
  const [children, setChildren] = useState([]);
  const [dueRows, setDueRows] = useState([]);
  const [openCases, setOpenCases] = useState([]);
  const [closedCases, setClosedCases] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState("");

  const [view, setView] = useState("dashboard");
  const [activeChildId, setActiveChildId] = useState(null);
  const [assignTarget, setAssignTarget] = useState(null);
  const [caseModalTarget, setCaseModalTarget] = useState(null);

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
      const [facilityList, childList, due, open, closed] = await Promise.all([
        api.listFacilities(token),
        api.listChildren(token),
        api.getDueList(token),
        api.listDefaulterCases(token),
        api.listDefaulterCases(token, "closed"),
      ]);
      setFacilities(facilityList);
      setChildren(childList);
      setDueRows(due);
      setOpenCases(open);
      setClosedCases(closed);
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
  const allCases = useMemo(() => [...openCases, ...closedCases], [openCases, closedCases]);

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

  const isListLikeView = ["dashboard", "list", "due", "followup"].includes(view);
  const viewTitle = {
    dashboard: "Dashboard",
    list: "Children & immunization status",
    due: "Due & defaulter list",
    followup: "Defaulter follow-up",
  }[view] || "Children & immunization status";

  return (
    <div style={{ backgroundColor: COLORS.bg, minHeight: "100vh", fontFamily: "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ padding: "20px 20px 0" }} className="app-header-pad">
        <div style={{ maxWidth: 640, margin: "0 auto 28px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <p style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: COLORS.primary, marginBottom: 4 }}>
                IDTS · {currentUser.full_name} ({currentUser.role.replace(/_/g, " ")})
              </p>
              <h1 style={{ fontSize: 26, fontWeight: 600, color: COLORS.ink, margin: 0 }}>{viewTitle}</h1>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              {isListLikeView && (
                <button
                  onClick={() => setView("register")}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 8, fontSize: 14, fontWeight: 500, color: "#fff", backgroundColor: COLORS.primary, border: "none", cursor: "pointer" }}
                >
                  <UserPlus size={16} /> Register child
                </button>
              )}
              <button
                onClick={handleLogout}
                style={{ padding: "10px 14px", borderRadius: 8, fontSize: 14, fontWeight: 500, color: COLORS.ink, backgroundColor: COLORS.white, border: `1px solid ${COLORS.inputBorder}`, cursor: "pointer" }}
              >
                Sign out
              </button>
            </div>
          </div>

          {dataError && (
            <p style={{ marginTop: 12, fontSize: 14, color: "#8C2E1C", backgroundColor: "#F6D9D2", padding: "10px 14px", borderRadius: 8 }}>
              {dataError}
            </p>
          )}

          {isListLikeView && (
            <div style={{ display: "flex", gap: 4, marginTop: 20, padding: 4, borderRadius: 8, backgroundColor: COLORS.chipBg, width: "fit-content", flexWrap: "wrap" }}>
              {NAV_TABS.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setView(t.value)}
                  style={{
                    padding: "6px 14px", borderRadius: 6, fontSize: 14, fontWeight: 500, border: "none", cursor: "pointer",
                    backgroundColor: view === t.value ? COLORS.white : "transparent",
                    color: view === t.value ? COLORS.primary : "#6B6660",
                  }}
                >
                  {t.label}{t.value === "followup" && activeCaseCount > 0 ? ` (${activeCaseCount})` : ""}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: "0 20px 60px" }}>
        {view === "register" ? (
          <RegisterForm
            token={token}
            facilities={facilities}
            onRegistered={() => { setView("list"); loadAll(); }}
            onCancel={() => setView("list")}
          />
        ) : view === "profile" && activeChildId ? (
          <ChildProfilePage
            token={token}
            childId={activeChildId}
            facilities={facilities}
            onBack={() => { setView("list"); loadAll(); }}
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
        ) : view === "dashboard" ? (
          <DashboardPage children={children} dueRows={dueRows} allCases={allCases} loading={dataLoading} />
        ) : (
          <ChildrenListPage
            children={children}
            dueRowsByChildId={Object.fromEntries(dueRows.map((r) => [r.child.id, r]))}
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
