/**
 * Fermentation Analytics Engine
 * 
 * Calculates mathematical summaries, trends, and observational statistics
 * specifically tailored for Tepache fermentation monitoring.
 * 
 * IMPORTANT:
 * All trends, metrics, and stage estimates are observational calculations.
 * They do NOT represent scientifically or medically validated food safety guarantees.
 */

const fermentationConfig = require('../config/fermentationConfig');

/**
 * Determine trend direction across a window of recent numerical values
 * @param {Array<number>} values - Array of values chronologically ordered
 * @param {number} threshold - Minimum difference to qualify as increasing/decreasing
 * @returns {'increasing' | 'decreasing' | 'stable'}
 */
function calculateTrend(values, threshold) {
  if (!values || values.length < 2) {
    return 'stable';
  }

  // Calculate simple linear regression slope or first-to-last delta over window
  const n = values.length;
  const first = values[0];
  const last = values[n - 1];
  const delta = last - first;

  if (Math.abs(delta) < threshold) {
    return 'stable';
  }
  return delta > 0 ? 'increasing' : 'decreasing';
}

/**
 * Compute descriptive stats for a numeric property across readings
 * @param {Array<Object>} readings - Array of sensor readings
 * @param {string} key - Property name
 * @param {number} threshold - Threshold for trend detection
 * @param {number} windowSize - Window size for trend
 * @returns {Object} { current, initial, min, max, average, change, trend }
 */
function computeMetricStats(readings, key, threshold, windowSize = 5) {
  const validValues = readings
    .map(r => r[key])
    .filter(v => typeof v === 'number' && !isNaN(v));

  if (validValues.length === 0) {
    return {
      current: null,
      initial: null,
      min: null,
      max: null,
      average: null,
      change: 0,
      trend: 'stable'
    };
  }

  const initial = validValues[0];
  const current = validValues[validValues.length - 1];
  const min = Math.min(...validValues);
  const max = Math.max(...validValues);
  const sum = validValues.reduce((acc, v) => acc + v, 0);
  const average = Number((sum / validValues.length).toFixed(2));
  const change = Number((current - initial).toFixed(2));

  // Extract recent window for trend calculation
  const recentWindow = validValues.slice(-windowSize);
  const trend = calculateTrend(recentWindow, threshold);

  return {
    current,
    initial,
    min,
    max,
    average,
    change,
    trend
  };
}

/**
 * Generate full analytics object from dataset and session information
 * @param {Array<Object>} readings - All sensor records (or current session records)
 * @param {Object} sessionStatus - Current session status object
 * @returns {Object}
 */
function calculateAnalytics(readings = [], sessionStatus = {}) {
  const windowSize = fermentationConfig.trendWindowSize || 5;
  const thresholds = fermentationConfig.trendThresholds;

  const tempStats = computeMetricStats(readings, 'temperature_C', thresholds.temperature, windowSize);
  const phStats = computeMetricStats(readings, 'pH', thresholds.ph, windowSize);
  const turbStats = computeMetricStats(readings, 'turbidity_NTU', thresholds.turbidity, windowSize);

  const latest = readings.length > 0 ? readings[readings.length - 1] : null;
  const elapsedSec = sessionStatus.elapsedSeconds || (latest ? latest.elapsed_seconds : 0) || 0;
  const stage = fermentationConfig.estimateStage(latest, elapsedSec);
  const stageConfig = fermentationConfig.stages[stage] || fermentationConfig.stages.EARLY;

  return {
    temperature: {
      current: tempStats.current,
      average: tempStats.average,
      min: tempStats.min,
      max: tempStats.max,
      trend: tempStats.trend
    },
    pH: {
      current: phStats.current,
      initial: phStats.initial,
      change: phStats.change,
      trend: phStats.trend
    },
    turbidity: {
      current: turbStats.current,
      initial: turbStats.initial,
      change: turbStats.change,
      trend: turbStats.trend
    },
    duration: sessionStatus.elapsedTime || (latest ? latest.elapsed_time : '00:00:00') || '00:00:00',
    durationSeconds: elapsedSec,
    readings: readings.length,
    estimatedStage: stage,
    stageDetails: {
      label: stageConfig.label,
      description: stageConfig.description
    },
    disclaimer: 'All metrics and estimated fermentation stages are experimental project-defined observations based on sensor trends and do not constitute certified food-safety evaluations.'
  };
}

module.exports = {
  calculateTrend,
  computeMetricStats,
  calculateAnalytics
};
