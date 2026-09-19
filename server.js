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
 * GET /
 * Root landing page & API documentation
 */
app.get('/', (req, res) => {
  if (req.accepts('html')) {
    const mongoStatus = getMongoStatus();
    const sessionStatus = storage.getSessionStatus();
    const readings = storage.getAllReadings();
    
    return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tepache Fermentation Monitor | Backend API</title>
  <style>
    :root {
      --bg: #090d0b;
      --card-bg: #111915;
      --card-border: #1e2e26;
      --text-main: #f0fdf4;
      --text-muted: #86efac;
      --green-accent: #10b981;
      --lime-accent: #7ce25b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    body { background: var(--bg); color: var(--text-main); min-height: 100vh; padding: 40px 20px; display: flex; justify-content: center; }
    .container { max-width: 860px; width: 100%; }
    .header { text-align: center; margin-bottom: 32px; }
    .badge-bar { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-top: 14px; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 9999px; font-size: 13px; font-weight: 600; border: 1px solid var(--card-border); background: var(--card-bg); }
    .badge.green { border-color: #059669; color: var(--lime-accent); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--lime-accent); box-shadow: 0 0 8px var(--lime-accent); }
    h1 { font-size: 28px; font-weight: 800; background: linear-gradient(135deg, #a7f3d0, #34d399, #10b981); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    p.subtitle { color: #9ca3af; margin-top: 6px; font-size: 15px; }
    .card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 14px; padding: 24px; margin-bottom: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    h2 { font-size: 18px; margin-bottom: 16px; color: #6ee7b7; display: flex; align-items: center; gap: 8px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
    .endpoint { display: block; background: #0c1410; border: 1px solid var(--card-border); padding: 14px; border-radius: 10px; text-decoration: none; color: inherit; transition: all 0.2s ease; }
    .endpoint:hover { border-color: var(--green-accent); transform: translateY(-2px); background: #0f1c16; }
    .method { display: inline-block; font-size: 11px; font-weight: 700; padding: 3px 7px; border-radius: 4px; margin-bottom: 6px; }
    .method.get { background: #064e3b; color: #6ee7b7; }
    .url { font-family: monospace; font-size: 14px; font-weight: 600; color: #f9fafb; word-break: break-all; }
    .desc { font-size: 12px; color: #9ca3af; margin-top: 4px; }
    .code-block { background: #070c0a; border: 1px solid #192b22; border-radius: 8px; padding: 12px 16px; font-family: monospace; font-size: 13px; color: #a7f3d0; overflow-x: auto; margin-top: 10px; white-space: pre-wrap; }
    footer { text-align: center; color: #6b7280; font-size: 13px; margin-top: 40px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🍍 Tepache Fermentation Backend</h1>
      <p class="subtitle">Real-time Biochemical Telemetry &amp; Analytics API</p>
      <div class="badge-bar">
        <div class="badge green"><span class="dot"></span> Server Online (Render)</div>
        <div class="badge green"><span class="dot"></span> MongoDB Atlas Connected (1m Sync)</div>
        <div class="badge">📊 ${readings.length} Telemetry Records</div>
      </div>
    </div>

    <div class="card">
      <h2>🌐 REST API Endpoints</h2>
      <div class="grid">
        <a class="endpoint" href="/api/health" target="_blank">
          <span class="method get">GET</span>
          <div class="url">/api/health</div>
          <div class="desc">System health, ESP32 status &amp; MongoDB sync info</div>
        </a>
        <a class="endpoint" href="/api/sensor-data" target="_blank">
          <span class="method get">GET</span>
          <div class="url">/api/sensor-data</div>
          <div class="desc">Fetch all collected sensor readings (JSON)</div>
        </a>
        <a class="endpoint" href="/api/sensor-data/latest" target="_blank">
          <span class="method get">GET</span>
          <div class="url">/api/sensor-data/latest</div>
          <div class="desc">Most recent temperature, pH &amp; turbidity reading</div>
        </a>
        <a class="endpoint" href="/api/analytics" target="_blank">
          <span class="method get">GET</span>
          <div class="url">/api/analytics</div>
          <div class="desc">Calculated kinetics, averages &amp; fermentation stage</div>
        </a>
        <a class="endpoint" href="/api/fermentation/status" target="_blank">
          <span class="method get">GET</span>
          <div class="url">/api/fermentation/status</div>
          <div class="desc">Active batch session status and elapsed time</div>
        </a>
        <a class="endpoint" href="/api/export/csv" target="_blank">
          <span class="method get">GET</span>
          <div class="url">/api/export/csv</div>
          <div class="desc">Download complete dataset as RFC-4180 CSV</div>
        </a>
      </div>
    </div>

    <div class="card">
      <h2>📡 ESP32 Data Ingestion</h2>
      <p style="font-size: 14px; color: #d1d5db;">Configure your ESP32 to send HTTP POST packets with sensor readings:</p>
      <div class="code-block">POST /api/sensor-data
Content-Type: application/json

{
  "temperature_C": 28.5,
  "pH": 4.8,
  "turbidity_NTU": 85.0,
  "pH_raw": 2780,
  "turbidity_raw": 490
}</div>
    </div>

    <footer>
      Tepache Fermentation Analytics &bull; Connected to MongoDB Atlas &bull; Auto-sync: 60s
    </footer>
  </div>
</body>
</html>`);
  }

  // JSON fallback
  res.json({
    message: 'Tepache Fermentation Monitoring Backend API',
    status: 'online',
    docs: {
      health: '/api/health',
      sensor_data: '/api/sensor-data',
      latest_reading: '/api/sensor-data/latest',
      analytics: '/api/analytics',
      fermentation_status: '/api/fermentation/status',
      export_csv: '/api/export/csv',
      mongodb_sync: '/api/mongodb/sync'
    },
    mongodb: getMongoStatus()
  });
});

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
