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

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
const TOKEN_KEY = "idts:token";

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

class ApiError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function request(path, { method = "GET", body, token, params, form } = {}) {
  let url = `${API_BASE_URL}${path}`;
  if (params) {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
    ).toString();
    if (qs) url += `?${qs}`;
  }

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

  if (!response.ok) {
    const detail = (data && data.detail) || response.statusText || "Request failed";
    throw new ApiError(typeof detail === "string" ? detail : JSON.stringify(detail), response.status, detail);
  }

  return data;
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
  createChw: (token, fullName, facilityId) =>
    request("/api/v1/users/chw", { method: "POST", token, body: { full_name: fullName, facility_id: facilityId } }),

  listFacilities: (token) => request("/api/v1/facilities", { token }),

  listChildren: (token, facilityId) => request("/api/v1/children", { token, params: { facility_id: facilityId } }),
  getChild: (token, childId) => request(`/api/v1/children/${childId}`, { token }),
  registerChild: (token, payload) => request("/api/v1/children", { method: "POST", token, body: payload }),
  updateChild: (token, childId, payload) =>
    request(`/api/v1/children/${childId}`, { method: "PATCH", token, body: payload }),
  deleteChild: (token, childId) => request(`/api/v1/children/${childId}`, { method: "DELETE", token }),
  findDuplicates: (token, fullName, dob) =>
    request("/api/v1/children/duplicates", { token, params: { full_name: fullName, dob } }),

  listVaccinations: (token, childId) => request(`/api/v1/children/${childId}/vaccinations`, { token }),
  recordVaccination: (token, childId, payload) =>
    request(`/api/v1/children/${childId}/vaccinations`, { method: "POST", token, body: payload }),

  getDueList: (token, { statusFilter, facilityId } = {}) =>
    request("/api/v1/due-list", { token, params: { status_filter: statusFilter, facility_id: facilityId } }),

  listDefaulterCases: (token, statusFilter) =>
    request("/api/v1/defaulters", { token, params: { status_filter: statusFilter } }),
  assignDefaulter: (token, payload) => request("/api/v1/defaulters/assign", { method: "POST", token, body: payload }),
  recordTracingAttempt: (token, caseId, payload) =>
    request(`/api/v1/defaulters/${caseId}/trace`, { method: "POST", token, body: payload }),
  closeCase: (token, caseId, closureReason) =>
    request(`/api/v1/defaulters/${caseId}/close`, { method: "POST", token, body: { closure_reason: closureReason } }),

  getDashboardStats: (token, facilityId) =>
    request("/api/v1/dashboard", { token, params: { facility_id: facilityId } }),

  getVaccinationsSummary: (token, { startDate, endDate, facilityId } = {}) =>
    request("/api/v1/reports/vaccinations-summary", {
      token, params: { start_date: startDate, end_date: endDate, facility_id: facilityId },
    }),
};

export { ApiError, API_BASE_URL };
