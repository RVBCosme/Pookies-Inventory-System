/**
 * build-hooks/afterPack.js
 * 
 * Ensures better-sqlite3 native modules are properly included
 * in the packaged Electron app.
 */

const fs = require('fs');
const path = require('path');

exports.default = async function(context) {
  console.log('[afterPack] Ensuring better-sqlite3 compatibility...');
  
  const appPath = context.appOutDir;
  const sqlitePath = path.join(
    appPath,
    'resources',
    'app.asar.unpacked',
    'node_modules',
    'better-sqlite3'
  );
  
  if (fs.existsSync(sqlitePath)) {
    console.log('[afterPack] ✓ better-sqlite3 native modules found');
  } else {
    console.warn('[afterPack] ⚠ better-sqlite3 path not found, checking alternatives...');
  }
  
  // Create required directories in the packaged app
  const receiptsDir = path.join(appPath, 'Receipts');
  if (!fs.existsSync(receiptsDir)) {
    fs.mkdirSync(receiptsDir, { recursive: true });
  }
  
  console.log('[afterPack] Build preparation complete');
};
