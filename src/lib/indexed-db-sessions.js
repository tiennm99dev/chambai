// IndexedDB CRUD for exam sessions
import { openDB, txAbortError } from './indexed-db-store';
import { SCHEMA_VERSION } from './types.js';

const STORE = 'sessions';

/**
 * Minimal shape this module reads/writes. Sessions otherwise carry
 * app-defined fields (name, date, createdAt, ...) this module never inspects.
 * @typedef {object} SessionRecord
 * @property {string} [id]
 * @property {string} [name]
 * @property {{ schemaVersion?: number, [key: string]: any }} [config]
 */

/**
 * Sessions persisted before schema-version stamping existed carry no
 * config.schemaVersion field. Stamp them legacy (1) on read so scoring
 * always sees an explicit version to check, without ever promoting old data
 * to the current model just because it was opened.
 * @param {SessionRecord} session
 * @returns {SessionRecord}
 */
function stampLegacyIfMissing(session) {
  if (session?.config && typeof session.config.schemaVersion !== 'number') {
    return { ...session, config: { ...session.config, schemaVersion: 1 } };
  }
  return session;
}

/**
 * Decide the schemaVersion to persist for a session write.
 * - An explicit config.schemaVersion on the incoming session (e.g. set by
 *   session-export-import.js) is always respected.
 * - Updating an already-persisted session preserves whatever version it
 *   already has (defaulting to legacy 1 if that session predates versioning
 *   entirely), so a save never silently reclassifies a teacher's
 *   already-scored session onto a newer scoring model.
 * - A brand-new session has no prior grades to protect, so it can safely
 *   start on the current model.
 * @param {SessionRecord} session
 * @param {SessionRecord|null} existing
 * @returns {SessionRecord}
 */
function withSchemaVersion(session, existing) {
  if (!session.config) return session;
  const explicit = session.config.schemaVersion;
  const schemaVersion = typeof explicit === 'number'
    ? explicit
    : existing
      ? (existing.config?.schemaVersion ?? 1)
      : SCHEMA_VERSION;
  return { ...session, config: { ...session.config, schemaVersion } };
}

/** @returns {Promise<SessionRecord[]>} */
export async function getAllSessions() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result || []).map(stampLegacyIfMissing));
    request.onerror = () => reject(request.error);
    tx.onabort = () => reject(txAbortError(tx));
  });
}

/** @param {string} id @returns {Promise<SessionRecord|null>} */
export async function getSession(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(id);
    request.onsuccess = () => resolve(request.result ? stampLegacyIfMissing(request.result) : null);
    request.onerror = () => reject(request.error);
    tx.onabort = () => reject(txAbortError(tx));
  });
}

/**
 * @param {SessionRecord} session
 * @returns {Promise<SessionRecord>} the session actually persisted (with schemaVersion resolved)
 */
export async function saveSession(session) {
  const existing = session.id ? await getSession(session.id) : null;
  const toSave = withSchemaVersion(session, existing);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(toSave);
    tx.oncomplete = () => resolve(toSave);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(txAbortError(tx));
  });
}

/** @param {string} id @returns {Promise<void>} */
export async function deleteSession(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(txAbortError(tx));
  });
}
