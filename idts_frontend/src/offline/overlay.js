/*
 * Lays entries that are still waiting to sync over server data, so what a
 * health worker just entered offline shows up straight away: a newly
 * registered child in the list, a dose marked as given, a tracing attempt
 * on its case. The server's own answer replaces all of this once synced.
 */

const PENDING_REASON = "Recorded on this device. Waiting to sync.";

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso, toIso) {
  return Math.round((new Date(`${toIso}T00:00:00Z`) - new Date(`${fromIso}T00:00:00Z`)) / 86400000);
}

function todayIso() {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
}

// Port of evaluate_dose (idts_backend/app/domain/schedule_engine.py), used
// only for children registered on this device that the server hasn't seen.
export function evaluateSchedule(dob, schedule, givenByEntry) {
  const today = todayIso();
  return schedule.map((entry) => {
    const base = {
      schedule_entry_id: entry.id, antigen: entry.antigen, dose_number: entry.dose_number,
      dosage: entry.dosage, route: entry.route, site: entry.site,
    };
    if (givenByEntry[entry.id]) {
      return { ...base, status: "administered", days_overdue: 0, reason: PENDING_REASON, eligible_date: null };
    }
    let eligible = addDays(dob, entry.minimum_age_days);
    const prior = entry.prior_entry_id && givenByEntry[entry.prior_entry_id];
    if (prior && entry.minimum_interval_from_prior_dose_days != null) {
      const intervalAnchor = addDays(prior, entry.minimum_interval_from_prior_dose_days);
      if (intervalAnchor > eligible) eligible = intervalAnchor;
    }
    if (entry.maximum_catchup_age_days != null && today > addDays(dob, entry.maximum_catchup_age_days)) {
      return { ...base, status: "not_applicable", days_overdue: 0, eligible_date: eligible,
        reason: `${entry.antigen} dose ${entry.dose_number} is past the maximum catch-up age; needs clinical review.` };
    }
    const daysOverdue = daysBetween(eligible, today);
    if (daysOverdue < 0) {
      return { ...base, status: "not_yet_due", days_overdue: daysOverdue, eligible_date: eligible,
        reason: `${entry.antigen} dose ${entry.dose_number} becomes due on ${eligible}.` };
    }
    let status = "due";
    let label = "due";
    if (daysOverdue <= entry.due_soon_window_days) { status = "due_soon"; label = "due soon"; }
    else if (daysOverdue <= entry.due_soon_window_days + entry.overdue_window_days) { status = "overdue"; label = "overdue"; }
    else if (daysOverdue > entry.defaulter_threshold_days) { status = "defaulter"; label = "classified as defaulter"; }
    return { ...base, status, days_overdue: daysOverdue, eligible_date: eligible,
      reason: `${entry.antigen} dose ${entry.dose_number} ${label} by ${daysOverdue} days.` };
  });
}

function childFromRegistration(op) {
  const b = op.body;
  return {
    id: b.id, system_id: "Not synced yet", full_name: b.full_name, sex: b.sex, dob: b.dob,
    dob_estimated: !!b.dob_estimated, facility_id: b.facility_id, community_id: b.community_id || null,
    address: b.address || null, caregiver_name: b.caregiver_name || null, caregiver_phone: b.caregiver_phone || null,
    status: "active", created_at: new Date(op.createdAt).toISOString(), _pending: true,
  };
}

function vaccinationFromOp(op) {
  const b = op.body;
  return {
    id: b.idempotency_key, child_id: op.refs.childId, schedule_entry_id: b.schedule_entry_id,
    event_date: b.event_date, facility_id: b.facility_id, session_type: b.session_type,
    batch_lot_number: b.batch_lot_number, notes: b.notes, _pending: true,
  };
}

function applyEdits(child, ops) {
  let out = child;
  ops.forEach((op) => {
    if (op.kind === "update_child" && op.refs.childId === child.id) out = { ...out, ...op.body, _pending: true };
  });
  return out;
}

function givenMap(ops, childId) {
  const map = {};
  ops.forEach((op) => {
    if (op.kind === "record_vaccination" && op.refs.childId === childId) map[op.body.schedule_entry_id] = op.body.event_date;
  });
  return map;
}

// Data for a path the server has never sent this device, built purely from
// pending entries (a child registered offline). Returns undefined if none.
export function synthesize(path, ops, schedule) {
  const detail = path.match(/^\/api\/v1\/children\/([0-9a-f-]{36})(\/vaccinations)?$/);
  if (!detail) return undefined;
  const reg = ops.find((op) => op.kind === "register_child" && op.body.id === detail[1]);
  if (!reg) return undefined;
  if (detail[2]) return [];
  const child = childFromRegistration(reg);
  return { ...child, schedule: evaluateSchedule(child.dob, schedule || [], {}), fully_immunized: false };
}

export function applyOverlay(path, data, ops, schedule) {
  if (!ops.length || data == null) return data;
  const [route, query = ""] = path.split("?");

  if (route === "/api/v1/children" && Array.isArray(data)) {
    const facility = new URLSearchParams(query).get("facility_id");
    const known = new Set(data.map((c) => c.id));
    const added = ops
      .filter((op) => op.kind === "register_child" && !known.has(op.body.id) && (!facility || op.body.facility_id === facility))
      .map(childFromRegistration)
      .reverse();
    return [...added, ...data].map((c) => applyEdits(c, ops));
  }

  const detail = route.match(/^\/api\/v1\/children\/([0-9a-f-]{36})(\/vaccinations)?$/);
  if (detail) {
    const childId = detail[1];
    if (detail[2] && Array.isArray(data)) {
      const known = new Set(data.map((v) => v.id));
      const pending = ops
        .filter((op) => op.kind === "record_vaccination" && op.refs.childId === childId && !known.has(op.body.idempotency_key))
        .map(vaccinationFromOp);
      return [...pending.reverse(), ...data];
    }
    if (!detail[2] && data.schedule) {
      const child = applyEdits(data, ops);
      const given = givenMap(ops, childId);
      if (data._pending || data.system_id === "Not synced yet") {
        return { ...child, schedule: evaluateSchedule(child.dob, schedule || [], given) };
      }
      return {
        ...child,
        schedule: data.schedule.map((dose) => (given[dose.schedule_entry_id] && dose.status !== "administered"
          ? { ...dose, status: "administered", reason: PENDING_REASON, _pending: true }
          : dose)),
      };
    }
    return data;
  }

  if (route === "/api/v1/due-list" && Array.isArray(data)) {
    const given = new Set(ops.filter((op) => op.kind === "record_vaccination").map((op) => `${op.refs.childId}:${op.body.schedule_entry_id}`));
    return data
      .filter((row) => !given.has(`${row.child.id}:${row.dose.schedule_entry_id}`))
      .map((row) => ({ ...row, child: applyEdits(row.child, ops) }));
  }

  if (route === "/api/v1/defaulters" && Array.isArray(data)) {
    const byCase = {};
    ops.filter((op) => op.kind === "trace").forEach((op) => { (byCase[op.refs.caseId] ||= []).push(op); });
    return data.map((c) => {
      const pending = byCase[c.id];
      if (!pending) return c;
      const known = new Set((c.tracing_attempts || []).map((a) => a.id));
      const attempts = pending.filter((op) => !known.has(op.body.id)).map((op) => ({
        id: op.body.id, defaulter_case_id: c.id, attempt_date: op.body.attempt_date, method: op.body.method,
        outcome: op.body.outcome, next_followup_date: op.body.next_followup_date, notes: op.body.notes, _pending: true,
      }));
      return {
        ...c,
        status: attempts.length && c.status === "assigned" ? "in_tracing" : c.status,
        tracing_attempts: [...(c.tracing_attempts || []), ...attempts],
      };
    });
  }

  return data;
}
