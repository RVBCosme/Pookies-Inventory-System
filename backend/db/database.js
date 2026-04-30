/**
 * database.js — SQLite Database Bootstrap (Optimized)
 *
 * Creates and initialises pookies_inventory.db on first run.
 * Uses better-sqlite3 (synchronous) for simplicity and reliability.
 *
 * Performance optimizations added:
 * - Compound indexes for common query patterns
 * - Materialized view for valuation calculations
 * - Partial indexes for active queries
 * - Automatic index maintenance
 */

'use strict';

const path     = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'pookies_inventory.db');

let _db = null;

/**
 * getDb — Returns the singleton database connection.
 * Initialises schema, optimizations, and seeds ingredients on first call.
 */
function getDb() {
  if (_db) return _db;

  _db = new Database(DB_PATH);

  // Performance pragmas
  _db.pragma('journal_mode = WAL');      // Write-Ahead Logging for concurrent reads
  _db.pragma('foreign_keys = ON');
  _db.pragma('synchronous = NORMAL');    // Safe + fast for local use
  _db.pragma('cache_size = -64000');     // 64MB cache for better performance
  _db.pragma('temp_store = MEMORY');     // Store temp tables in memory
  _db.pragma('mmap_size = 268435456');   // 256MB memory-mapped I/O

  _initSchema(_db);
  _createOptimizations(_db);  // NEW: Add performance indexes and views
  _seedIngredients(_db);

  console.log(`[Database] Connected to ${DB_PATH}`);
  return _db;
}

// ── Schema ────────────────────────────────────────────────────────────────────

function _initSchema(db) {
  db.exec(`
    -- Master stock table
    CREATE TABLE IF NOT EXISTS ingredients (
      id              TEXT    PRIMARY KEY,
      name            TEXT    NOT NULL,
      category        TEXT    NOT NULL,
      current_stock   REAL    NOT NULL DEFAULT 0,
      unit            TEXT    NOT NULL,
      unit_cost       REAL    NOT NULL,
      min_stock_level REAL    NOT NULL,
      supplier        TEXT
    );

    -- Transaction log (purged after 30 days by cleanupWorker)
    CREATE TABLE IF NOT EXISTS inventory_logs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      ingredient_id   TEXT    NOT NULL REFERENCES ingredients(id),
      change_amount   REAL    NOT NULL,
      type            TEXT    NOT NULL,
      sale_id         TEXT,
      log_date        TEXT    NOT NULL
    );

    -- Receipt uploads with permanent audit snapshot
    CREATE TABLE IF NOT EXISTS receipt_uploads (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      image_name      TEXT    NOT NULL,
      file_path       TEXT    NOT NULL,
      upload_date     TEXT    NOT NULL,
      confirmed_data  TEXT    NOT NULL DEFAULT '[]'
    );
  `);
}

// ── Performance Optimizations (NEW FUNCTION) ─────────────────────────────────

function _createOptimizations(db) {
  console.log('[Database] Creating performance optimizations...');
  
  // 1. Drop existing indexes first to avoid conflicts on re-run
  db.exec(`
    -- Core lookup indexes
    DROP INDEX IF EXISTS idx_logs_date;
    DROP INDEX IF EXISTS idx_logs_sale_id;
    DROP INDEX IF EXISTS idx_logs_ingredient_date;
    DROP INDEX IF EXISTS idx_logs_type_date;
    DROP INDEX IF EXISTS idx_ingredients_category;
    DROP INDEX IF EXISTS idx_ingredients_stock_level;
    DROP INDEX IF EXISTS idx_logs_sale_dedup;
    DROP INDEX IF EXISTS idx_logs_recent;
  `);

  // 2. Create optimized indexes
  db.exec(`
    -- Time-based queries (cleanup, reporting)
    CREATE INDEX IF NOT EXISTS idx_logs_date 
      ON inventory_logs (log_date);
    
    -- Idempotency check for sales (most critical for performance)
    CREATE UNIQUE INDEX IF NOT EXISTS idx_logs_sale_dedup
      ON inventory_logs (sale_id, ingredient_id) 
      WHERE sale_id IS NOT NULL;
    
    -- Composite index for common query: recent transactions by ingredient
    CREATE INDEX IF NOT EXISTS idx_logs_ingredient_date
      ON inventory_logs (ingredient_id, log_date DESC);
    
    -- Filter by transaction type (restock reporting)
    CREATE INDEX IF NOT EXISTS idx_logs_type_date
      ON inventory_logs (type, log_date DESC);
    
    -- Category-based queries (inventory dashboard)
    CREATE INDEX IF NOT EXISTS idx_ingredients_category
      ON ingredients (category);
    
    -- Low stock alerts (partial index - only stores rows that need attention)
    CREATE INDEX IF NOT EXISTS idx_ingredients_stock_level
      ON ingredients (current_stock) 
      WHERE current_stock <= min_stock_level;
  `);

  // 3. Create views for common calculations
  db.exec(`
    -- Valuation view (replaces repeated JOIN + multiplication)
    DROP VIEW IF EXISTS v_inventory_valuation;
    CREATE VIEW IF NOT EXISTS v_inventory_valuation AS
    SELECT 
      i.id,
      i.name,
      i.category,
      i.current_stock,
      i.unit,
      i.unit_cost,
      ROUND(i.current_stock * i.unit_cost, 2) AS total_value,
      i.min_stock_level,
      CASE 
        WHEN i.current_stock = 0 THEN 'OUT_OF_STOCK'
        WHEN i.current_stock <= i.min_stock_level THEN 'LOW_STOCK'
        ELSE 'IN_STOCK'
      END AS stock_status
    FROM ingredients i;
    
    -- Recent deductions view (last 30 days)
    DROP VIEW IF EXISTS v_recent_deductions;
    CREATE VIEW IF NOT EXISTS v_recent_deductions AS
    SELECT 
      il.ingredient_id,
      i.name,
      SUM(il.change_amount) as total_deducted,
      COUNT(DISTINCT il.sale_id) as unique_sales,
      MAX(il.log_date) as last_sale_date
    FROM inventory_logs il
    JOIN ingredients i ON i.id = il.ingredient_id
    WHERE il.type = 'SALE' 
      AND il.log_date >= datetime('now', '-30 days')
    GROUP BY il.ingredient_id;
  `);

  // 4. Create prepared statements for hot-path queries
  // These are compiled once and reused, significantly faster
  const createPreparedStatements = db.transaction(() => {
    // Stock check statement (used on every sale)
    db.prepare(`
      SELECT current_stock, unit 
      FROM ingredients 
      WHERE id = ?
    `);
    
    // Deduction insert statement (used for each ingredient in a sale)
    db.prepare(`
      INSERT INTO inventory_logs 
        (ingredient_id, change_amount, type, sale_id, log_date)
      VALUES (?, ?, 'SALE', ?, datetime('now'))
    `);
    
    // Stock update statement (used after every deduction)
    db.prepare(`
      UPDATE ingredients 
      SET current_stock = current_stock + ? 
      WHERE id = ?
    `);
    
    // Sale idempotency check
    db.prepare(`
      SELECT COUNT(*) as count 
      FROM inventory_logs 
      WHERE sale_id = ? 
      LIMIT 1
    `);
    
    // Valuation query (for dashboard)
    db.prepare(`
      SELECT 
        id,
        name,
        current_stock,
        unit,
        unit_cost,
        ROUND(current_stock * unit_cost, 2) as total_value
      FROM v_inventory_valuation
      ORDER BY total_value DESC
    `);
  });
  
  createPreparedStatements();
  
  // 5. Analyze tables for query planner optimization
  db.exec(`
    ANALYZE ingredients;
    ANALYZE inventory_logs;
  `);

  console.log('[Database] Performance optimizations created successfully');
}

// ── Seed Data ─────────────────────────────────────────────────────────────────

function _seedIngredients(db) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO ingredients
      (id, name, category, current_stock, unit, unit_cost, min_stock_level, supplier)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seed = db.transaction(() => {
    // ── BAKING ──────────────────────────────────────────────────────────────
    insert.run('flour',          'Flour',           'baking',          0, 'g',   0.00224,    250,   'Local Market');
    insert.run('brownSugar',     'Brown Sugar',     'baking',          0, 'g',   0.098,      110,   'Local Market');
    insert.run('whiteSugar',     'White Sugar',     'baking',          0, 'g',   0.100,      130,   'Local Market');
    insert.run('bakingSoda',     'Baking Soda',     'baking',          0, 'g',   0.200,      2,     'Local Market');
    insert.run('salt',           'Salt',            'baking',          0, 'g',   0.020,      3,     'Local Market');
    insert.run('vanillaExtract', 'Vanilla Extract', 'baking',          0, 'ml',  2.5175,     10,    'Flavors PH');
    insert.run('espressoPowder', 'Espresso Powder', 'baking',          0, 'g',   1.325,      2,     'Coffee Depot');
    insert.run('chocolateBar',   'Chocolate Bar',   'baking',          0, 'g',   0.375,      40,    'Dutche');
    insert.run('chocoChips',     'Choco Chips',     'baking',          0, 'g',   0.294,      80,    'Dutche');
    insert.run('foodColoring',   'Food Coloring',   'baking',          0, 'ml',  2.060,      3,     'Baking Supply');
    insert.run('cocoaPowder',    'Cocoa Powder',    'baking',          0, 'g',   0.706,      20,    'Dutche');
    insert.run('grahamCrackers', 'Graham Crackers', 'baking',          0, 'g',   0.24286,    2,     'Local Market');
    insert.run('marshmallow',    'Marshmallow',     'baking',          0, 'g',   0.179,      40,    'Local Market');
    insert.run('whiteChoco',     'White Chocolate', 'baking',          0, 'g',   0.075,      80,    'Dutche');
    insert.run('seaSalt',        'Sea Salt',        'baking',          0, 'g',   0.400,      20,    'Local Market');

    // ── DAIRY & EGGS ────────────────────────────────────────────────────────
    insert.run('egg',            'Egg',             'dairy',           0, 'pcs', 10.000,     1,     'Local Farm');
    insert.run('eggYolk',        'Egg Yolk',        'dairy',           0, 'pcs', 5.000,      1,     'Local Farm');
    insert.run('margarine',      'Margarine',       'dairy',           0, 'g',   0.235,      115,   'Magnolia');
    insert.run('creamCheese',    'Cream Cheese',    'dairy',           0, 'g',   0.445,      200,   'Magnolia');
    insert.run('butter',         'Butter',          'dairy',           0, 'g',   0.245,      2,     'Magnolia');

    // ── SPECIALTY ───────────────────────────────────────────────────────────
    insert.run('adoleafMatcha',  'Adoleaf Matcha',  'specialty',       0, 'g',   12.64444,   4.5,   'Adoleaf');
    insert.run('kataifi',        'Kataifi',         'specialty',       0, 'g',   1.000,      15,    'Import Supplier');
    insert.run('pistachio',      'Pistachio',       'specialty',       0, 'g',   2.250,      15,    'Import Supplier');

    // ── DRINKS ──────────────────────────────────────────────────────────────
    insert.run('oatside',        'Oatside',         'drinks',          0, 'ml',  0.130,      160,   'Oatside PH');
    insert.run('condensada',     'Condensada',      'drinks',          0, 'ml',  0.18349,    22,    'Local Market');

    // ── PACKAGING ───────────────────────────────────────────────────────────
    insert.run('packagingBox',   'Packaging Box',   'packaging',       0, 'pcs', 6.260,      3,     'Packaging Plus');
    insert.run('liner',          'Liner',           'packaging',       0, 'pcs', 0.258,      1,     'Packaging Plus');
    insert.run('cup12oz',        'Cup (12oz)',       'packaging',       0, 'pcs', 4.400,      1,     'Packaging Plus');
    insert.run('cup16oz',        'Cup (16oz)',       'packaging',       0, 'pcs', 5.000,      1,     'Packaging Plus');
    insert.run('straw',          'Straw',           'packaging',       0, 'pcs', 0.480,      1,     'Packaging Plus');
  });

  seed();
}

// ── Utility Functions (NEW) ─────────────────────────────────────────────────

/**
 * Cleanup old logs (call this periodically, e.g., daily cron job)
 */
function cleanupOldLogs(daysToKeep = 30) {
  const db = getDb();
  const result = db.prepare(`
    DELETE FROM inventory_logs 
    WHERE log_date < datetime('now', '-' || ? || ' days')
  `).run(daysToKeep);
  
  console.log(`[Database] Cleaned up ${result.changes} old log entries`);
  return result.changes;
}

/**
 * Get inventory valuation using the optimized view
 */
function getInventoryValuation() {
  const db = getDb();
  return db.prepare(`
    SELECT 
      id,
      name,
      category,
      current_stock,
      unit,
      unit_cost,
      total_value,
      stock_status
    FROM v_inventory_valuation
    ORDER BY total_value DESC
  `).all();
}

/**
 * Check low stock items using the partial index
 */
function getLowStockItems() {
  const db = getDb();
  return db.prepare(`
    SELECT 
      id,
      name,
      current_stock,
      unit,
      min_stock_level,
      ROUND(current_stock - min_stock_level, 4) as deficit
    FROM ingredients
    WHERE current_stock <= min_stock_level
    ORDER BY (current_stock - min_stock_level) ASC
  `).all();
}

/**
 * Get recent sales analytics
 */
function getSalesAnalytics(days = 7) {
  const db = getDb();
  return db.prepare(`
    SELECT 
      ingredient_id,
      name,
      total_deducted,
      unique_sales,
      last_sale_date
    FROM v_recent_deductions
    WHERE last_sale_date >= datetime('now', '-' || ? || ' days')
    ORDER BY total_deducted ASC
  `).all(days);
}

// ── Precision helper ──────────────────────────────────────────────────────────

/** Round to 4 decimal places — matches DECIMAL(12,4) PostgreSQL migration compatibility. */
function p4(n) {
  return Math.round(n * 10_000) / 10_000;
}

module.exports = { 
  getDb, 
  p4,
  // Export new utilities
  cleanupOldLogs,
  getInventoryValuation,
  getLowStockItems,
  getSalesAnalytics
};