/**
 * Tepache Fermentation Configuration & Calibration
 * 
 * IMPORTANT:
 * All fermentation stages and calibration calculations provided here
 * are PROJECT-DEFINED ESTIMATES based on sensor trends.
 * They are NOT medically or scientifically validated conclusions,
 * nor food safety guarantees.
 */

const fermentationConfig = {
  // Server Configuration
  server: {
    port: process.env.PORT || 5000,
    host: process.env.HOST || '0.0.0.0', // Listen on all network interfaces for local network access
  },

  // Sensor Calibration Parameters (Experimental)
  calibration: {
    // DS18B20 Temperature sensor offset (°C)
    temperatureOffset: 0.0,

    // pH sensor two-point calibration
    // Voltage readings from standard calibration solutions
    phVoltageAtPh7: 2.50, // Typical reference midpoint voltage at pH 7.0
    phVoltageAtPh4: 3.05, // Typical reference voltage at pH 4.0
    
    // Turbidity sensor calibration parameters
    // Optical turbidity modules often yield higher voltage for clear liquid, lower for cloudy
    turbidityClearVoltage: 4.20, // Clean distilled water reference voltage
    turbiditySlope: -1120.4,     // Experimental calibration slope (NTU per volt drop)
    turbidityOffset: 5742.3      // Experimental calibration intercept
  },

  // Trend analysis sliding window (number of recent readings)
  trendWindowSize: 5,
  // Minimum change to qualify as increasing/decreasing vs stable
  trendThresholds: {
    temperature: 0.15, // °C change over window
    ph: 0.05,          // pH unit change over window
    turbidity: 5.0     // NTU change over window
  },

  // Disconnection timeout: consider ESP32 disconnected if no reading within this time (ms)
  esp32TimeoutMs: 30000, // 30 seconds

  // Rule-based Estimated Fermentation Stages (Configurable thresholds)
  stages: {
    EARLY: {
      name: 'EARLY',
      label: 'Early Fermentation',
      description: 'Initial aerobic-to-anaerobic shift; wild yeasts and bacteria awakening.',
      minHours: 0,
      maxHours: 18,
      typicalPhMin: 4.8
    },
    ACTIVE: {
      name: 'ACTIVE',
      label: 'Active Fermentation',
      description: 'Rapid acidification; active yeast fermentation and CO2 generation.',
      minHours: 18,
      maxHours: 48,
      typicalPhMin: 3.8,
      typicalPhMax: 4.8
    },
    ADVANCED: {
      name: 'ADVANCED',
      label: 'Advanced Fermentation',
      description: 'Lactic and acetic acid accumulation; flavor development.',
      minHours: 48,
      maxHours: 72,
      typicalPhMin: 3.3,
      typicalPhMax: 3.8
    },
    COMPLETED: {
      name: 'COMPLETED',
      label: 'Completed',
      description: 'Target profile reached; ready for harvesting or cold crash.',
      typicalPhMax: 3.3
    }
  },

  /**
   * Determine project-defined estimated stage based on sensor readings and elapsed time
   * @param {Object} latest - Latest sensor reading
   * @param {number} elapsedSeconds - Total session elapsed time in seconds
   * @returns {string} Estimated stage: 'EARLY' | 'ACTIVE' | 'ADVANCED' | 'COMPLETED'
   */
  estimateStage: function (latest, elapsedSeconds = 0) {
    if (!latest) {
      return 'EARLY';
    }

    const currentPh = typeof latest.pH === 'number' ? latest.pH : null;
    const elapsedHours = elapsedSeconds / 3600;

    // Rule-based decision hierarchy
    if (currentPh !== null) {
      if (currentPh <= 3.3 || elapsedHours >= 72) {
        return 'COMPLETED';
      }
      if (currentPh <= 3.8 || elapsedHours >= 48) {
        return 'ADVANCED';
      }
      if (currentPh <= 4.8 || elapsedHours >= 18) {
        return 'ACTIVE';
      }
      return 'EARLY';
    }

    // Fallback based solely on elapsed time if pH sensor is unavailable
    if (elapsedHours >= 72) return 'COMPLETED';
    if (elapsedHours >= 48) return 'ADVANCED';
    if (elapsedHours >= 18) return 'ACTIVE';
    return 'EARLY';
  }
};

module.exports = fermentationConfig;
