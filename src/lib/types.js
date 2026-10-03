// Shared JSDoc type definitions for the answer sheet scoring system
// This file is never imported at runtime — only referenced via @type/@param JSDoc tags.

/**
 * @typedef {object} Point
 * @property {number} x
 * @property {number} y
 */

/**
 * @typedef {object} BoundingBox
 * @property {number} left
 * @property {number} right
 * @property {number} top
 * @property {number} bottom
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {object} MarkerDetectionResult
 * @property {Point[]} corners - Detected corner marker centers (0–4)
 * @property {Point[]} edges - All candidate marker centers
 * @property {BoundingBox} boundingBox - Bounding box of the answer area
 */

/** @typedef {'a'|'b'|'c'|'d'} SubOption */

/**
 * @typedef {object} Bubble
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 * @property {number} area
 * @property {number} circularity
 * @property {string} section - 'studentId' | 'examCode' | 'section1' | 'section2' | 'section3'
 * @property {number} [column] - Column index (for studentId/examCode grids)
 * @property {number} [row] - Row index / digit value (for studentId/examCode grids)
 * @property {number} [question] - Question number (for answer sections)
 * @property {string} [option] - 'A' | 'B' | 'C' | 'D' (for section1)
 * @property {SubOption} [subOption] - true/false sub-item label (for section2)
 * @property {boolean} [value] - true/false bubble (for section2)
 * @property {number} [digit] - Digit value 0–9 (for section3, legacy single-digit model)
 * @property {number} [charPosition] - Character position index 0–4 (for section3 multi-char)
 * @property {string} [charValue] - Character value: '-', ',', '0'–'9' (for section3 multi-char)
 */

/**
 * Tri-state true/false answer. `null` means the student left the sub-item blank.
 * A blank sub-item must never compare equal to a key value and never earns credit.
 * @typedef {object} TrueFalseAnswer
 * @property {boolean|null} a
 * @property {boolean|null} b
 * @property {boolean|null} c
 * @property {boolean|null} d
 */

/**
 * @typedef {object} ScoringConfig
 * @property {{ pointsPerQuestion: number }} phanI
 * @property {{ pointsPerQuestion: number, partialCredit: boolean }} phanII
 * @property {{ pointsPerQuestion: number }} phanIII
 */

/**
 * @typedef {object} TestConfig
 * @property {{ questionCount: number, answers: string[] }} phanI
 * @property {{ questionCount: number, answers: TrueFalseAnswer[] }} phanII
 * @property {{ questionCount: number, answers: string[] }} phanIII
 * @property {ScoringConfig} [scoring]
 */

/**
 * @typedef {object} ScoreResult
 * @property {number} phanI
 * @property {number} phanII
 * @property {number} phanIII
 * @property {number} total
 * @property {number} maxTotal
 * @property {number} percentage
 * @property {boolean} [legacyPhanII] - Phần II scored with the pre-CV1239 linear model (older sessions)
 * @property {boolean} [unscored] - the result failed processing and earned no marks
 */

/**
 * Detection output. `studentId`/`examCode` use UNKNOWN_DIGIT for any position whose
 * bubble could not be read, so string length always equals the printed field width.
 * @typedef {object} ProcessingResult
 * @property {string} studentId
 * @property {string} examCode
 * @property {string[]} phanI
 * @property {TrueFalseAnswer[]} phanII
 * @property {string[]} phanIII
 * @property {number} confidence
 * @property {string} [debugImageUrl]
 * @property {boolean} [needsReview] - true when any field contains UNKNOWN_DIGIT
 */

/**
 * @typedef {object} StudentResult
 * @property {string} id
 * @property {string} fileName
 * @property {string} studentId
 * @property {string} [examCode]
 * @property {string[]} phanI
 * @property {TrueFalseAnswer[]} phanII
 * @property {string[]} phanIII
 * @property {boolean} [processed]
 * @property {string} [debugImageUrl]
 * @property {ScoreResult} [score]
 * @property {boolean} [needsReview]
 * @property {boolean} [corrected] - answers were edited by hand in the correction modal
 * @property {Record<number, Record<string, number>>} [confidenceMap] - Phần I fill ratio per question and option
 * @property {import('./image-quality-check.js').QualityReport} [qualityReport]
 * @property {string} [error] - Set when processing failed; such a result is never scored.
 */

/** @typedef {'phanI'|'phanII'|'phanIII'} SectionKey */

/**
 * Answer key and scoring as edited in the UI and stored on a session. The
 * persistence layer stamps `schemaVersion` (see indexed-db-sessions.js).
 * @typedef {TestConfig & { schemaVersion?: number }} SessionConfig
 */

/**
 * An exam session as kept in IndexedDB. `date` and `createdAt` are always set
 * for sessions created in the app but may be absent on an imported file.
 * @typedef {object} Session
 * @property {string} id
 * @property {string} name
 * @property {string} [date] - ISO date (YYYY-MM-DD) shown in the session list
 * @property {SessionConfig} config
 * @property {number} [createdAt] - epoch ms
 * @property {number} updatedAt - epoch ms
 * @property {number} [importedAt] - epoch ms, set when the session came from an imported file
 */

/** @typedef {StudentResult & { sessionId?: string }} SessionResult */

/**
 * Placeholder character written into a digit string when a position could not be read.
 * Never matches a real digit, so a partially-read field cannot be silently mis-graded.
 */
export const UNKNOWN_DIGIT = '?';

/** Schema version for exported/persisted sessions. Bump when stored shapes change. */
export const SCHEMA_VERSION = 3;

// OpenCV.js types come from @techstark/opencv-js (a devDependency used for types
// only). Its version must match the runtime build loaded from the CDN in
// src/components/opencv-loader.jsx.
/** @typedef {typeof import('@techstark/opencv-js')} OpenCV */
/** @typedef {import('@techstark/opencv-js').Mat} OpenCVMat */
