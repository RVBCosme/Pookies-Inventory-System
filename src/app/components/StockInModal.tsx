import { useState, useRef, useCallback } from 'react';
import {
  X,
  Camera,
  Upload,
  CheckCircle,
  FolderOpen,
  Save,
  RotateCcw,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Loader,
} from 'lucide-react';
import { InventoryItem, CATEGORY_LABELS, Category } from '../data/inventory';
import { uploadReceipt, restockIngredient } from '../services/inventoryApi';

interface StockInModalProps {
  inventory: InventoryItem[];
  onStockIn: (updates: Record<string, number>) => void;
  onClose: () => void;
}

type Step = 'upload' | 'confirm' | 'success';

const inputClass =
  'w-full px-3 py-2 border border-[#F0DCC0] rounded-xl bg-[#FEF9F2] focus:outline-none focus:ring-2 focus:ring-[#4A7C59]/40 text-sm text-[#3C2A1E] placeholder-[#C5B5A8]';

function formatQty(qty: number, unit: string) {
  const n = qty % 1 === 0 ? qty.toLocaleString() : qty.toFixed(2);
  return `${n} ${unit}`;
}

// Groups items by category for the confirmation form
function groupByCategory(items: InventoryItem[]): Record<Category, InventoryItem[]> {
  const groups = {} as Record<Category, InventoryItem[]>;
  for (const item of items) {
    if (!groups[item.category]) groups[item.category] = [];
    groups[item.category].push(item);
  }
  return groups;
}

export function StockInModal({ inventory, onStockIn, onClose }: StockInModalProps) {
  const [step, setStep] = useState<Step>('upload');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [successTime, setSuccessTime] = useState<Date | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedReceiptName, setUploadedReceiptName] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── File Handling ────────────────────────────────────────────────────────
  const handleFileSelect = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    setReceiptFile(file);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  };

  // ── Form Handling ────────────────────────────────────────────────────────
  const setQty = (id: string, value: string) => {
    setQuantities(prev => ({ ...prev, [id]: value }));
  };

  const toggleCategory = (cat: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

  const updatedItems = Object.entries(quantities).filter(
    ([, v]) => v !== '' && parseFloat(v) > 0
  );

  const handleConfirm = async () => {
    setUploadError(null);
    setIsUploading(true);

    try {
      let receiptUploadId: number | undefined;

      // Step 1: Upload receipt image if selected
      if (receiptFile) {
        try {
          const receiptResponse = await uploadReceipt(receiptFile);
          receiptUploadId = receiptResponse.id;
          setUploadedReceiptName(receiptResponse.imageName);
        } catch (uploadErr) {
          const errorMsg = (uploadErr as Error).message || 'Failed to upload receipt';
          setUploadError(errorMsg);
          setIsUploading(false);
          return;
        }
      }

      // Step 2: Build restock items from quantities
      const items = updatedItems
        .map(([id, val]) => {
          const item = inventory.find(i => i.id === id);
          if (!item) return null;
          return {
            ingredientId: id,
            name: item.name,
            amountAdded: parseFloat(val),
            unit: item.unit,
          };
        })
        .filter(Boolean) as Array<{
          ingredientId: string;
          name: string;
          amountAdded: number;
          unit: string;
        }>;

      // Step 3: Confirm restock with backend
      try {
        await restockIngredient({
          receiptUploadId,
          items,
        });
      } catch (restockErr) {
        const errorMsg = (restockErr as Error).message || 'Failed to confirm restock';
        setUploadError(errorMsg);
        setIsUploading(false);
        return;
      }

      // Step 4: Update parent state with the quantities
      const updates: Record<string, number> = {};
      for (const [id, val] of updatedItems) {
        const n = parseFloat(val);
        if (!isNaN(n) && n > 0) updates[id] = n;
      }
      onStockIn(updates);

      // Step 5: Show success
      setSuccessTime(new Date());
      setStep('success');
    } finally {
      setIsUploading(false);
    }
  };

  const handleReset = () => {
    setStep('upload');
    setReceiptFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setQuantities({});
    setSuccessTime(null);
    setUploadError(null);
    setUploadedReceiptName(null);
    setIsUploading(false);
  };

  // ── Helpers ──────────────────────────────────────────────────────────────
  const formatSuccessTime = (date: Date) =>
    date.toLocaleString('en-PH', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

  const grouped = groupByCategory(inventory);
  const categoryOrder: Category[] = ['baking', 'dairy', 'specialty', 'drinks', 'packaging', 'other'];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div
        className="bg-white rounded-2xl border border-[#F0DCC0] w-full max-w-lg max-h-[92vh] flex flex-col shadow-2xl"
        style={{ fontFamily: "'DM Sans', sans-serif" }}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#F5EFE6] shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-[#4A7C59] rounded-xl p-2">
              <Camera className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2
                style={{ fontFamily: "'DM Serif Display', serif", fontSize: '1.2rem', color: '#2C1810' }}
              >
                Stock-In
              </h2>
              <p className="text-xs text-[#C5B5A8] mt-0.5">
                {step === 'upload' && 'Upload receipt to begin'}
                {step === 'confirm' && 'Enter quantities received'}
                {step === 'success' && 'Update complete'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#C5B5A8] hover:text-[#9A8F86] hover:bg-[#F5EFE6] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Step Indicator ── */}
        <div className="flex items-center px-6 py-3 border-b border-[#F5EFE6] gap-2 shrink-0">
          {(['upload', 'confirm', 'success'] as Step[]).map((s, i) => {
            const stepLabels = ['1. Receipt', '2. Quantities', '3. Done'];
            const isActive = step === s;
            const isPast =
              (s === 'upload' && (step === 'confirm' || step === 'success')) ||
              (s === 'confirm' && step === 'success');
            return (
              <div key={s} className="flex items-center gap-2 flex-1">
                <div
                  className={`flex items-center gap-1.5 text-xs transition-colors ${
                    isActive
                      ? 'text-[#4A7C59]'
                      : isPast
                      ? 'text-[#9A8F86]'
                      : 'text-[#D0C4BE]'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-xs border shrink-0 ${
                      isActive
                        ? 'bg-[#4A7C59] border-[#4A7C59] text-white'
                        : isPast
                        ? 'bg-[#E8F2EB] border-[#B8D9C2] text-[#4A7C59]'
                        : 'bg-white border-[#E0D0C8] text-[#D0C4BE]'
                    }`}
                  >
                    {isPast ? <CheckCircle className="w-3 h-3" /> : i + 1}
                  </div>
                  <span style={{ fontWeight: isActive ? 600 : 400 }}>{stepLabels[i]}</span>
                </div>
                {i < 2 && (
                  <div className={`flex-1 h-px ${isPast || isActive ? 'bg-[#B8D9C2]' : 'bg-[#F0DCC0]'}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto">

          {/* ─── Step 1: Upload ─────────────────────────────────────────── */}
          {step === 'upload' && (
            <div className="p-6 space-y-5">
              {/* Storage path notice */}
              <div className="flex items-start gap-3 bg-[#F5EFE6] rounded-xl px-4 py-3 border border-[#F0DCC0]">
                <FolderOpen className="w-4 h-4 text-[#9A8F86] mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-[#7A6558]" style={{ fontWeight: 500 }}>
                    Storage destination
                  </p>
                  <p className="text-xs text-[#9A8F86] mt-0.5 font-mono">/Receipts/</p>
                  <p className="text-xs text-[#C5B5A8] mt-1">
                    Receipt images are stored in the /Receipts/ directory on the backend server.
                    Confirm quantities manually before saving.
                  </p>
                </div>
              </div>

              {/* Drop zone */}
              {!receiptFile ? (
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center cursor-pointer transition-colors ${
                    isDragging
                      ? 'border-[#4A7C59] bg-[#E8F2EB]'
                      : 'border-[#F0DCC0] bg-[#FEF9F2] hover:border-[#B8D9C2] hover:bg-[#F5F9F5]'
                  }`}
                >
                  <Upload
                    className={`w-10 h-10 mb-3 ${isDragging ? 'text-[#4A7C59]' : 'text-[#D0C4BE]'}`}
                  />
                  <p className="text-sm text-[#3C2A1E]" style={{ fontWeight: 500 }}>
                    Drop receipt photo here
                  </p>
                  <p className="text-xs text-[#C5B5A8] mt-1">or click to browse</p>
                  <p className="text-xs text-[#D0C4BE] mt-3">PNG, JPG, WEBP supported</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleInputChange}
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Preview */}
                  <div className="relative rounded-2xl overflow-hidden border border-[#F0DCC0] bg-[#F5EFE6]">
                    {previewUrl && (
                      <img
                        src={previewUrl}
                        alt="Receipt preview"
                        className="w-full max-h-56 object-contain"
                      />
                    )}
                    <div className="absolute top-3 right-3">
                      <button
                        onClick={handleReset}
                        className="bg-white/90 hover:bg-white rounded-lg px-2.5 py-1.5 flex items-center gap-1.5 text-xs text-[#9A8F86] border border-[#F0DCC0] shadow-sm transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Replace
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[#7A6558] bg-[#E8F2EB] rounded-lg px-3 py-2 border border-[#B8D9C2]">
                    <CheckCircle className="w-3.5 h-3.5 text-[#4A7C59] shrink-0" />
                    <span>
                      <span style={{ fontWeight: 500 }}>{receiptFile.name}</span> — ready to
                      upload to <span className="font-mono">/Receipts/</span>
                    </span>
                  </div>
                </div>
              )}

              {/* Skip option */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-[#F0DCC0]" />
                <span className="text-xs text-[#C5B5A8]">or</span>
                <div className="flex-1 h-px bg-[#F0DCC0]" />
              </div>
              <button
                onClick={() => setStep('confirm')}
                className="w-full text-center text-xs text-[#9A8F86] hover:text-[#4A7C59] transition-colors py-1"
              >
                Skip receipt upload, enter quantities manually
              </button>
            </div>
          )}

          {/* ─── Step 2: Confirm Quantities ─────────────────────────────── */}
          {step === 'confirm' && (
            <div className="p-6 space-y-4">
              <div className="flex items-start gap-2 bg-[#F5EFE6] rounded-xl px-4 py-3 border border-[#F0DCC0]">
                <AlertCircle className="w-4 h-4 text-[#9A8F86] mt-0.5 shrink-0" />
                <p className="text-xs text-[#7A6558]">
                  Enter the quantity received for each ingredient. Leave blank or zero to skip.
                  Amounts are added to current stock levels.
                </p>
              </div>

              {uploadError && (
                <div className="flex items-start gap-2 bg-red-50 rounded-xl px-4 py-3 border border-red-200">
                  <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-red-700">
                    {uploadError}
                  </p>
                </div>
              )}

              {categoryOrder.map(cat => {
                const items = grouped[cat];
                if (!items || items.length === 0) return null;
                const isCollapsed = collapsedCategories.has(cat);
                return (
                  <div key={cat} className="rounded-2xl border border-[#F0DCC0] overflow-hidden">
                    <button
                      onClick={() => toggleCategory(cat)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-[#F5EFE6] hover:bg-[#F0E8DC] transition-colors text-left"
                    >
                      <span
                        className="text-xs uppercase tracking-wider text-[#7A6558]"
                        style={{ fontWeight: 600 }}
                      >
                        {CATEGORY_LABELS[cat]}
                      </span>
                      <div className="flex items-center gap-2">
                        {items.some(i => quantities[i.id] && parseFloat(quantities[i.id]) > 0) && (
                          <span className="bg-[#4A7C59] text-white text-xs rounded-full px-2 py-0.5">
                            {items.filter(i => quantities[i.id] && parseFloat(quantities[i.id]) > 0).length}
                          </span>
                        )}
                        {isCollapsed ? (
                          <ChevronDown className="w-4 h-4 text-[#9A8F86]" />
                        ) : (
                          <ChevronUp className="w-4 h-4 text-[#9A8F86]" />
                        )}
                      </div>
                    </button>

                    {!isCollapsed && (
                      <div className="divide-y divide-[#F5EFE6]">
                        {items.map(item => (
                          <div
                            key={item.id}
                            className="flex items-center gap-3 px-4 py-3 hover:bg-[#FEFAF5] transition-colors"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-[#2C1810]" style={{ fontWeight: 500 }}>
                                {item.name}
                              </p>
                              <p className="text-xs text-[#C5B5A8] mt-0.5">
                                Current: {formatQty(item.quantity, item.unit)}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <input
                                type="number"
                                min="0"
                                step="0.001"
                                placeholder="0"
                                value={quantities[item.id] ?? ''}
                                onChange={e => setQty(item.id, e.target.value)}
                                className="w-24 px-3 py-1.5 border border-[#F0DCC0] rounded-lg bg-[#FEF9F2] focus:outline-none focus:ring-2 focus:ring-[#4A7C59]/40 text-sm text-[#3C2A1E] text-right"
                              />
                              <span className="text-xs text-[#9A8F86] w-8 shrink-0">
                                {item.unit}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {updatedItems.length > 0 && (
                <div className="rounded-2xl border border-[#B8D9C2] bg-[#E8F2EB] px-4 py-3">
                  <p className="text-xs text-[#4A7C59]" style={{ fontWeight: 600 }}>
                    {updatedItems.length} ingredient{updatedItems.length !== 1 ? 's' : ''} will be updated
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ─── Step 3: Success ─────────────────────────────────────────── */}
          {step === 'success' && successTime && (
            <div className="p-6 flex flex-col items-center text-center space-y-6">
              <div className="bg-[#E8F2EB] rounded-full p-5 mt-4">
                <CheckCircle className="w-12 h-12 text-[#4A7C59]" />
              </div>

              <div>
                <h3
                  style={{
                    fontFamily: "'DM Serif Display', serif",
                    fontSize: '1.3rem',
                    color: '#2C1810',
                  }}
                >
                  Stock-In Successful
                </h3>
                <p className="text-xs text-[#9A8F86] mt-2">{formatSuccessTime(successTime)}</p>
              </div>

              <div className="w-full rounded-2xl border border-[#F0DCC0] overflow-hidden">
                <div className="px-4 py-3 bg-[#F5EFE6] text-left">
                  <p className="text-xs uppercase tracking-wider text-[#9A8F86]" style={{ fontWeight: 600 }}>
                    Ingredients Updated
                  </p>
                </div>
                <div className="divide-y divide-[#F5EFE6] max-h-52 overflow-y-auto">
                  {updatedItems.map(([id, val]) => {
                    const item = inventory.find(i => i.id === id);
                    if (!item) return null;
                    return (
                      <div key={id} className="flex items-center justify-between px-4 py-3">
                        <span className="text-sm text-[#2C1810]">{item.name}</span>
                        <span className="text-sm text-[#4A7C59]" style={{ fontWeight: 600 }}>
                          +{parseFloat(val).toFixed(2)} {item.unit}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {receiptFile && uploadedReceiptName && (
                <div className="flex items-center gap-2 text-xs text-[#7A6558] bg-[#F5EFE6] rounded-xl px-4 py-3 border border-[#F0DCC0] w-full">
                  <FolderOpen className="w-3.5 h-3.5 shrink-0 text-[#9A8F86]" />
                  <span>
                    Receipt saved to{' '}
                    <span className="font-mono text-[#4A7C59]">/Receipts/{uploadedReceiptName}</span>
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-6 py-4 border-t border-[#F5EFE6] flex gap-3 shrink-0">
          {step === 'upload' && (
            <>
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2.5 border border-[#F0DCC0] text-[#9A8F86] rounded-xl hover:bg-[#F5EFE6] transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => setStep('confirm')}
                disabled={!receiptFile}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-white text-sm transition-colors ${
                  receiptFile
                    ? 'bg-[#4A7C59] hover:bg-[#3d6b4d]'
                    : 'bg-[#D0C4BE] cursor-not-allowed'
                }`}
              >
                <Camera className="w-4 h-4" />
                Next: Confirm Quantities
              </button>
            </>
          )}

          {step === 'confirm' && (
            <>
              <button
                onClick={() => setStep('upload')}
                disabled={isUploading}
                className="flex-1 px-4 py-2.5 border border-[#F0DCC0] text-[#9A8F86] rounded-xl hover:bg-[#F5EFE6] transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Back
              </button>
              <button
                onClick={handleConfirm}
                disabled={updatedItems.length === 0 || isUploading}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-white text-sm transition-colors ${
                  updatedItems.length > 0 && !isUploading
                    ? 'bg-[#4A7C59] hover:bg-[#3d6b4d]'
                    : 'bg-[#D0C4BE] cursor-not-allowed'
                }`}
              >
                {isUploading ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Save Stock-In
                    {updatedItems.length > 0 && ` (${updatedItems.length})`}
                  </>
                )}
              </button>
            </>
          )}

          {step === 'success' && (
            <>
              <button
                onClick={handleReset}
                className="flex-1 px-4 py-2.5 border border-[#F0DCC0] text-[#9A8F86] rounded-xl hover:bg-[#F5EFE6] transition-colors text-sm"
              >
                New Stock-In
              </button>
              <button
                onClick={onClose}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-white text-sm bg-[#4A7C59] hover:bg-[#3d6b4d] transition-colors"
              >
                <CheckCircle className="w-4 h-4" />
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
