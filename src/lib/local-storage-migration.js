// One-time migration from localStorage to IndexedDB sessions
import { saveSession } from './indexed-db-sessions';
import { saveResults } from './indexed-db-results';

const DEFAULT_CONFIG = {
  phanI: { questionCount: 40, answers: [] },
  phanII: { questionCount: 8, answers: [] },
  phanIII: { questionCount: 6, answers: [] },
  scoring: {
    phanI: { pointsPerQuestion: 0.25 },
    phanII: { pointsPerQuestion: 0.25, partialCredit: true },
    phanIII: { pointsPerQuestion: 0.5 },
  },
};

// Fixed (not clock-derived) so a retry after a mid-migration failure re-runs
// as idempotent puts against the same session/result ids instead of creating
// a second duplicate session with orphaned partial data.
const MIGRATED_SESSION_ID = 'session_migrated_local_storage';

/**
 * Migrate existing localStorage data to IndexedDB.
 * Creates an "Imported Session" with existing config + results.
 * Removes localStorage keys only after the IndexedDB writes have committed.
 * @returns {Promise<object|null>} - migrated session, or null if nothing to migrate
 */
export async function migrateFromLocalStorage() {
  if (typeof window === 'undefined') return null;
  if (localStorage.getItem('chambai_migrated')) return null;

  const configStr = localStorage.getItem('testConfig');
  const resultsStr = localStorage.getItem('studentResults');
  if (!configStr && !resultsStr) {
    localStorage.setItem('chambai_migrated', '1');
    return null;
  }

  let config;
  try {
    config = configStr ? JSON.parse(configStr) : DEFAULT_CONFIG;
  } catch {
    // Corrupt config: nothing safe to migrate as a test setup. Mark migrated
    // so boot does not retry forever on the same unparseable data, but leave
    // the raw localStorage keys in place for manual recovery.
    localStorage.setItem('chambai_migrated', '1');
    return null;
  }
  if (!config || typeof config !== 'object') config = DEFAULT_CONFIG;

  let results = [];
  if (resultsStr) {
    try {
      const parsed = JSON.parse(resultsStr);
      if (Array.isArray(parsed)) results = parsed;
    } catch {
      // Corrupt results: migrate the config alone rather than losing both.
      results = [];
    }
  }

  const session = {
    id: MIGRATED_SESSION_ID,
    name: 'Phiên nhập khẩu',
    date: new Date().toISOString().split('T')[0],
    // This data predates the CV1239 tier fix entirely; mark it legacy so
    // Phần II scores never silently change compared to what a teacher
    // previously saw in the old localStorage-only version of the app.
    config: { ...config, schemaVersion: 1 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await saveSession(session);
  if (results.length > 0) {
    // Single batched transaction instead of one write per result — also
    // makes a mid-migration retry idempotent (put by id) rather than an N+1
    // sequence of independently-committing writes.
    await saveResults(results.map((r) => ({ ...r, sessionId: MIGRATED_SESSION_ID })));
  }

  // Only remove the source data once both writes above resolved. If either
  // threw, this function throws too and none of these three lines run, so
  // the next boot retries the (now-idempotent) migration instead of losing data.
  localStorage.removeItem('testConfig');
  localStorage.removeItem('studentResults');
  localStorage.setItem('chambai_migrated', '1');

  return session;
}
