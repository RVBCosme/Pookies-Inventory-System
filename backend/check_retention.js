const { getDb } = require('./db/database');

const db = getDb();

// Check inventory_logs
const logs = db.prepare(`
  SELECT 
    MIN(log_date) as oldest_log,
    MAX(log_date) as newest_log,
    COUNT(*) as total_records
  FROM inventory_logs
`).all();

console.log('\n=== Inventory Logs Statistics ===');
console.log('Oldest log:', logs[0]?.oldest_log || 'No logs');
console.log('Newest log:', logs[0]?.newest_log || 'No logs');
console.log('Total records:', logs[0]?.total_records || 0);

// Calculate cutoff
const cutoff = new Date();
cutoff.setDate(cutoff.getDate() - 30);
const cutoffIso = cutoff.toISOString();
const cutoffDate = cutoff.toISOString().split('T')[0];

console.log('\n=== Retention Cutoff ===');
console.log('30-day cutoff date:', cutoffDate);
console.log('30-day cutoff ISO:', cutoffIso);
console.log('Today:', new Date().toISOString().split('T')[0]);
console.log('Retention window: 30 days');

// Check if there are any logs older than cutoff
const oldLogs = db.prepare(`
  SELECT COUNT(*) as count FROM inventory_logs WHERE log_date < ?
`).get(cutoffIso);

console.log('\n=== Data Older Than Cutoff ===');
console.log('Records older than cutoff:', oldLogs.count);
if (oldLogs.count > 0) {
  console.log('⚠️  WARNING: Found records that should have been cleaned up!');
} else {
  console.log('✅ All records are within the 30-day retention window.');
}

// Check receipt_uploads (permanent records)
const receipts = db.prepare(`
  SELECT COUNT(*) as count FROM receipt_uploads
`).get();

console.log('\n=== Receipt Uploads (Permanent) ===');
console.log('Total receipt records:', receipts.count);

console.log('\n=== Logs Directory Files ===');
const fs = require('fs');
const path = require('path');
const logsDir = path.join(__dirname, 'Logs');
const files = fs.readdirSync(logsDir);
console.log('Activity log files:', files.length);
files.forEach(f => console.log(`  - ${f}`));

console.log('\n=== Cleanup Status ===');
if (oldLogs.count === 0 && files.every(f => {
  const match = f.match(/^(\d{4}-\d{2}-\d{2})_activity\.json$/);
  if (!match) return true;
  return match[1] >= cutoffDate;
})) {
  console.log('✅ Data retention policy is WORKING CORRECTLY');
  console.log('   - No database records older than 30 days');
  console.log('   - All log files are within retention window');
} else {
  console.log('⚠️  Data retention may have issues - see details above');
}
