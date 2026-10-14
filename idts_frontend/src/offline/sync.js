/*
 * Outbox and sync engine. Entries made while offline (or while earlier
 * entries are still queued) are stored in order and replayed against the
 * API when the device is back online. Each entry carries a client-chosen
 * id or idempotency key, so a replay after a dropped response never
 * creates a second record on the server.
 */

import { outboxAll, outboxDelete, outboxPut } from "./store.js";

const RETRY_MS = 30000;

let ops = [];
let loaded = false;
let loadPromise = null;
let send = null;
let getToken = () => null;
let userId = null;
let syncing = false;
let lastSyncAt = null;
let needsSignIn = false;
let retryTimer = null;
let seqCounter = 0;
const listeners = new Set();
const syncedListeners = new Set();

export function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  (typeof crypto !== "undefined" && crypto.getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => { b[i] = Math.floor(Math.random() * 256); }));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function loadOutbox() {
  if (!loadPromise) {
    loadPromise = outboxAll().then((rows) => { ops = rows; loaded = true; notify(); });
  }
  return loadPromise;
}

export function configureSync(options) {
  if (options.send) send = options.send;
  if (options.getToken) getToken = options.getToken;
}

export function setSyncUser(id) {
  userId = id;
  needsSignIn = false;
  notify();
  if (id) syncSoon(0);
}

export function getUserOps(id = userId) {
  return ops.filter((op) => op.userId === id);
}

export async function pendingOpsFor(id) {
  if (!loaded) await loadOutbox();
  return ops.filter((op) => op.userId === id);
}

export function hasQueuedWork(id = userId) {
  return ops.some((op) => op.userId === id && op.status === "pending");
}

export function getSyncState() {
  const mine = getUserOps();
  return {
    pending: mine.filter((op) => op.status === "pending").length,
    failed: mine.filter((op) => op.status === "failed").length,
    otherUsers: ops.filter((op) => op.userId !== userId).length,
    items: mine,
    syncing,
    lastSyncAt,
    needsSignIn,
  };
}

function notify() {
  const state = getSyncState();
  listeners.forEach((fn) => fn(state));
}

export function subscribeSync(fn) {
  listeners.add(fn);
  fn(getSyncState());
  return () => listeners.delete(fn);
}

export function onSynced(fn) {
  syncedListeners.add(fn);
  return () => syncedListeners.delete(fn);
}

export async function enqueue(op) {
  if (!loaded) await loadOutbox();
  const full = {
    id: newId(),
    seq: Date.now() * 1000 + (seqCounter++ % 1000),
    userId,
    createdAt: Date.now(),
    status: "pending",
    error: null,
    attempts: 0,
    ...op,
  };
  await outboxPut(full);
  ops = [...ops, full];
  notify();
  syncSoon(500);
  return full;
}

export async function discard(id) {
  await outboxDelete(id);
  ops = ops.filter((op) => op.id !== id);
  notify();
}

export async function retryFailed() {
  const failed = ops.filter((op) => op.userId === userId && op.status === "failed");
  for (const op of failed) {
    const next = { ...op, status: "pending", error: null };
    await outboxPut(next);
    ops = ops.map((o) => (o.id === op.id ? next : o));
  }
  notify();
  return syncNow();
}

function syncSoon(delay) {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { syncNow(); }, delay);
}

export async function syncNow() {
  if (!loaded) await loadOutbox();
  if (syncing || !send || !userId) return;
  const token = getToken();
  if (!token) return;
  const queue = ops.filter((op) => op.userId === userId && op.status === "pending");
  if (!queue.length) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  syncing = true;
  notify();
  let sent = 0;
  let stopped = false;
  for (const op of queue) {
    try {
      await send(op.path, { method: op.method, body: op.body, token, skipOffline: true });
      await outboxDelete(op.id);
      ops = ops.filter((o) => o.id !== op.id);
      sent += 1;
    } catch (err) {
      if (err.status === 0 || err.status >= 500 || err.status === 429) {
        stopped = true; // connection or server trouble: keep everything, try again later
        break;
      }
      if (err.status === 401) {
        needsSignIn = true;
        stopped = true;
        break;
      }
      // The server refused this entry (for example the dose was already
      // recorded by someone else). Keep it so a person can review it.
      const failed = { ...op, status: "failed", error: err.message, attempts: (op.attempts || 0) + 1 };
      await outboxPut(failed);
      ops = ops.map((o) => (o.id === op.id ? failed : o));
    }
    notify();
  }
  syncing = false;
  if (sent > 0) lastSyncAt = Date.now();
  notify();
  if (sent > 0) syncedListeners.forEach((fn) => fn());
  if (stopped && !needsSignIn) syncSoon(RETRY_MS);
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => syncSoon(1000));
  loadOutbox();
}
