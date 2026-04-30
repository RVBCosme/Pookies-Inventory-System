/**
 * routes/inventory.js — Pookies Inventory API Routes
 *
 * Mount in server.js:
 *   app.use('/api/inventory', require('./routes/inventory'));
 *
 * Full route map:
 *   GET    /api/inventory/stock           — current stock for all ingredients
 *   GET    /api/inventory/valuation       — total asset value (SQLite arithmetic)
 *   PATCH  /api/inventory/deduct         — apply POS sale deductions
 *   POST   /api/inventory/restock        — confirm received quantities
 *   POST   /api/inventory/receipt        — upload receipt image
 *   POST   /api/inventory/add            — add new ingredient to master list
 *   PUT    /api/inventory/update/:id     — update ingredient metadata / stock
 *   DELETE /api/inventory/delete/:id     — permanently remove ingredient
 */

'use strict';

const router = require('express').Router();
const ctrl   = require('../controllers/inventoryController');

// ── Read ──────────────────────────────────────────────────────────────────────

// GET  /api/inventory/stock         — current stock levels for all ingredients
router.get('/stock',       ctrl.getStock);

// GET  /api/inventory/valuation     — total asset value calculated in SQLite
router.get('/valuation',   ctrl.getValuation);

// ── POS integration ───────────────────────────────────────────────────────────

// PATCH /api/inventory/deduct       — apply POS sale deductions (from useInventorySync.tsx)
router.patch('/deduct',    ctrl.deductStock);

// ── Receipt restock workflow ──────────────────────────────────────────────────

// POST  /api/inventory/restock      — confirm received quantities + save audit snapshot
router.post('/restock',    ctrl.restockIngredient);

// POST  /api/inventory/receipt      — upload receipt image → saved as rec_YYYYMMDD_HHmm.jpg
router.post(
  '/receipt',
  ctrl.receiptUpload.single('receipt'),  // multer middleware (field name: "receipt")
  ctrl.uploadReceipt
);

// ── Master list CRUD ──────────────────────────────────────────────────────────

// POST   /api/inventory/add            — create new ingredient (logs ADJUSTMENT)
router.post('/add',              ctrl.addIngredient);

// PUT    /api/inventory/update/:id     — update metadata / stock (logs ADJUSTMENT, blocks unit change)
router.put('/update/:id',        ctrl.updateIngredient);

// DELETE /api/inventory/delete/:id     — remove ingredient + its log rows (logs ADJUSTMENT to file)
router.delete('/delete/:id',     ctrl.deleteIngredient);

// NEW routes
router.get('/transactions', ctrl.getTransactions);
router.get('/low-stock', ctrl.getLowStock);

module.exports = router;