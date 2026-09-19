/**
 * MongoDB Cloud Sync Service
 * 
 * Periodically synchronizes locally recorded sensor readings and sessions
 * to MongoDB Atlas cluster every 1 minute.
 * 
 * Gracefully resilient: If the internet connection drops or MongoDB is unreachable,
 * local monitoring and local storage continue without interruption.
 */

const { MongoClient } = require('mongodb');
const storage = require('../utils/storage');
const fs = require('fs');
const path = require('path');

const MONGODB_URI = process.env.MONGODB_URI;
const SYNC_INTERVAL_MS = parseInt(process.env.MONGODB_SYNC_INTERVAL_MS, 10) || 60000; // 1 minute default
const SESSIONS_FILE = path.join(__dirname, '..', 'data', 'sessions.json');

let client = null;
let isSyncing = false;
let syncIntervalTimer = null;

const syncStatus = {
  enabled: Boolean(MONGODB_URI),
  connected: false,
  lastSyncTime: null,
  lastRecordCount: 0,
  lastError: null,
  totalSyncAttempts: 0
};

/**
 * Get or create connected MongoClient instance
 */
async function getClient() {
  if (!MONGODB_URI) return null;

  if (client) {
    try {
      // Test ping
      await client.db('admin').command({ ping: 1 });
      return client;
    } catch {
      // Reconnect below
      try {
        await client.close();
      } catch {}
      client = null;
    }
  }

  client = new MongoClient(MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000
  });

  await client.connect();
  return client;
}

/**
 * Perform sync pass: upload readings and session info to MongoDB
 */
async function syncToMongoDB() {
  if (!MONGODB_URI) {
    return;
  }

  if (isSyncing) {
    return;
  }

  isSyncing = true;
  syncStatus.totalSyncAttempts++;

  try {
    const mongoClient = await getClient();
    if (!mongoClient) {
      throw new Error('MongoDB client not initialized');
    }

    const db = mongoClient.db('tepache_fermentation');
    const readingsCollection = db.collection('sensor_readings');
    const sessionsCollection = db.collection('sessions');

    // 1. Sync Sensor Readings
    const localReadings = storage.getAllReadings();
    let syncedReadingsCount = 0;

    if (localReadings.length > 0) {
      const operations = localReadings.map(record => ({
        updateOne: {
          filter: { id: record.id },
          update: { $set: { ...record, syncedAt: new Date() } },
          upsert: true
        }
      }));

      const result = await readingsCollection.bulkWrite(operations, { ordered: false });
      syncedReadingsCount = (result.upsertedCount || 0) + (result.modifiedCount || 0) + (result.matchedCount || 0);
    }

    // 2. Sync Sessions
    let sessions = [];
    if (fs.existsSync(SESSIONS_FILE)) {
      try {
        const raw = fs.readFileSync(SESSIONS_FILE, 'utf-8').trim();
        if (raw) sessions = JSON.parse(raw);
      } catch {}
    }

    if (sessions.length > 0) {
      const sessionOps = sessions.map(session => ({
        updateOne: {
          filter: { id: session.id },
          update: { $set: { ...session, syncedAt: new Date() } },
          upsert: true
        }
      }));
      await sessionsCollection.bulkWrite(sessionOps, { ordered: false });
    }

    // Update state
    syncStatus.connected = true;
    syncStatus.lastSyncTime = new Date().toISOString();
    syncStatus.lastRecordCount = localReadings.length;
    syncStatus.lastError = null;

    console.log(`[MongoDB Sync] ${new Date().toLocaleTimeString()} - Synced ${localReadings.length} readings & ${sessions.length} sessions to MongoDB Atlas`);
  } catch (err) {
    syncStatus.connected = false;
    syncStatus.lastError = err.message;
    console.warn(`[MongoDB Sync] ${new Date().toLocaleTimeString()} - Cloud sync deferred: ${err.message} (Local storage intact)`);
  } finally {
    isSyncing = false;
  }
}

/**
 * Initialize automatic periodic sync (every 1 minute)
 */
function initMongoSync() {
  if (!MONGODB_URI) {
    console.log('[MongoDB Sync] No MONGODB_URI configured. Running in pure local mode.');
    return;
  }

  console.log(`[MongoDB Sync] Initializing cloud sync to MongoDB Atlas (Interval: ${SYNC_INTERVAL_MS / 1000}s)...`);

  // Initial sync attempt after 3 seconds
  setTimeout(syncToMongoDB, 3000);

  // Periodic recurring sync every 1 minute
  if (syncIntervalTimer) clearInterval(syncIntervalTimer);
  syncIntervalTimer = setInterval(syncToMongoDB, SYNC_INTERVAL_MS);
}

/**
 * Get current sync status
 */
function getMongoStatus() {
  return { ...syncStatus };
}

module.exports = {
  initMongoSync,
  syncToMongoDB,
  getMongoStatus
};
