/**
 * Offline Tepache Fermentation Monitoring & Analytics Server
 * 
 * Local Node.js + Express backend designed for offline, local-network use.
 * Connects ESP32 microcontroller with React analytics dashboard.
 */

const express = require('express');
const cors = require('cors');
const os = require('os');
const path = require('path');
require('dotenv').config();

const fermentationConfig = require('./config/fermentationConfig');
const storage = require('./utils/storage');
const { calculateAnalytics } = require('./utils/analytics');
const { initMongoSync, getMongoStatus, syncToMongoDB } = require('./services/mongoSync');

// Initialize local persistent storage
storage.initStorage();

// Initialize periodic MongoDB cloud sync (every 1 minute)
initMongoSync();

const app = express();
const PORT = process.env.PORT || fermentationConfig.server.port || 5000;
const HOST = process.env.HOST || fermentationConfig.server.host || '0.0.0.0';

// Middleware
app.use(cors());
app.use(express.json());

// Request logging helper
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/api/sensor-data') {
    // Keep high-frequency sensor posts terse in console
  } else {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.originalUrl}`);
  }
  next();
});

/**
 * Determine if ESP32 is currently connected based on recent reading timestamp
 */
function isEsp32Connected() {
  const latest = storage.getLatestReading();
  if (!latest || !latest.timestamp) return false;
  const lastTime = new Date(latest.timestamp).getTime();
  const diff = Date.now() - lastTime;
  return diff < (fermentationConfig.esp32TimeoutMs || 30000);
}

// -------------------------------------------------------------
// API ROUTES
// -------------------------------------------------------------

/**
 * GET /api/health
 * System health, local offline status, and cloud sync info
 */
app.get('/api/health', (req, res) => {
  const sessionStatus = storage.getSessionStatus();
  const mongoStatus = getMongoStatus();
  res.json({
    status: 'ok',
    mode: 'offline',
    server_time: new Date().toISOString(),
    esp32_connected: isEsp32Connected(),
    session_running: sessionStatus.running,
    elapsed_time: sessionStatus.elapsedTime,
    readings_count: sessionStatus.readingsCount,
    mongodb: mongoStatus
  });
});

/**
 * POST /api/mongodb/sync
 * Manually trigger an immediate sync to MongoDB Atlas
 */
app.post('/api/mongodb/sync', async (req, res) => {
  try {
    await syncToMongoDB();
    res.json({
      success: true,
      message: 'MongoDB sync completed',
      status: getMongoStatus()
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /api/sensor-data
 * Ingest sensor data from ESP32 or test client
 */
app.post('/api/sensor-data', (req, res) => {
  const body = req.body;

  // Validation: Check for presence of at least temperature or raw values
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Malformed request: body must be a JSON object' });
  }

  // Validate numbers if present
  const numericFields = [
    'temperature_C',
    'pH',
    'turbidity_NTU',
    'pH_raw',
    'pH_voltage',
    'turbidity_raw',
    'turbidity_voltage'
  ];

  for (const field of numericFields) {
    if (body[field] !== undefined && body[field] !== null && isNaN(Number(body[field]))) {
      return res.status(400).json({ error: `Invalid value for '${field}': must be numeric` });
    }
  }

  // Check that at least some sensor data is present
  const hasData = numericFields.some(field => body[field] !== undefined && body[field] !== null);
  if (!hasData) {
    return res.status(400).json({ error: 'Sensor payload contains no recognized sensor fields' });
  }

  // Calculate current session elapsed time and estimated stage
  const sessionStatus = storage.getSessionStatus();
  const stage = fermentationConfig.estimateStage(body, sessionStatus.elapsedSeconds);

  // Save reading to local storage (JSON + CSV)
  const savedRecord = storage.saveSensorReading(body, stage);

  return res.status(201).json({
    success: true,
    record: savedRecord
  });
});

/**
 * GET /api/sensor-data
 * Retrieve all collected sensor readings
 */
app.get('/api/sensor-data', (req, res) => {
  const readings = storage.getAllReadings();
  res.json(readings);
});

/**
 * GET /api/sensor-data/latest
 * Return the most recent sensor reading
 */
app.get('/api/sensor-data/latest', (req, res) => {
  const latest = storage.getLatestReading();
  if (!latest) {
    return res.status(404).json({
      message: 'No sensor data available',
      data: null
    });
  }
  res.json(latest);
});

/**
 * GET /api/analytics
 * Return calculated fermentation analytics and trends
 */
app.get('/api/analytics', (req, res) => {
  const readings = storage.getAllReadings();
  const sessionStatus = storage.getSessionStatus();
  const analytics = calculateAnalytics(readings, sessionStatus);
  res.json(analytics);
});

/**
 * POST /api/fermentation/start
 * Start a new fermentation session
 */
app.post('/api/fermentation/start', (req, res) => {
  const sessionName = req.body && req.body.name ? req.body.name : `Tepache Batch ${new Date().toLocaleDateString()}`;
  const newSession = storage.startSession(sessionName);
  res.status(201).json({
    success: true,
    message: 'Fermentation session started',
    session: newSession
  });
});

/**
 * POST /api/fermentation/stop
 * Stop the active fermentation session
 */
app.post('/api/fermentation/stop', (req, res) => {
  const stoppedSession = storage.stopSession();
  res.json({
    success: true,
    message: 'Fermentation session stopped',
    session: stoppedSession
  });
});

/**
 * GET /api/fermentation/status
 * Return active session state, duration, and readings count
 */
app.get('/api/fermentation/status', (req, res) => {
  const status = storage.getSessionStatus();
  const readings = storage.getAllReadings();
  const latest = storage.getLatestReading();
  const stage = fermentationConfig.estimateStage(latest, status.elapsedSeconds);

  res.json({
    running: status.running,
    sessionId: status.session ? status.session.id : null,
    sessionName: status.session ? status.session.name : null,
    startTime: status.startTime,
    elapsedTime: status.elapsedTime,
    elapsedSeconds: status.elapsedSeconds,
    readingsCount: status.readingsCount || readings.length,
    estimatedStage: stage
  });
});

/**
 * POST /api/sensor-data/clear
 * Clear current dataset after explicit frontend confirmation
 */
app.post('/api/sensor-data/clear', (req, res) => {
  if (!req.body || req.body.confirm !== true) {
    return res.status(400).json({
      error: 'Dataset clearance requires explicit confirmation: { "confirm": true }'
    });
  }

  const result = storage.clearDataset();
  res.json(result);
});

/**
 * GET /api/export/csv
 * Export the collected dataset as a downloadable CSV
 */
app.get('/api/export/csv', (req, res) => {
  const csvData = storage.getCsvContent();
  const filename = `tepache_fermentation_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csvData);
});

// Fallback error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// Start listening
const server = app.listen(PORT, HOST, () => {
  console.log('====================================================');
  console.log('       TEPACHE FERMENTATION MONITOR BACKEND         ');
  console.log('====================================================');
  console.log(`Server running in OFFLINE mode on: http://localhost:${PORT}`);

  // Display all local network IP addresses to help configure ESP32
  const networkInterfaces = os.networkInterfaces();
  console.log('\nAvailable local network addresses for ESP32 configuration:');
  Object.keys(networkInterfaces).forEach(ifaceName => {
    networkInterfaces[ifaceName].forEach(iface => {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log(` -> http://${iface.address}:${PORT}  (${ifaceName})`);
      }
    });
  });
  console.log('\nUse one of the above IP addresses in your ESP32 SERVER_IP variable.');
  console.log('====================================================\n');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[ERROR] Port ${PORT} is already in use by another process!`);
    console.error(`Please close any existing Node.js server running on port ${PORT}, or start with another port:`);
    console.error(`  powershell: $env:PORT=5001; npm start\n`);
  } else {
    console.error('Server failed to start:', err);
  }
  process.exit(1);
});
