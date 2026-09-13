// Export and import exam sessions as .chambai.json files
import { getSession, saveSession } from './indexed-db-sessions';
import { getSessionResults, saveResults } from './indexed-db-results';
import { SCHEMA_VERSION } from './types.js';

/**
 * Expected .chambai.json shape once validated. Declared here (not `any`) so
 * `importSession` gets real property checking after the runtime validation
 * below has actually confirmed the shape.
 * @typedef {object} ImportPayload
 * @property {number} version
 * @property {number} [schemaVersion]
 * @property {{ name: string, config: { schemaVersion?: number, [key: string]: any }, [key: string]: any }} session
 * @property {object[]} [results]
 */

/** @param {any} section @returns {boolean} */
function isAnswerKeySection(section) {
  return !!section && Array.isArray(section.answers) && Number.isInteger(section.questionCount);
}

/**
 * Validate an imported .chambai.json payload before anything is written to
 * IndexedDB. A .chambai.json is arbitrary user-supplied input (hand-edited,
 * exported from a different/future build, or simply corrupt) and must never
 * reach IndexedDB or the results page unchecked.
 * Input is intentionally untyped (`any`): this function is exactly the
 * boundary that establishes whether the unknown JSON matches ImportPayload.
 * @param {any} data
 */
function validateImportPayload(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('File không hợp lệ: không đọc được nội dung JSON');
  }
  if (data.version !== 1) {
    throw new Error('Phiên bản file không được hỗ trợ');
  }
  if (typeof data.schemaVersion === 'number' && data.schemaVersion > SCHEMA_VERSION) {
    throw new Error('File được xuất từ phiên bản ứng dụng mới hơn, không thể nhập vào phiên bản hiện tại');
  }
  if (!data.session || typeof data.session !== 'object') {
    throw new Error('File không hợp lệ: thiếu dữ liệu phiên');
  }
  if (typeof data.session.name !== 'string' || data.session.name.trim() === '') {
    throw new Error('File không hợp lệ: thiếu tên phiên');
  }
  const config = data.session.config;
  if (!config || typeof config !== 'object') {
    throw new Error('File không hợp lệ: thiếu cấu hình đề thi');
  }
  for (const key of ['phanI', 'phanII', 'phanIII']) {
    if (!isAnswerKeySection(config[key])) {
      throw new Error(`File không hợp lệ: cấu hình ${key} sai định dạng`);
    }
  }
  if (data.results !== undefined && !Array.isArray(data.results)) {
    throw new Error('File không hợp lệ: kết quả (results) phải là một mảng');
  }
}

/**
 * Export a session + results as a downloadable JSON file.
 * @param {string} sessionId
 */
export async function exportSession(sessionId) {
  const session = await getSession(sessionId);
  if (!session) throw new Error('Phiên không tồn tại');

  const results = await getSessionResults(sessionId);
  const payload = {
    version: 1,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    session,
    results: results.map(({ debugImageUrl, ...rest }) => rest),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  const safeName = (session.name || 'phien').replace(/\s+/g, '_');
  link.download = `${safeName}.chambai.json`;
  // Appending to the document before click() (and deferring the revoke) makes
  // the programmatic click reliable across browsers; revoking synchronously
  // right after click() can cancel an in-flight download in some browsers.
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

/**
 * Import a session from a .chambai.json file.
 * Generates new IDs to avoid collisions.
 * @param {File} file
 * @returns {Promise<object>} - imported session
 */
export async function importSession(file) {
  /** @type {ImportPayload} */
  let data;
  try {
    const text = await file.text();
    data = JSON.parse(text);
  } catch {
    throw new Error('File không hợp lệ: không phải JSON hợp lệ');
  }

  validateImportPayload(data);

  const newSessionId = `session_imported_${Date.now()}`;
  // An older export (from before schemaVersion stamping) carries no
  // config.schemaVersion — treat it as legacy (1) rather than assuming it was
  // scored under the current model. A newer export already carries its own
  // explicit value, which is respected as-is.
  const importedSchemaVersion = typeof data.session.config.schemaVersion === 'number'
    ? data.session.config.schemaVersion
    : 1;

  const session = {
    ...data.session,
    id: newSessionId,
    name: `${data.session.name} (nhập)`,
    config: { ...data.session.config, schemaVersion: importedSchemaVersion },
    importedAt: Date.now(),
    updatedAt: Date.now(),
  };

  await saveSession(session);

  if (Array.isArray(data.results) && data.results.length > 0) {
    // Ids derived from the loop index: collision-free regardless of whether
    // source rows carry an id at all (unlike a clock-derived id, which can be
    // identical for every row in a fast loop and overwrite by keyPath), and
    // stable across a re-import of the same file (idempotent put).
    const results = data.results.map((r, i) => ({
      ...r,
      id: `imp_${newSessionId}_${i}`,
      sessionId: newSessionId,
    }));
    // Single batched transaction instead of one write per result.
    await saveResults(results);
  }

  return session;
}
