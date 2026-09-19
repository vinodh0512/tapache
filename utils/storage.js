/**
 * Local Data Storage Utility
 * 
 * Safely persists sensor data and sessions to local disk:
 * - backend/data/sensor-data.json
 * - backend/data/sensor-data.csv
 * - backend/data/sessions.json
 * 
 * Safe atomic writes to prevent corruption on unexpected shutdowns.
 */

const fs = require('fs');
const path = require('path');
const { generateCsv, formatCsvRow, CSV_HEADERS } = require('./csv');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SENSOR_JSON_PATH = path.join(DATA_DIR, 'sensor-data.json');
const SENSOR_CSV_PATH = path.join(DATA_DIR, 'sensor-data.csv');
const SESSIONS_JSON_PATH = path.join(DATA_DIR, 'sessions.json');

// Ensure directory exists
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// In-memory data store for responsive queries
let cachedReadings = [];
let cachedSessions = [];
let activeSession = null;
let isWriting = false;
let pendingWrite = false;

/**
 * Format elapsed seconds to HH:MM:SS
 * @param {number} totalSeconds
 * @returns {string}
 */
function formatElapsedTime(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  return [hours, minutes, seconds]
    .map(v => String(v).padStart(2, '0'))
    .join(':');
}

/**
 * Atomic write helper using temp file and rename
 * @param {string} filePath 
 * @param {string} data 
 */
function safeWriteFile(filePath, data) {
  ensureDataDir();
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  try {
    fs.writeFileSync(tempPath, data, 'utf-8');
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    // If rename fails (e.g. cross-device on Windows), fallback to direct write
    try {
      fs.writeFileSync(filePath, data, 'utf-8');
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch (e) {
      console.error(`Failed to safe write file ${filePath}:`, e);
    }
  }
}

/**
 * Initialize storage and load existing data
 */
function initStorage() {
  ensureDataDir();

  // Load or create sensor-data.json
  if (fs.existsSync(SENSOR_JSON_PATH)) {
    try {
      const raw = fs.readFileSync(SENSOR_JSON_PATH, 'utf-8').trim();
      if (!raw) {
        cachedReadings = [];
        safeWriteFile(SENSOR_JSON_PATH, JSON.stringify([], null, 2));
      } else {
        cachedReadings = JSON.parse(raw);
        if (!Array.isArray(cachedReadings)) cachedReadings = [];
      }
    } catch (err) {
      console.warn('Resetting malformed sensor-data.json to empty array:', err.message);
      cachedReadings = [];
      safeWriteFile(SENSOR_JSON_PATH, JSON.stringify([], null, 2));
    }
  } else {
    cachedReadings = [];
    safeWriteFile(SENSOR_JSON_PATH, JSON.stringify([], null, 2));
  }

  // Load or create sessions.json
  if (fs.existsSync(SESSIONS_JSON_PATH)) {
    try {
      const raw = fs.readFileSync(SESSIONS_JSON_PATH, 'utf-8').trim();
      if (!raw) {
        cachedSessions = [];
        safeWriteFile(SESSIONS_JSON_PATH, JSON.stringify([], null, 2));
      } else {
        cachedSessions = JSON.parse(raw);
        if (!Array.isArray(cachedSessions)) cachedSessions = [];
      }
    } catch (err) {
      console.warn('Resetting malformed sessions.json to empty array:', err.message);
      cachedSessions = [];
      safeWriteFile(SESSIONS_JSON_PATH, JSON.stringify([], null, 2));
    }
  } else {
    cachedSessions = [];
    safeWriteFile(SESSIONS_JSON_PATH, JSON.stringify([], null, 2));
  }

  // Check if there is an active session
  activeSession = cachedSessions.find(s => s.status === 'running') || null;

  // Ensure CSV file exists with proper header
  if (!fs.existsSync(SENSOR_CSV_PATH)) {
    safeWriteFile(SENSOR_CSV_PATH, generateCsv(cachedReadings));
  }
}

/**
 * Flush cached readings to disk safely
 */
function flushReadings() {
  if (isWriting) {
    pendingWrite = true;
    return;
  }
  isWriting = true;

  try {
    safeWriteFile(SENSOR_JSON_PATH, JSON.stringify(cachedReadings, null, 2));
    safeWriteFile(SENSOR_CSV_PATH, generateCsv(cachedReadings));
  } catch (err) {
    console.error('Error saving sensor data to disk:', err);
  } finally {
    isWriting = false;
    if (pendingWrite) {
      pendingWrite = false;
      flushReadings();
    }
  }
}

/**
 * Flush sessions to disk
 */
function flushSessions() {
  try {
    safeWriteFile(SESSIONS_JSON_PATH, JSON.stringify(cachedSessions, null, 2));
  } catch (err) {
    console.error('Error saving sessions to disk:', err);
  }
}

/**
 * Add a sensor reading record
 * @param {Object} rawData - Incoming reading payload
 * @param {string} stage - Estimated fermentation stage
 * @returns {Object} Stored reading
 */
function saveSensorReading(rawData, stage = 'EARLY') {
  const now = new Date();
  const isoTimestamp = now.toISOString();

  let elapsedSeconds = 0;
  let sessionId = null;

  if (activeSession && activeSession.status === 'running') {
    sessionId = activeSession.id;
    const startTime = new Date(activeSession.startTime).getTime();
    elapsedSeconds = Math.max(0, (now.getTime() - startTime) / 1000);
    activeSession.readingsCount = (activeSession.readingsCount || 0) + 1;
    activeSession.lastReadingTime = isoTimestamp;
    flushSessions();
  }

  const record = {
    id: `rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    session_id: sessionId,
    timestamp: isoTimestamp,
    elapsed_seconds: Math.round(elapsedSeconds),
    elapsed_time: formatElapsedTime(elapsedSeconds),
    temperature_C: rawData.temperature_C !== undefined ? Number(Number(rawData.temperature_C).toFixed(2)) : null,
    pH: rawData.pH !== undefined ? Number(Number(rawData.pH).toFixed(2)) : null,
    pH_raw: rawData.pH_raw !== undefined ? Number(rawData.pH_raw) : null,
    pH_voltage: rawData.pH_voltage !== undefined ? Number(Number(rawData.pH_voltage).toFixed(3)) : null,
    turbidity_NTU: rawData.turbidity_NTU !== undefined ? Number(Number(rawData.turbidity_NTU).toFixed(2)) : null,
    turbidity_raw: rawData.turbidity_raw !== undefined ? Number(rawData.turbidity_raw) : null,
    turbidity_voltage: rawData.turbidity_voltage !== undefined ? Number(Number(rawData.turbidity_voltage).toFixed(3)) : null,
    fermentation_stage: stage
  };

  cachedReadings.push(record);
  flushReadings();

  return record;
}

/**
 * Return all sensor records
 * @returns {Array<Object>}
 */
function getAllReadings() {
  return [...cachedReadings];
}

/**
 * Return latest sensor reading
 * @returns {Object|null}
 */
function getLatestReading() {
  if (cachedReadings.length === 0) return null;
  return cachedReadings[cachedReadings.length - 1];
}

/**
 * Start a new fermentation session
 * @param {string} [name] - Optional session label
 * @returns {Object} New session object
 */
function startSession(name = 'Tepache Batch') {
  const now = new Date();
  const startTime = now.toISOString();

  // If previous session is running, close it
  if (activeSession && activeSession.status === 'running') {
    stopSession();
  }

  const newSession = {
    id: `ses_${Date.now()}`,
    name: name,
    startTime: startTime,
    endTime: null,
    durationSeconds: 0,
    durationFormatted: '00:00:00',
    readingsCount: 0,
    status: 'running'
  };

  cachedSessions.push(newSession);
  activeSession = newSession;
  flushSessions();

  return activeSession;
}

/**
 * Stop currently running session
 * @returns {Object|null} Stopped session
 */
function stopSession() {
  if (!activeSession || activeSession.status !== 'running') {
    return activeSession;
  }

  const now = new Date();
  const endTime = now.toISOString();
  const startMs = new Date(activeSession.startTime).getTime();
  const durationSec = Math.max(0, Math.floor((now.getTime() - startMs) / 1000));

  activeSession.endTime = endTime;
  activeSession.durationSeconds = durationSec;
  activeSession.durationFormatted = formatElapsedTime(durationSec);
  activeSession.status = 'stopped';

  flushSessions();
  const stopped = { ...activeSession };
  activeSession = null;
  return stopped;
}

/**
 * Get current session status info
 * @returns {Object}
 */
function getSessionStatus() {
  if (!activeSession || activeSession.status !== 'running') {
    const lastSession = cachedSessions[cachedSessions.length - 1] || null;
    return {
      running: false,
      session: lastSession,
      startTime: lastSession ? lastSession.startTime : null,
      elapsedTime: lastSession ? lastSession.durationFormatted : '00:00:00',
      elapsedSeconds: lastSession ? lastSession.durationSeconds : 0,
      readingsCount: lastSession ? (lastSession.readingsCount || 0) : 0
    };
  }

  const now = new Date().getTime();
  const startMs = new Date(activeSession.startTime).getTime();
  const elapsedSec = Math.max(0, Math.floor((now - startMs) / 1000));

  return {
    running: true,
    session: activeSession,
    startTime: activeSession.startTime,
    elapsedTime: formatElapsedTime(elapsedSec),
    elapsedSeconds: elapsedSec,
    readingsCount: activeSession.readingsCount || 0
  };
}

/**
 * Clear all sensor data (requires explicit confirmation)
 * Preserves past completed sessions or resets session counter
 */
function clearDataset() {
  cachedReadings = [];
  flushReadings();
  return { success: true, message: 'Dataset cleared successfully' };
}

/**
 * Get CSV content as string
 * @returns {string}
 */
function getCsvContent() {
  return generateCsv(cachedReadings);
}

module.exports = {
  initStorage,
  saveSensorReading,
  getAllReadings,
  getLatestReading,
  startSession,
  stopSession,
  getSessionStatus,
  clearDataset,
  getCsvContent,
  formatElapsedTime
};
