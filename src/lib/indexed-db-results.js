// IndexedDB CRUD for student results (scoped to sessions)
import { openDB, txAbortError } from './indexed-db-store';

const STORE = 'results';

/**
 * Minimal shape this module reads/writes; results otherwise carry the full
 * StudentResult (+ optional debugImageUrl, stripped before persistence).
 * @typedef {object} ResultRecord
 * @property {string} [id]
 * @property {string} [sessionId]
 * @property {string} [debugImageUrl]
 */

/** @param {ResultRecord} result @returns {Promise<void>} */
export async function saveResult(result) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(result);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(txAbortError(tx));
  });
}

/** @param {ResultRecord[]} results @returns {Promise<void>} */
export async function saveResults(results) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const r of results) store.put(r);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(txAbortError(tx));
  });
}

/** @param {string} sessionId @returns {Promise<ResultRecord[]>} */
export async function getSessionResults(sessionId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const index = tx.objectStore(STORE).index('sessionId');
    const request = index.getAll(sessionId);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
    tx.onabort = () => reject(txAbortError(tx));
  });
}

/** @param {string} sessionId @returns {Promise<void>} */
export async function deleteSessionResults(sessionId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const index = tx.objectStore(STORE).index('sessionId');
    const request = index.openCursor(sessionId);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(txAbortError(tx));
  });
}

/**
 * Atomically replace all results for a session: clears every existing row
 * for sessionId, then writes the given results, in a single transaction.
 * Doing this as two separate calls (delete-all then save) is not atomic — a
 * failure between them either loses everything or leaves deleted rows
 * reappearing on reload. This is also the fix for edited/removed students not
 * disappearing: a plain put-only save never removes rows absent from the
 * new array.
 * @param {string} sessionId
 * @param {ResultRecord[]} results
 * @returns {Promise<void>}
 */
export async function replaceSessionResults(sessionId, results) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const index = store.index('sessionId');
    const request = index.openCursor(sessionId);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        for (const r of results) store.put(r);
      }
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(txAbortError(tx));
  });
}
