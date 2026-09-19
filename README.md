# Tepache Fermentation Monitor - Backend

A robust Node.js & Express backend for real-time telemetry ingestion, biochemical analytics, and offline-first data logging of Mexican Tepache pineapple-rind fermentation.

## Features

- **Offline-First Telemetry Ingestion**: Receives live sensor readings (Temperature °C, pH, Turbidity NTU, raw ADC voltages) from ESP32 over local Wi-Fi.
- **Biochemical Stage Estimation**: Automatically determines fermentation phase (`EARLY`, `ACTIVE`, `PEAK`, `FINISHING`, `COMPLETED`) based on pH drop rate, turbidity curve, and elapsed session time.
- **Atomic Local Persistence**: Concurrent-safe JSON and CSV logging to `data/sensor-data.json` and `data/sensor-data.csv` using atomic temp-file write-and-rename.
- **Automated MongoDB Cloud Sync**: Periodically uploads recorded readings and sessions to MongoDB Atlas every 1 minute (`MONGODB_SYNC_INTERVAL_MS=60000`) with graceful offline degradation.
- **Analytics Engine**: Calculates statistics (min/max/average, pH rate of change, turbidity progression) for dashboard charts and metrics.
- **Session Tracking**: Start, monitor, and stop fermentation batches with precise elapsed timestamps.

---

## Getting Started

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher)
- npm

### 2. Installation
```bash
cd backend
npm install
```

### 3. Configuration
Copy the `.env.example` file to `.env` and configure your settings:
```bash
cp .env.example .env
```

Edit `.env`:
```env
PORT=5000
HOST=0.0.0.0
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.uph7bbi.mongodb.net/tepache_fermentation?retryWrites=true&w=majority
MONGODB_SYNC_INTERVAL_MS=60000
```

### 4. Running the Server
```bash
# Start server
npm start

# Development mode with file watching
npm run dev
```

The server listens on `http://localhost:5000` and displays your laptop's local IP address for the ESP32 firmware.

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Server health, ESP32 connectivity, and MongoDB sync status |
| `POST` | `/api/sensor-data` | Ingest sensor data packet from ESP32 |
| `GET` | `/api/sensor-data` | Retrieve all recorded sensor readings |
| `GET` | `/api/sensor-data/latest` | Retrieve the latest recorded sensor reading |
| `GET` | `/api/analytics` | Retrieve fermentation kinetics & stage analytics |
| `POST` | `/api/fermentation/start` | Start a new fermentation batch session |
| `POST` | `/api/fermentation/stop` | Stop the current active session |
| `GET` | `/api/fermentation/status` | Current session duration and readings count |
| `GET` | `/api/export/csv` | Download dataset as a `.csv` file |
| `POST` | `/api/mongodb/sync` | Manually trigger an immediate MongoDB Atlas sync |
| `POST` | `/api/sensor-data/clear` | Clear dataset (requires `{ "confirm": true }`) |

---

## Project Structure

```
backend/
├── config/
│   └── fermentationConfig.js   # Biochemical thresholds & stage classifiers
├── data/
│   ├── sensor-data.json        # Atomic JSON sensor records
│   ├── sensor-data.csv         # Exportable CSV log
│   └── sessions.json           # Batch session metadata
├── services/
│   └── mongoSync.js            # Automated 1-minute MongoDB Atlas sync service
├── utils/
│   ├── analytics.js            # Fermentation analytics & metrics calculations
│   ├── csv.js                  # CSV parser & generator
│   └── storage.js              # Thread-safe atomic file storage manager
├── .env.example                # Configuration template
├── .gitignore
├── package.json
├── README.md
└── server.js                   # Express application entry point
```

---

## License
ISC
