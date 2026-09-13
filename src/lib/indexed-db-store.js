// IndexedDB wrapper for chambai app data
// Stores: debugImages (v1), sessions + results (v2)

const DB_NAME = 'chambai';
const DB_VERSION = 2;
const STORE_NAME = 'debugImages';

/** Memoized connection so operations reuse one open handle instead of opening a fresh one each call.
 * @type {Promise<IDBDatabase>|null} */
let dbPromise = null;

/**
 * Open (or create) the IndexedDB database with versioned schema.
 * The connection is memoized: concurrent/subsequent calls reuse the same
 * open connection. The promise is cleared on any failure/blocked/version
 * change so a later call opens a fresh connection instead of reusing a dead one.
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;

      if (oldVersion < 1) {
        db.createObjectStore('debugImages', { keyPath: 'id' });
      }
      if (oldVersion < 2) {
        const sessionStore = db.createObjectStore('sessions', { keyPath: 'id' });
        sessionStore.createIndex('date', 'date');
        const resultStore = db.createObjectStore('results', { keyPath: 'id' });
        resultStore.createIndex('sessionId', 'sessionId');
      }
    };
    // Another connection (e.g. an older tab) is holding the previous version
    // and did not close in time for this upgrade. Reject instead of leaving
    // the promise pending forever, which would otherwise hang the app on its
    // loading spinner with no error.
    request.onblocked = () => {
      dbPromise = null;
      reject(new Error('Cơ sở dữ liệu đang bị khóa bởi một tab khác. Hãy đóng các tab khác của ứng dụng rồi thử lại.'));
    };
    request.onsuccess = () => {
      const db = request.result;
      // A newer tab wants to upgrade the schema; close so it isn't blocked,
      // and drop the memoized promise so this tab reopens on next use.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

/**
 * Build the rejection reason for a transaction that aborted without a
 * preceding request error (explicit abort, storage-quota eviction, private
 * browsing shutdown, etc). Without this, such a transaction never rejects
 * and the calling promise hangs forever.
 * @param {IDBTransaction} tx
 * @returns {Error}
 */
export function txAbortError(tx) {
  return tx.error ?? new DOMException('Giao dịch đã bị hủy', 'AbortError');
}

/**
 * Save a debug image data URL for a student result.
 * @param {string} id - Student result ID
 * @param {string} dataUrl - Base64 data URL of the debug image
 * @returns {Promise<void>}
 */
export async function saveDebugImage(id, dataUrl) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ id, dataUrl });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(txAbortError(tx));
  });
}

/**
 * Get a debug image data URL by student result ID.
 * @param {string} id - Student result ID
 * @returns {Promise<string|null>}
 */
export async function getDebugImage(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result?.dataUrl ?? null);
    request.onerror = () => reject(request.error);
    tx.onabort = () => reject(txAbortError(tx));
  });
}

/**
 * Delete a debug image by student result ID.
 * @param {string} id - Student result ID
 * @returns {Promise<void>}
 */
export async function deleteDebugImage(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(txAbortError(tx));
  });
}

/**
 * Clear all debug images from the store.
 * @returns {Promise<void>}
 */
export async function clearDebugImages() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(txAbortError(tx));
  });
}
