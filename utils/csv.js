/**
 * CSV Formatting Utility
 * Handles RFC-4180 compliant CSV formatting for sensor dataset exports.
 */

const CSV_HEADERS = [
  'timestamp',
  'elapsed_time',
  'temperature_C',
  'pH',
  'pH_raw',
  'pH_voltage',
  'turbidity_NTU',
  'turbidity_raw',
  'turbidity_voltage',
  'fermentation_stage'
];

/**
 * Format a single sensor reading object to a CSV row string
 * @param {Object} row - Sensor reading
 * @returns {string}
 */
function formatCsvRow(row) {
  return [
    `"${(row.timestamp || '').replace(/"/g, '""')}"`,
    `"${(row.elapsed_time || '00:00:00').replace(/"/g, '""')}"`,
    row.temperature_C !== undefined && row.temperature_C !== null ? Number(row.temperature_C).toFixed(2) : '',
    row.pH !== undefined && row.pH !== null ? Number(row.pH).toFixed(2) : '',
    row.pH_raw !== undefined && row.pH_raw !== null ? row.pH_raw : '',
    row.pH_voltage !== undefined && row.pH_voltage !== null ? Number(row.pH_voltage).toFixed(3) : '',
    row.turbidity_NTU !== undefined && row.turbidity_NTU !== null ? Number(row.turbidity_NTU).toFixed(2) : '',
    row.turbidity_raw !== undefined && row.turbidity_raw !== null ? row.turbidity_raw : '',
    row.turbidity_voltage !== undefined && row.turbidity_voltage !== null ? Number(row.turbidity_voltage).toFixed(3) : '',
    `"${(row.fermentation_stage || 'EARLY').replace(/"/g, '""')}"`
  ].join(',');
}

/**
 * Generate complete CSV string from array of sensor records
 * @param {Array<Object>} records - Array of sensor readings
 * @returns {string}
 */
function generateCsv(records = []) {
  const headerLine = CSV_HEADERS.join(',');
  if (!records || records.length === 0) {
    return headerLine + '\n';
  }
  const rows = records.map(formatCsvRow);
  return [headerLine, ...rows].join('\n') + '\n';
}

module.exports = {
  CSV_HEADERS,
  formatCsvRow,
  generateCsv
};
