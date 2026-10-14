/*
 * IndexedDB storage for offline use. Two stores:
 *   - cache:  the last server response for each GET, per user, so pages
 *             still render without a connection.
 *   - outbox: entries made on this device (registrations, doses, tracing
 *             attempts) waiting to be sent, in the order they were made.
 * Every call fails soft: if IndexedDB is unavailable the app still works
 * online, just without offline support.
 */

const DB_NAME = "idts-offline";
const DB_VERSION = 1;
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("cache")) db.createObjectStore("cache", { keyPath: "key" });
      if (!db.objectStoreNames.contains("outbox")) {
        const outbox = db.createObjectStore("outbox", { keyPath: "id" });
        outbox.createIndex("userId", "userId");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function run(storeName, mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; });
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---- Response cache ----

export async function cacheGet(userId, path) {
  try {
    const row = await run("cache", "readonly", (s) => reqToPromise(s.get(`${userId}|${path}`)));
    return row || null;
  } catch {
    return null;
  }
}

export async function cachePut(userId, path, data) {
  try {
    await run("cache", "readwrite", (s) => { s.put({ key: `${userId}|${path}`, userId, data, savedAt: Date.now() }); });
  } catch { /* offline support is best-effort */ }
}

export async function cachePutMany(userId, entries) {
  try {
    await run("cache", "readwrite", (s) => {
      const savedAt = Date.now();
      entries.forEach(([path, data]) => s.put({ key: `${userId}|${path}`, userId, data, savedAt }));
    });
  } catch { /* best-effort */ }
}

// Removes everything cached for one user (on sign-out, so the next person
// on a shared clinic device can't read it).
export async function cacheClearUser(userId) {
  try {
    await run("cache", "readwrite", (s) => new Promise((resolve) => {
      const cursorReq = s.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return resolve();
        if (cursor.value.userId === userId) cursor.delete();
        cursor.continue();
      };
      cursorReq.onerror = () => resolve();
    }));
  } catch { /* best-effort */ }
}

// ---- Outbox ----

export async function outboxAll() {
  try {
    const rows = await run("outbox", "readonly", (s) => reqToPromise(s.getAll()));
    return (rows || []).sort((a, b) => a.seq - b.seq);
  } catch {
    return [];
  }
}

export async function outboxPut(op) {
  await run("outbox", "readwrite", (s) => { s.put(op); });
}

export async function outboxDelete(id) {
  await run("outbox", "readwrite", (s) => { s.delete(id); });
}

export function isStorageAvailable() {
  return openDb().then(() => true, () => false);
}
