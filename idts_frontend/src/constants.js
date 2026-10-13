import { AlertCircle, CheckCircle2, Clock, Info } from "lucide-react";

// Clinical palette: a deep "health service" blue for structure and actions,
// a protective green reserved for doses given / fully immunized, and warm
// alert colours only where a child needs attention. Text colours all clear
// WCAG AA (most AAA) on white so screens stay readable in bright clinics.
export const COLORS = {
  bg: "#F2F6F8",
  ink: "#10222E",
  muted: "#4F6170",
  border: "#D3DEE5",
  inputBorder: "#9FB2BF",
  primary: "#0A5A8A",
  white: "#FFFFFF",
  subtleBg: "#EAF1F5",
  chipBg: "#E3ECF2",
  primaryDark: "#073F63",
  primaryTint: "#DCEBF5",
  protect: "#10633B",
  protectTint: "#DDF3E6",
  danger: "#A1131B",
  dangerTint: "#FDE1E2",
};

export const FONT_STACK = "'Atkinson Hyperlegible Next', 'Segoe UI', Roboto, system-ui, sans-serif";

// Shared content width: wide enough to use up a tablet/desktop screen
// instead of a narrow centered column, capped so text/tables stay readable
// on very wide monitors.
export const CONTENT_MAX_WIDTH = 1180;

// Groups a /api/v1/facilities list by district (each facility now carries
// its chiefdom + district name), for grouped <optgroup> dropdowns now that
// facility lists span more than one district.
export function groupFacilitiesByDistrict(facilities) {
  const groups = {};
  for (const f of facilities) {
    const key = f.district || "Facilities";
    (groups[key] = groups[key] || []).push(f);
  }
  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
}

export function facilityOptionLabel(f) {
  return f.chiefdom ? `${f.name} — ${f.chiefdom}` : f.name;
}

// Status colours escalate with urgency: neutral -> amber -> orange -> solid
// red for defaulters, so the most urgent rows read at a glance even on a
// dim phone screen. Every badge also carries an icon + word, never colour alone.
export const STATUS_META = {
  not_yet_due: { label: "Not yet due", chart: "#8FA3B1", color: "#3E5160", bg: "#E8EDF1", border: "#CBD6DE", icon: Clock },
  due_soon: { label: "Due soon", chart: "#E0A100", color: "#6A4300", bg: "#FFF1CC", border: "#F2D27A", icon: Clock },
  due: { label: "Due", chart: "#E36A1E", color: "#8F3305", bg: "#FFE6D5", border: "#F5B58C", icon: AlertCircle },
  overdue: { label: "Overdue", chart: "#C9501A", color: "#8F3305", bg: "#FFE6D5", border: "#F5B58C", icon: AlertCircle },
  defaulter: { label: "Defaulter", chart: "#B3141D", color: "#FFFFFF", bg: "#B3141D", border: "#B3141D", icon: AlertCircle },
  administered: { label: "Given", chart: "#1E8A52", color: "#0B5530", bg: "#DDF3E6", border: "#9ED6B4", icon: CheckCircle2 },
  not_applicable: { label: "Needs review", chart: "#6B7F8E", color: "#3E5160", bg: "#E8EDF1", border: "#CBD6DE", icon: Info },
};

export const PRIORITY_META = {
  high: { label: "High priority", color: "#A1131B", bg: "#FDE1E2" },
  medium: { label: "Medium priority", color: "#6A4300", bg: "#FFF1CC" },
  low: { label: "Low priority", color: "#3E5160", bg: "#E8EDF1" },
};

export const CASE_STATUS_META = {
  assigned: { label: "Assigned", color: "#6A4300", bg: "#FFF1CC" },
  in_tracing: { label: "In tracing", color: "#6A4300", bg: "#FFF1CC" },
  return_pending_confirmation: { label: "Return pending confirmation", color: "#0B5530", bg: "#DDF3E6" },
  closed: { label: "Closed", color: "#3E5160", bg: "#E8EDF1" },
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
