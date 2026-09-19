import { AlertCircle, CheckCircle2, Clock, Info } from "lucide-react";

export const COLORS = {
  bg: "#FAF8F5",
  ink: "#2B2B28",
  muted: "#8A8478",
  border: "#EAE6DD",
  inputBorder: "#D9D4C9",
  primary: "#1D4E4A",
  white: "#FFFFFF",
  subtleBg: "#F7F5F0",
  chipBg: "#EFEBE3",
};

export const STATUS_META = {
  not_yet_due: { label: "Not yet due", color: "#8A8478", bg: "#F1EFEA", icon: Clock },
  due_soon: { label: "Due soon", color: "#8A6A1F", bg: "#FBF1DC", icon: Clock },
  due: { label: "Due", color: "#B4472F", bg: "#FBE9E4", icon: AlertCircle },
  overdue: { label: "Overdue", color: "#B4472F", bg: "#FBE9E4", icon: AlertCircle },
  defaulter: { label: "Defaulter", color: "#8C2E1C", bg: "#F6D9D2", icon: AlertCircle },
  administered: { label: "Given", color: "#2F6B4F", bg: "#E4F1EA", icon: CheckCircle2 },
  not_applicable: { label: "Needs review", color: "#6B6660", bg: "#EDEBE6", icon: Info },
};

export const PRIORITY_META = {
  high: { label: "High priority", color: "#8C2E1C", bg: "#F6D9D2" },
  medium: { label: "Medium priority", color: "#8A6A1F", bg: "#FBF1DC" },
  low: { label: "Low priority", color: "#6B6660", bg: "#EDEBE6" },
};

export const CASE_STATUS_META = {
  assigned: { label: "Assigned", color: "#8A6A1F", bg: "#FBF1DC" },
  in_tracing: { label: "In tracing", color: "#8A6A1F", bg: "#FBF1DC" },
  return_pending_confirmation: { label: "Return pending confirmation", color: "#2F6B4F", bg: "#E4F1EA" },
  closed: { label: "Closed", color: "#6B6660", bg: "#EDEBE6" },
};

export const SESSION_TYPES = [
  { value: "fixed", label: "Fixed facility" },
  { value: "outreach", label: "Outreach" },
  { value: "mobile", label: "Mobile session" },
  { value: "community", label: "Community session" },
];

export const TRACING_METHODS = [
  { value: "phone_call", label: "Phone call" },
  { value: "sms", label: "SMS" },
  { value: "home_visit", label: "Home visit" },
  { value: "community_leader", label: "Community leader referral" },
  { value: "facility_contact", label: "Facility contact" },
  { value: "other", label: "Other" },
];

export const TRACING_OUTCOMES = [
  { value: "contacted_successfully", label: "Contacted successfully" },
  { value: "vaccinated_elsewhere", label: "Child vaccinated elsewhere" },
  { value: "scheduled_to_return", label: "Child scheduled to return" },
  { value: "returned_to_facility", label: "Child returned to facility" },
  { value: "caregiver_refused", label: "Caregiver refused" },
  { value: "wrong_number", label: "Wrong phone number" },
  { value: "phone_off", label: "Phone switched off" },
  { value: "no_answer", label: "No answer" },
  { value: "child_moved", label: "Child moved" },
  { value: "child_deceased", label: "Child deceased" },
  { value: "not_found", label: "Child not found" },
  { value: "caregiver_unavailable", label: "Caregiver unavailable" },
  { value: "other", label: "Other" },
];

export const CLOSURE_REASONS = [
  { value: "vaccinated_returned", label: "Vaccinated / returned to service" },
  { value: "vaccinated_elsewhere", label: "Vaccinated elsewhere (verified)" },
  { value: "transferred", label: "Transferred" },
  { value: "moved_out", label: "Moved out of catchment" },
  { value: "deceased", label: "Deceased" },
  { value: "unable_to_locate", label: "Unable to locate" },
  { value: "refused", label: "Refused vaccination" },
  { value: "other", label: "Other" },
];

export function fmtDate(isoDateStr) {
  if (!isoDateStr) return "";
  const d = new Date(`${isoDateStr}T00:00:00`);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function ageLabel(dobStr) {
  const dob = new Date(`${dobStr}T00:00:00`);
  const today = new Date();
  const days = Math.round((today - dob) / 86400000);
  if (days < 0) return "not yet born";
  if (days < 60) return `${days} day${days === 1 ? "" : "s"} old`;
  const months = Math.floor(days / 30.4);
  if (months < 24) return `${months} month${months === 1 ? "" : "s"} old`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} old`;
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
