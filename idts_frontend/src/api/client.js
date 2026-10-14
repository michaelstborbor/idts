/*
 * Thin fetch wrapper around the IDTS backend API.
 *
 * This is the one file that changed the most from the Claude-artifact
 * prototype: instead of window.storage.get/set (which only exists inside
 * Claude's chat interface), everything now goes over real HTTP to the
 * FastAPI backend from Milestone 6. The token is kept in both React state
 * (for reactive UI) and localStorage (so a page refresh doesn't log you
 * out) — localStorage is fine here because this is a normal standalone
 * web app now, not a Claude artifact sandbox.
 */

import { cacheClearUser, cacheGet, cachePut, cachePutMany } from "../offline/store.js";
import { applyOverlay, synthesize } from "../offline/overlay.js";
import { configureSync, enqueue, hasQueuedWork, newId, pendingOpsFor, setSyncUser } from "../offline/sync.js";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
const TOKEN_KEY = "idts:token";
const USER_KEY = "idts:user-id";
const PACK_KEY = "offline:pack-info";
const SCHEDULE_KEY = "offline:schedule";
// Lookups that shouldn't pile up on the device.
const NO_CACHE = [/\/children\/duplicates/, /\/children\/search/, /\/admin\/audit-logs/, /\/aefi\/suggest/];

let sessionUserId = (() => { try { return localStorage.getItem(USER_KEY); } catch { return null; } })();
let unauthorizedHandler = null;

export function getStoredToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // localStorage unavailable (e.g. private browsing) — session-only auth
  }
}

// Remembers who is signed in on this device, so cached data and queued
// entries belong to the right person, even after a restart while offline.
export function setSessionUser(id) {
  sessionUserId = id;
  try {
    if (id) localStorage.setItem(USER_KEY, id);
    else localStorage.removeItem(USER_KEY);
  } catch { /* session-only */ }
  setSyncUser(id);
}

export function getSessionUserId() {
  return sessionUserId;
}

export function onUnauthorized(fn) {
  unauthorizedHandler = fn;
}

// Sign-out on a shared device: drop this person's cached records. Entries
// still waiting to sync stay, and go up next time they sign in.
export async function clearOfflineData(userId) {
  if (userId) await cacheClearUser(userId);
}

class ApiError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

function withQuery(path, params) {
  if (!params) return path;
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
  ).toString();
  return qs ? `${path}${path.includes("?") ? "&" : "?"}${qs}` : path;
}

// GETs go to the network first and fall back to the copy saved on this
// device. Either way, entries still waiting to sync are laid on top.
async function request(path, options = {}) {
  const { method = "GET", token, params, skipOffline } = options;
  const fullPath = withQuery(path, params);
  const userId = sessionUserId;
  if (method !== "GET" || !token || skipOffline || !userId || NO_CACHE.some((re) => re.test(fullPath))) {
    return send(fullPath, options);
  }
  let data;
  try {
    data = await send(fullPath, options);
    cachePut(userId, fullPath, data);
  } catch (err) {
    if (err.status !== 0) throw err;
    const cached = await cacheGet(userId, fullPath);
    if (cached) {
      data = cached.data;
    } else {
      const schedule = (await cacheGet(userId, SCHEDULE_KEY))?.data;
      data = synthesize(fullPath, await pendingOpsFor(userId), schedule);
      if (data === undefined) {
        throw new ApiError("You're offline and this hasn't been saved on this device yet. Open it once while online to use it offline.", 0, null);
      }
    }
  }
  const ops = await pendingOpsFor(userId);
  if (!ops.length) return data;
  const schedule = (await cacheGet(userId, SCHEDULE_KEY))?.data;
  return applyOverlay(fullPath, data, ops, schedule);
}

async function send(fullPath, { method = "GET", body, token, form } = {}) {
  const url = `${API_BASE_URL}${fullPath}`;

  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let requestBody;
  if (form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    requestBody = new URLSearchParams(form).toString();
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, { method, headers, body: requestBody });
  } catch (networkErr) {
    throw new ApiError(
      "Couldn't reach the server. Check the API address and your connection.",
      0,
      null
    );
  }

  if (response.status === 204) return null;

  let data = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (response.status === 401 && token && unauthorizedHandler) unauthorizedHandler();

  if (!response.ok) {
    const detail = (data && data.detail) || response.statusText || "Request failed";
    throw new ApiError(typeof detail === "string" ? detail : JSON.stringify(detail), response.status, detail);
  }

  return data;
}

// Downloads a file from an authenticated endpoint (a plain <a href> can't
// send the Authorization header).
async function download(path, { token, params, filename }) {
  let url = `${API_BASE_URL}${path}`;
  const qs = new URLSearchParams(
    Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== "")
  ).toString();
  if (qs) url += `?${qs}`;
  let response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new ApiError("Couldn't reach the server. Check your connection.", 0, null);
  }
  if (!response.ok) throw new ApiError(`Download failed (${response.status}).`, response.status, null);
  const blob = await response.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

// Data entry that must keep working offline. If the device is offline, the
// server can't be reached, or earlier entries are still queued (order
// matters: a dose for a child registered offline must follow that
// registration), the entry is queued and an optimistic result returned.
async function offlineWrite({ token, method, path, body, kind, label, refs, optimistic }) {
  const queueFirst = !navigator.onLine || hasQueuedWork(sessionUserId);
  if (!queueFirst || !sessionUserId) {
    try {
      return await send(path, { method, body, token });
    } catch (err) {
      if (err.status !== 0 || !sessionUserId) throw err;
    }
  }
  await enqueue({ kind, method, path, body, label, refs });
  return { ...optimistic(), _pending: true };
}

function todayLocalIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const api = {
  login: (username, password) =>
    request("/api/v1/auth/login", { method: "POST", form: { username, password } }),

  getMe: (token) => request("/api/v1/users/me", { token }),
  updateMyProfile: (token, fullName) =>
    request("/api/v1/users/me", { method: "PATCH", token, body: { full_name: fullName } }),
  changeMyPassword: (token, currentPassword, newPassword) =>
    request("/api/v1/users/me/change-password", {
      method: "POST", token, body: { current_password: currentPassword, new_password: newPassword },
    }),

  listUsers: (token, { role, includeInactive } = {}) =>
    request("/api/v1/users", { token, params: { role, include_inactive: includeInactive } }),
  createUser: (token, payload) => request("/api/v1/users", { method: "POST", token, body: payload }),
  updateUser: (token, userId, payload) =>
    request(`/api/v1/users/${userId}`, { method: "PATCH", token, body: payload }),
  deleteUser: (token, userId) =>
    request(`/api/v1/users/${userId}`, { method: "DELETE", token }),
  resetUserPassword: (token, userId, newPassword) =>
    request(`/api/v1/users/${userId}/reset-password`, { method: "POST", token, body: { new_password: newPassword } }),
  createChw: (token, fullName, facilityId) =>
    request("/api/v1/users/chw", { method: "POST", token, body: { full_name: fullName, facility_id: facilityId } }),

  listFacilities: (token, { chiefdomId } = {}) => {
    const params = new URLSearchParams();
    if (chiefdomId) params.set("chiefdom_id", chiefdomId);
    const qs = params.toString();
    return request(`/api/v1/facilities${qs ? `?${qs}` : ""}`, { token });
  },
  listCountries: (token) => request("/api/v1/facilities/countries", { token }),
  listDistricts: (token, { countryId } = {}) =>
    request(`/api/v1/facilities/districts${countryId ? `?country_id=${countryId}` : ""}`, { token }),
  listChiefdoms: (token, { districtId, countryId } = {}) => {
    const params = new URLSearchParams();
    if (districtId) params.set("district_id", districtId);
    if (countryId) params.set("country_id", countryId);
    const qs = params.toString();
    return request(`/api/v1/facilities/chiefdoms${qs ? `?${qs}` : ""}`, { token });
  },

  listChildren: (token, facilityId) => request("/api/v1/children", { token, params: { facility_id: facilityId } }),
  getChild: (token, childId) => request(`/api/v1/children/${childId}`, { token }),
  registerChild: (token, payload) => {
    const body = { ...payload, id: payload.id || newId() };
    return offlineWrite({
      token, method: "POST", path: "/api/v1/children", body,
      kind: "register_child", label: `Register ${body.full_name}`, refs: { childId: body.id },
      optimistic: () => ({ ...body, system_id: "Not synced yet", status: "active", created_at: new Date().toISOString() }),
    });
  },
  updateChild: (token, childId, payload, { label } = {}) =>
    offlineWrite({
      token, method: "PATCH", path: `/api/v1/children/${childId}`, body: payload,
      kind: "update_child", label: label || `Edit ${payload.full_name || "child record"}`, refs: { childId },
      optimistic: () => ({ id: childId, ...payload }),
    }),
  deleteChild: (token, childId) => request(`/api/v1/children/${childId}`, { method: "DELETE", token }),
  findDuplicates: (token, fullName, dob) =>
    request("/api/v1/children/duplicates", { token, params: { full_name: fullName, dob } }),

  listVaccinations: (token, childId) => request(`/api/v1/children/${childId}/vaccinations`, { token }),
  recordVaccination: (token, childId, payload, { label } = {}) => {
    const body = { ...payload, idempotency_key: payload.idempotency_key || newId() };
    return offlineWrite({
      token, method: "POST", path: `/api/v1/children/${childId}/vaccinations`, body,
      kind: "record_vaccination", label: label || "Record a dose", refs: { childId },
      optimistic: () => ({ id: body.idempotency_key, child_id: childId, ...body }),
    });
  },

  getDueList: (token, { statusFilter, facilityId } = {}) =>
    request("/api/v1/due-list", { token, params: { status_filter: statusFilter, facility_id: facilityId } }),

  listDefaulterCases: (token, statusFilter) =>
    request("/api/v1/defaulters", { token, params: { status_filter: statusFilter } }),
  assignDefaulter: (token, payload) => request("/api/v1/defaulters/assign", { method: "POST", token, body: payload }),
  recordTracingAttempt: (token, caseId, payload, { label } = {}) => {
    const body = { ...payload, id: payload.id || newId(), attempt_date: payload.attempt_date || todayLocalIso() };
    return offlineWrite({
      token, method: "POST", path: `/api/v1/defaulters/${caseId}/trace`, body,
      kind: "trace", label: label || "Tracing attempt", refs: { caseId },
      optimistic: () => ({ defaulter_case_id: caseId, ...body }),
    });
  },
  closeCase: (token, caseId, closureReason) =>
    request(`/api/v1/defaulters/${caseId}/close`, { method: "POST", token, body: { closure_reason: closureReason } }),

  getDashboardStats: (token, facilityId) =>
    request("/api/v1/dashboard", { token, params: { facility_id: facilityId } }),

  getReportScope: (token) => request("/api/v1/reports/scope", { token }),

  // ---- AEFI (adverse events following immunization) ----
  aefiCatalog: (token) => request("/api/v1/aefi/catalog", { token }),
  aefiSuggest: (token, { eventType, severity, seriousCriteria = [], partOfCluster = false }) => {
    const params = new URLSearchParams();
    params.set("event_type", eventType);
    params.set("severity", severity);
    seriousCriteria.forEach((c) => params.append("serious_criteria", c));
    params.set("part_of_cluster", partOfCluster ? "true" : "false");
    return request(`/api/v1/aefi/suggest?${params.toString()}`, { token });
  },
  aefiChildVaccinations: (token, childId) => request(`/api/v1/aefi/children/${childId}/vaccinations`, { token }),
  listAefi: (token, { severity, seriousOnly } = {}) =>
    request("/api/v1/aefi", { token, params: { severity, serious_only: seriousOnly ? "true" : undefined } }),
  createAefi: (token, payload) => request("/api/v1/aefi", { method: "POST", token, body: payload }),
  updateAefi: (token, aefiId, payload) =>
    request(`/api/v1/aefi/${aefiId}`, { method: "PATCH", token, body: payload }),
  listVaccines: (token) => request("/api/v1/reports/vaccines", { token }),
  generateReport: (token, { level, unitId, antigens, doses, startDate, endDate }) => {
    const params = new URLSearchParams();
    params.set("level", level);
    params.set("unit_id", unitId);
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);
    (antigens || []).forEach((a) => params.append("antigens", a));
    (doses || []).forEach((d) => params.append("doses", d)); // "<antigen>|<dose number>"
    return request(`/api/v1/reports/generate?${params.toString()}`, { token });
  },
  getAggregateReport: (token, { groupBy, startDate, endDate } = {}) =>
    request(`/api/v1/reports/aggregate?group_by=${groupBy}${startDate ? `&start_date=${startDate}` : ""}${endDate ? `&end_date=${endDate}` : ""}`, { token }),
  searchChildren: (token, { name, systemId, dob, caregiverName } = {}) => {
    const params = new URLSearchParams();
    if (name) params.set("name", name);
    if (systemId) params.set("system_id", systemId);
    if (dob) params.set("dob", dob);
    if (caregiverName) params.set("caregiver_name", caregiverName);
    return request(`/api/v1/children/search?${params.toString()}`, { token });
  },
  getVaccinationsSummary: (token, { startDate, endDate, facilityId } = {}) =>
    request("/api/v1/reports/vaccinations-summary", {
      token, params: { start_date: startDate, end_date: endDate, facility_id: facilityId },
    }),
  // Saves every child record in scope (with dose history) and the schedule
  // on this device, so profiles open and doses can be recorded offline.
  refreshOfflinePack: async (token, { maxAgeMs = 15 * 60 * 1000 } = {}) => {
    const userId = sessionUserId;
    if (!userId) return null;
    const info = (await cacheGet(userId, PACK_KEY))?.data;
    if (info && maxAgeMs && Date.now() - info.savedAt < maxAgeMs) return info;
    const pack = await send("/api/v1/children/offline-pack", { token });
    const entries = [[SCHEDULE_KEY, pack.schedule]];
    pack.children.forEach(({ vaccination_history: history, ...child }) => {
      entries.push([`/api/v1/children/${child.id}`, child]);
      entries.push([`/api/v1/children/${child.id}/vaccinations`, history]);
    });
    const next = { savedAt: Date.now(), children: pack.children.length, truncated: pack.truncated };
    entries.push([PACK_KEY, next]);
    await cachePutMany(userId, entries);
    return next;
  },
  getOfflinePackInfo: async () => (sessionUserId ? (await cacheGet(sessionUserId, PACK_KEY))?.data || null : null),

  // Administration
  unlockUser: (token, userId) => request(`/api/v1/users/${userId}/unlock`, { method: "POST", token }),
  getSecuritySettings: (token) => request("/api/v1/admin/settings/security", { token }),
  updateSecuritySettings: (token, body) => request("/api/v1/admin/settings/security", { method: "PUT", token, body }),
  getSystemSettings: (token) => request("/api/v1/admin/settings/system", { token }),
  updateSystemSettings: (token, body) => request("/api/v1/admin/settings/system", { method: "PUT", token, body }),
  getScheduleThresholds: (token) => request("/api/v1/admin/schedule-thresholds", { token }),
  updateScheduleThresholds: (token, rows) => request("/api/v1/admin/schedule-thresholds", { method: "PUT", token, body: rows }),
  getPublicSettings: () => request("/api/v1/settings/public"),
  getSystemInfo: (token) => request("/api/v1/admin/system-info", { token }),
  listAuditLogs: (token, params) => request("/api/v1/admin/audit-logs", { token, params }),
  // DHIS2
  getDhis2Config: (token) => request("/api/v1/admin/dhis2/config", { token }),
  saveDhis2Connection: (token, body) => request("/api/v1/admin/dhis2/connection", { method: "PUT", token, body }),
  testDhis2: (token) => request("/api/v1/admin/dhis2/test", { method: "POST", token }),
  searchDhis2OrgUnits: (token, q) => request("/api/v1/admin/dhis2/remote/org-units", { token, params: { q } }),
  suggestDhis2OrgUnits: (token) => request("/api/v1/admin/dhis2/mapping/org-units/suggestions", { token }),
  listDhis2DataSets: (token) => request("/api/v1/admin/dhis2/remote/data-sets", { token }),
  listDhis2DataElements: (token) => request("/api/v1/admin/dhis2/remote/data-elements", { token }),
  saveDhis2OrgUnits: (token, body) => request("/api/v1/admin/dhis2/mapping/org-units", { method: "PUT", token, body }),
  saveDhis2Doses: (token, body) => request("/api/v1/admin/dhis2/mapping/doses", { method: "PUT", token, body }),
  previewDhis2Export: (token, period) => request("/api/v1/admin/dhis2/export/preview", { token, params: { period } }),
  downloadDhis2Export: (token, period) =>
    download("/api/v1/admin/dhis2/export/download", { token, params: { period }, filename: `idts-dhis2-${period}.json` }),
  pushDhis2Export: (token, period, dryRun) =>
    request("/api/v1/admin/dhis2/export/push", { method: "POST", token, body: { period, dry_run: dryRun } }),
  exportAuditLogs: (token, params) =>
    download("/api/v1/admin/audit-logs/export", {
      token, params, filename: `idts-activity-log-${new Date().toISOString().slice(0, 10)}.csv`,
    }),
};

configureSync({ send, getToken: getStoredToken });

export { ApiError, API_BASE_URL };

