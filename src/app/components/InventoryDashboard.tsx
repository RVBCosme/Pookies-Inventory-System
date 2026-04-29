/**
 * InventoryDashboard — Pookies Inventory Management System
 *
 * POS Integration:
 *   Pass `posSyncSignal` from handlePaymentComplete. When a sale completes,
 *   the dashboard deducts ingredient quantities. If stock crosses zero, the
 *   item is flagged with a Critical Stock Alert in the table.
 *
 *   posSyncSignal={{ id: saleId, deductions: { flour: 250, margarine: 115 } }}
 *
 * Negative Stock Policy (matches backend):
 *   Deductions are never blocked. If stock goes below zero, the item shows
 *   a "Critical" badge and the dashboard's critical count stat increments.
 *
 * Data retention:
 *   Transaction history is a rolling 30-day window; logs are purged nightly
 *   by the backend cleanupWorker.js cron job.
 *
 * Theme enforcement:
 *   --matcha-600  (#4A7C59)  — primary buttons, success states, header
 *   --cream       (#FEF9F2)  — page and input backgrounds
 *   --cookie-100  (#F0DCC0)  — card borders, dividers
 */

import { useState, useEffect, ReactNode, useRef } from 'react';
import {
  Plus,
  Package,
  AlertTriangle,
  DollarSign,
  Search,
  Cookie,
  Calculator,
  Camera,
  Info,
  ShieldAlert,
} from 'lucide-react';
import { InventoryList }    from './InventoryList';
import { AddItemModal }     from './AddItemModal';
import { StockInModal }     from './StockInModal';
import { StatsCard }        from './StatsCard';
import { ProductCosting }   from './ProductCosting';
import { BatchCalculator }  from './BatchCalculator';
import { CanIBakePanel }    from './CanIBakePanel';
import {
  initialInventory,
  InventoryItem,
  Category,
  CATEGORY_LABELS,
} from '../data/inventory';
import {
  addIngredient,
  updateIngredient,
  deleteIngredient,
  getStock,
  AddIngredientPayload,
  UpdateIngredientPayload,
} from '../services/inventoryApi';

type Tab = 'inventory' | 'costing' | 'calculator';

// Signal sent by the POS when a sale is completed.
// deductions: { ingredientId: amountConsumed }
export interface POSSyncSignal {
  id: string;                             // unique sale ID — change triggers the effect
  deductions: Record<string, number>;
}

interface InventoryDashboardProps {
  posSyncSignal?: POSSyncSignal;
}

export function InventoryDashboard({ posSyncSignal }: InventoryDashboardProps = {}) {
  const [inventory, setInventory]         = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading]         = useState(true);
  const [showAddModal, setShowAddModal]   = useState(false);
  const [showStockIn, setShowStockIn]     = useState(false);
  const [searchQuery, setSearchQuery]     = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [activeTab, setActiveTab]         = useState<Tab>('inventory');

  // Track the last-processed sale ID to prevent duplicate deductions
  const lastSyncId = useRef<string | null>(null);

  // ── Fetch inventory from backend on mount ───────────────────────────────
  useEffect(() => {
    const fetchInventory = async () => {
      setIsLoading(true);
      try {
        const response = await getStock();
        
        // Map backend StockIngredient to frontend InventoryItem
        const items: InventoryItem[] = response.ingredients.map(ingredient => ({
          id: ingredient.id,
          name: ingredient.name,
          category: ingredient.category as Category,
          quantity: ingredient.current_stock,
          unit: ingredient.unit,
          minStock: ingredient.min_stock_level,
          costPerUnit: ingredient.unit_cost,
          supplier: ingredient.supplier ?? '',
          lastUpdated: new Date(),
        }));
        
        setInventory(items);
      } catch (err) {
        console.error('[fetchInventory]', err);
        // If fetch fails, still stop loading (show empty state rather than test data)
        console.warn('Failed to fetch inventory from backend');
      } finally {
        setIsLoading(false);
      }
    };

    fetchInventory();
  }, []);

  // ── POS sync ────────────────────────────────────────────────────────────
  // Negative stock is intentionally allowed (matches backend policy).
  // Items that cross zero will render a Critical badge in InventoryList.
  useEffect(() => {
    if (!posSyncSignal) return;
    if (posSyncSignal.id === lastSyncId.current) return;
    lastSyncId.current = posSyncSignal.id;

    setInventory(prev =>
      prev.map(item => {
        const deduction = posSyncSignal.deductions[item.id];
        if (deduction == null) return item;
        return {
          ...item,
          // No Math.max(0, ...) — allow negative so Critical badge activates
          quantity: Math.round((item.quantity - deduction) * 10_000) / 10_000,
          lastUpdated: new Date(),
        };
      })
    );
  }, [posSyncSignal]);

  // ── Derived stats ────────────────────────────────────────────────────────
  const totalItems    = inventory.length;
  const criticalItems = inventory.filter(i => i.quantity <= 0).length;
  // Low = below batch threshold but above zero
  const lowItems      = inventory.filter(i => i.quantity > 0 && i.quantity < i.minStock).length;
  const totalValue    = inventory.reduce(
    (sum, item) => sum + Math.max(item.quantity, 0) * item.costPerUnit,
    0
  );

  // ── CRUD ─────────────────────────────────────────────────────────────────
  const addItem = async (item: Omit<InventoryItem, 'id' | 'lastUpdated'>) => {
    try {
      const ingredientId = Date.now().toString();
      const payload: AddIngredientPayload = {
        id: ingredientId,
        name: item.name,
        category: item.category,
        unit: item.unit,
        unit_cost: item.costPerUnit,
        min_stock_level: item.minStock,
        current_stock: item.quantity,
        supplier: item.supplier || undefined,
      };
      
      const response = await addIngredient(payload);
      
      setInventory(prev => [
        ...prev,
        {
          id: ingredientId,
          ...item,
          lastUpdated: new Date(),
        },
      ]);
      setShowAddModal(false);
    } catch (err) {
      console.error('[addItem]', err);
      alert(`Failed to add ingredient: ${(err as Error).message}`);
    }
  };

  const updateItem = async (id: string, updates: Partial<InventoryItem>) => {
    try {
      const currentItem = inventory.find(i => i.id === id);
      if (!currentItem) return;

      const payload: UpdateIngredientPayload = {};
      
      if (updates.name !== undefined && updates.name !== currentItem.name) {
        payload.name = updates.name;
      }
      if (updates.category !== undefined && updates.category !== currentItem.category) {
        payload.category = updates.category;
      }
      if (updates.costPerUnit !== undefined && updates.costPerUnit !== currentItem.costPerUnit) {
        payload.unit_cost = updates.costPerUnit;
      }
      if (updates.minStock !== undefined && updates.minStock !== currentItem.minStock) {
        payload.min_stock_level = updates.minStock;
      }
      if (updates.quantity !== undefined && updates.quantity !== currentItem.quantity) {
        payload.current_stock = updates.quantity;
      }
      if (updates.supplier !== undefined && updates.supplier !== currentItem.supplier) {
        payload.supplier = updates.supplier;
      }

      // Only make API call if there are actual changes
      if (Object.keys(payload).length > 0) {
        console.log(`[updateItem] Calling API for ingredient ${id}:`, payload);
        const response = await updateIngredient(id, payload);
        console.log(`[updateItem] API response:`, response);
      }

      setInventory(prev =>
        prev.map(item =>
          item.id === id ? { ...item, ...updates, lastUpdated: new Date() } : item
        )
      );
    } catch (err) {
      console.error('[updateItem] Error:', err);
      alert(`Failed to update ingredient: ${(err as Error).message}`);
      // Re-fetch from backend to reset UI to actual state
      try {
        const response = await getStock();
        const items: InventoryItem[] = response.ingredients.map(ingredient => ({
          id: ingredient.id,
          name: ingredient.name,
          category: ingredient.category as Category,
          quantity: ingredient.current_stock,
          unit: ingredient.unit,
          minStock: ingredient.min_stock_level,
          costPerUnit: ingredient.unit_cost,
          supplier: ingredient.supplier ?? '',
          lastUpdated: new Date(),
        }));
        setInventory(items);
      } catch (e) {
        console.error('[updateItem] Failed to re-fetch inventory:', e);
      }
    }
  };

  const deleteItem = async (id: string) => {
    try {
      await deleteIngredient(id);
      setInventory(prev => prev.filter(item => item.id !== id));
    } catch (err) {
      console.error('[deleteItem]', err);
      alert(`Failed to delete ingredient: ${(err as Error).message}`);
    }
  };

  const handleStockIn = (updates: Record<string, number>) => {
    setInventory(prev =>
      prev.map(item => {
        const added = updates[item.id];
        if (!added || added <= 0) return item;
        return {
          ...item,
          quantity: Math.round((item.quantity + added) * 10_000) / 10_000,
          lastUpdated: new Date(),
        };
      })
    );
  };

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filteredInventory = inventory.filter(item => {
    const matchesSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.supplier ?? '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = filterCategory === 'all' || item.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: 'inventory',  label: 'Stock Monitor',    icon: <Package className="w-4 h-4" /> },
    { id: 'costing',    label: 'Product Costing',  icon: <Cookie className="w-4 h-4" /> },
    { id: 'calculator', label: 'Batch Calculator', icon: <Calculator className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen" style={{ background: '#FEF9F2' }}>

      {/* ── Header — matcha-600 background ─────────────────────────────── */}
      <header style={{ background: '#4A7C59' }} className="px-6 py-5 shadow-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 rounded-xl p-2">
              <Cookie className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1
                className="text-white"
                style={{ fontFamily: "'DM Serif Display', serif", fontSize: '1.5rem', lineHeight: 1.2 }}
              >
                Pookies
              </h1>
              <p className="text-white/70 text-xs">Inventory Management System</p>
            </div>
          </div>

          {activeTab === 'inventory' && (
            <div className="flex items-center gap-2">
              {/* Stock-In — white on matcha, primary action */}
              <button
                onClick={() => setShowStockIn(true)}
                className="flex items-center gap-2 bg-white text-[#4A7C59] hover:bg-[#F5EFE6] rounded-xl px-4 py-2 transition-colors text-sm shadow-sm"
                style={{ fontWeight: 500 }}
              >
                <Camera className="w-4 h-4" />
                Stock-In
              </button>
              {/* Add new SKU */}
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-2 bg-white/20 hover:bg-white/30 text-white rounded-xl px-4 py-2 transition-colors text-sm"
              >
                <Plus className="w-4 h-4" />
                Add Item
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ── Tab Navigation ─────────────────────────────────────────────── */}
      <div style={{ background: '#2D5A3D' }} className="px-6">
        <div className="max-w-7xl mx-auto flex gap-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm transition-colors rounded-t-lg mt-1 ${
                activeTab === tab.id
                  ? 'bg-[#FEF9F2] text-[#2D5A3D]'
                  : 'text-white/70 hover:text-white hover:bg-white/10'
              }`}
              style={{ fontWeight: activeTab === tab.id ? 600 : 400 }}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Main Content ───────────────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-6 py-6">

        {/* ── Stat cards — Inventory tab only ─────────────────────────── */}
        {activeTab === 'inventory' && !isLoading && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatsCard
              icon={<Package className="w-5 h-5" />}
              label="Total SKUs"
              value={totalItems}
              variant="matcha"
            />
            <StatsCard
              icon={<AlertTriangle className="w-5 h-5" />}
              label="Low Stock"
              value={lowItems}
              variant="alert"
            />
            <StatsCard
              icon={<ShieldAlert className="w-5 h-5" />}
              label="Critical Stock"
              value={criticalItems}
              variant="critical"
            />
            <StatsCard
              icon={<DollarSign className="w-5 h-5" />}
              label="Inventory Asset Value"
              value={`₱${totalValue.toLocaleString('en-PH', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}`}
              variant="cream"
            />
          </div>
        )}

        {/* ── Inventory Tab ─────────────────────────────────────────────── */}
        {activeTab === 'inventory' && (
          <>
            {/* Data retention notice */}
            <div className="flex items-start gap-2 bg-white rounded-xl border border-[#F0DCC0] px-4 py-3 mb-4 shadow-sm">
              <Info className="w-4 h-4 text-[#C5B5A8] mt-0.5 shrink-0" />
              <p className="text-xs text-[#9A8F86]">
                Transaction history is maintained for a rolling{' '}
                <span style={{ fontWeight: 600, color: '#7A6558' }}>30-day period</span>.
                Logs older than 30 days are automatically purged by the backend
                cleanup worker to keep the system fast and responsive.
              </p>
            </div>

            {/* Production Readiness — "Can I Bake?" panel */}
            {!isLoading && <CanIBakePanel inventory={inventory} />}

            {isLoading ? (
              // Loading state
              <div className="bg-white rounded-2xl border border-[#F0DCC0] p-6 shadow-sm">
                <div className="flex flex-col items-center justify-center py-12 gap-4">
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[#E8F2EB] animate-pulse">
                    <Package className="w-5 h-5 text-[#4A7C59]" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm text-[#7A6558]" style={{ fontWeight: 500 }}>
                      Loading inventory from database...
                    </p>
                    <p className="text-xs text-[#C5B5A8] mt-1">This may take a moment on first load</p>
                  </div>
                </div>
              </div>
            ) : inventory.length === 0 ? (
              // No data state
              <div className="bg-white rounded-2xl border border-[#F0DCC0] p-6 shadow-sm">
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Package className="w-8 h-8 text-[#D0C4BE]" />
                  <div className="text-center">
                    <p className="text-sm text-[#7A6558]" style={{ fontWeight: 500 }}>
                      No ingredients in database
                    </p>
                    <p className="text-xs text-[#C5B5A8] mt-1">Add ingredients to get started</p>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* Search + filter controls */}
                <div className="bg-white rounded-2xl border border-[#F0DCC0] p-4 mb-4 shadow-sm">
                  <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
                    <div className="flex-1 w-full relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#C5B5A8]" />
                      <input
                        type="text"
                        placeholder="Search ingredients or suppliers..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 border border-[#F0DCC0] rounded-xl bg-[#FEF9F2] focus:outline-none focus:ring-2 focus:ring-[#4A7C59]/40 text-sm text-[#3C2A1E]"
                        style={{ fontFamily: "'DM Sans', sans-serif" }}
                      />
                    </div>
                    <select
                      value={filterCategory}
                      onChange={e => setFilterCategory(e.target.value)}
                      className="px-4 py-2 border border-[#F0DCC0] rounded-xl bg-[#FEF9F2] focus:outline-none focus:ring-2 focus:ring-[#4A7C59]/40 text-sm text-[#3C2A1E]"
                      style={{ fontFamily: "'DM Sans', sans-serif" }}
                    >
                      <option value="all">All Categories</option>
                      {(Object.keys(CATEGORY_LABELS) as Category[]).map(cat => (
                        <option key={cat} value={cat}>
                          {CATEGORY_LABELS[cat]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <InventoryList
                  items={filteredInventory}
                  onUpdate={updateItem}
                  onDelete={deleteItem}
                />
              </>
            )}
          </>
        )}

        {activeTab === 'costing'    && <ProductCosting />}
        {activeTab === 'calculator' && <BatchCalculator inventory={inventory} />}
      </main>

      {/* ── Modals ─────────────────────────────────────────────────────── */}
      {showAddModal && (
        <AddItemModal onAdd={addItem} onClose={() => setShowAddModal(false)} />
      )}
      {showStockIn && (
        <StockInModal
          inventory={inventory}
          onStockIn={handleStockIn}
          onClose={() => setShowStockIn(false)}
        />
      )}
    </div>
  );
}
