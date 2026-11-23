import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Camera, Minus, PauseCircle, PlayCircle, Plus, Search, Trash2, UserPlus } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { queueOfflineOperation } from '../lib/offlineDb';
import { openCashDrawer } from '../lib/cashDrawer';
import { formatBDT, UI_TEXT, type Lang } from '../i18n';
import type { CartItem, Category, Customer, Product, Sale, ShopSettings } from '../types';
import { ProductImage } from '../components/ProductImage';

interface POSViewProps {
  lang: Lang;
  isOnline: boolean;
  products: Product[];
  categories: Category[];
  customers: Customer[];
  sales: Sale[];
  settings: ShopSettings | null;
  cart: CartItem[];
  setCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
  onOpenAIScanner: () => void;
  onRefreshData: () => Promise<void>;
  onPrintSale: (sale: Sale) => void;
}

export const POSView: React.FC<POSViewProps> = ({
  lang,
  isOnline,
  products,
  categories,
  customers,
  sales,
  settings,
  cart,
  setCart,
  onOpenAIScanner,
  onRefreshData,
  onPrintSale,
}) => {
  const t = UI_TEXT[lang];
  const searchRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [catFilter, setCatFilter] = useState<string>('ALL');
  const [brandFilter, setBrandFilter] = useState<string>('ALL');
  const [customerId, setCustomerId] = useState<number | ''>('');
  const [discountType, setDiscountType] = useState<'FIXED' | 'PERCENT'>('FIXED');
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [vatPercent, setVatPercent] = useState<number>(settings?.default_vat_percent ?? 0);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD' | 'MOBILE_BANKING' | 'SPLIT' | 'CREDIT'>('CASH');
  const [paidAmount, setPaidAmount] = useState<string>('');
  const [splitCash, setSplitCash] = useState<number>(0);
  const [splitDigital, setSplitDigital] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [drawerNotice, setDrawerNotice] = useState<string | null>(null);
  const [showHeldModal, setShowHeldModal] = useState(false);
  const [showQuickCust, setShowQuickCust] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');

  const brands = useMemo(
    () => Array.from(new Set(products.map((p) => p.brand).filter(Boolean))).sort(),
    [products]
  );

  const heldSales = useMemo(() => sales.filter((s) => s.status === 'HELD'), [sales]);

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (catFilter !== 'ALL' && String(p.category_id) !== catFilter) return false;
      if (brandFilter !== 'ALL' && p.brand !== brandFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.name_bn || '').toLowerCase().includes(q) ||
        (p.generic_name || '').toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q) ||
        (p.brand || '').toLowerCase().includes(q)
      );
    });
  }, [products, query, catFilter, brandFilter]);

  const getMultiplier = (p: Product, unit: CartItem['unit']) => {
    if (unit === 'Strip') return Math.max(1, p.units_per_strip || 1);
    if (unit === 'Box') return Math.max(1, (p.units_per_strip || 1) * (p.strips_per_box || 1));
    return 1;
  };

  const addToCart = (p: Product) => {
    const defaultUnit = (['Piece', 'Tablet', 'Strip', 'Box', 'Bottle'].includes(p.unit) ? p.unit : 'Piece') as CartItem['unit'];
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.product.id === p.id && c.unit === defaultUnit);
      if (idx >= 0) {
        return prev.map((c, i) => (i === idx ? { ...c, quantity: c.quantity + 1 } : c));
      }
      return [
        ...prev,
        {
          product: p,
          unit: defaultUnit,
          unit_multiplier: 1,
          quantity: 1,
          unit_price: p.retail_price,
          discount: 0,
        },
      ];
    });
  };

  // Barcode Enter-to-Add
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && query.trim()) {
      const q = query.trim().toLowerCase();
      const exact = products.find((p) => p.barcode.toLowerCase() === q || p.sku.toLowerCase() === q);
      if (exact) {
        addToCart(exact);
        setQuery('');
      } else if (filteredProducts.length === 1) {
        addToCart(filteredProducts[0]);
        setQuery('');
      }
    }
  };

  const subtotal = useMemo(
    () => cart.reduce((sum, it) => sum + it.quantity * it.unit_price - it.discount, 0),
    [cart]
  );

  const discountAmount = useMemo(() => {
    if (discountType === 'PERCENT') return Number(((subtotal * discountValue) / 100).toFixed(2));
    return Math.min(subtotal, Number(discountValue || 0));
  }, [subtotal, discountType, discountValue]);

  const taxable = Math.max(0, subtotal - discountAmount);
  const vatAmount = Number(((taxable * vatPercent) / 100).toFixed(2));
  const grandTotal = Number((taxable + vatAmount).toFixed(2));

  const effectiveTendered = useMemo(() => {
    if (paymentMethod === 'CREDIT') return Number(paidAmount || 0);
    if (paymentMethod === 'SPLIT') return Number(splitCash || 0) + Number(splitDigital || 0);
    return paidAmount === '' ? grandTotal : Number(paidAmount);
  }, [paymentMethod, paidAmount, splitCash, splitDigital, grandTotal]);

  const changeAmount = Math.max(0, Number((effectiveTendered - grandTotal).toFixed(2)));
  const effectivePaid = Math.min(grandTotal, effectiveTendered);
  const dueAmount = Math.max(0, Number((grandTotal - effectivePaid).toFixed(2)));

  // Cash drawer listener
  useEffect(() => {
    const handler = () => {
      setDrawerNotice(lang === 'bn' ? 'ক্যাশড্রয়ার খোলা হয়েছে' : 'Cash Drawer Opened');
      setTimeout(() => setDrawerNotice(null), 2500);
    };
    window.addEventListener('cash-drawer-opened', handler);
    return () => window.removeEventListener('cash-drawer-opened', handler);
  }, [lang]);

  // Keyboard shortcuts: F2 search, F4 AI Scan, F8 Hold, F9 Checkout / Drawer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'F4') {
        e.preventDefault();
        onOpenAIScanner();
      } else if (e.key === 'F8' && cart.length > 0) {
        e.preventDefault();
        submitSale('HELD');
      } else if (e.key === 'F9') {
        e.preventDefault();
        if (cart.length > 0) {
          submitSale('COMPLETED');
        } else {
          openCashDrawer('F9 Shortcut');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cart, grandTotal, effectiveTendered, effectivePaid, customerId, paymentMethod]);

  const submitSale = async (status: 'COMPLETED' | 'HELD') => {
    if (cart.length === 0) return;
    if (dueAmount > 0 && !customerId && status === 'COMPLETED') {
      setStatusMsg({ type: 'err', text: 'Select a customer to record Credit / Partial Due sales.' });
      return;
    }

    setSubmitting(true);
    setStatusMsg(null);
    const clientTxId = `pos-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const selectedCust = customers.find((c) => c.id === customerId);
    const payload = {
      client_tx_id: clientTxId,
      invoice_no: `${isOnline ? 'INV' : 'OFF'}-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`,
      customer_id: customerId || null,
      customer_name: selectedCust?.name || 'Walk-in Customer',
      customer_phone: selectedCust?.phone || '',
      status,
      subtotal,
      discount_type: discountType,
      discount_value: discountValue,
      discount_amount: discountAmount,
      vat_amount: vatAmount,
      total: grandTotal,
      tendered_amount: status === 'HELD' ? 0 : effectiveTendered,
      paid_amount: status === 'HELD' ? 0 : effectivePaid,
      due_amount: status === 'HELD' ? grandTotal : dueAmount,
      change_amount: status === 'HELD' ? 0 : changeAmount,
      payment_method: paymentMethod,
      payment_breakdown:
        paymentMethod === 'SPLIT' ? { cash: splitCash, digital: splitDigital } : { [paymentMethod]: effectivePaid },
      created_at: new Date().toISOString(),
      items: cart.map((it) => ({
        product_id: it.product.id,
        product_name: it.product.name,
        unit: it.unit,
        unit_multiplier: it.unit_multiplier,
        quantity: it.quantity,
        unit_price: it.unit_price,
        discount: it.discount,
        tax: 0,
        line_total: Number((it.quantity * it.unit_price - it.discount).toFixed(2)),
      })),
    };

    try {
      if (status === 'COMPLETED' && (paymentMethod === 'CASH' || (paymentMethod === 'SPLIT' && splitCash > 0))) {
        openCashDrawer('Cash Sale Completed');
      }

      let isSuccessOnline = false;
      let finalInvoiceNo = payload.invoice_no;
      let finalSaleId = -Date.now();

      if (isOnline) {
        try {
          const res = await apiFetch<{ saleId: number; invoice_no: string }>('/api/sales', {
            method: 'POST',
            body: JSON.stringify(payload),
            timeoutMs: 3500,
          });
          isSuccessOnline = true;
          finalInvoiceNo = res.invoice_no;
          finalSaleId = res.saleId;
          setStatusMsg({
            type: 'ok',
            text: status === 'HELD' ? `Sale held (${res.invoice_no})` : `Sale completed (${res.invoice_no})`,
          });
        } catch (netErr) {
          console.warn('Online sync failed, gracefully recording offline in IndexedDB:', netErr);
        }
      }

      if (!isSuccessOnline) {
        await queueOfflineOperation({
          id: clientTxId,
          type: 'SALE',
          payload,
          createdAt: new Date().toISOString(),
        });
        setStatusMsg({
          type: 'ok',
          text: status === 'HELD' ? `Saved offline (Held ${payload.invoice_no})` : `Saved offline (${payload.invoice_no}) — queued in IndexedDB for sync`,
        });
      }

      await onRefreshData();

      if (status === 'COMPLETED') {
        onPrintSale({
          ...(payload as unknown as Sale),
          id: finalSaleId,
          invoice_no: finalInvoiceNo,
          total: grandTotal,
          tendered_amount: effectiveTendered,
          paid_amount: effectivePaid,
          due_amount: dueAmount,
          change_amount: changeAmount,
          sale_type: 'POS',
          payment_breakdown_json: '{}',
          coupon_code: '',
          notes: isSuccessOnline ? '' : 'Offline receipt (pending sync)',
          synced_from_offline: isSuccessOnline ? 0 : 1,
        });
      }

      setCart([]);
      setDiscountValue(0);
      setPaidAmount('');
      setSplitCash(0);
      setSplitDigital(0);
    } catch (err) {
      setStatusMsg({ type: 'err', text: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleResumeHeld = async (sale: Sale) => {
    try {
      await apiFetch(`/api/sales/${sale.id}/resume`, {
        method: 'POST',
        body: JSON.stringify({ paid_amount: sale.total, payment_method: 'CASH' }),
      });
      setShowHeldModal(false);
      setStatusMsg({ type: 'ok', text: `Resumed & completed ${sale.invoice_no}` });
      await onRefreshData();
    } catch (err) {
      setStatusMsg({ type: 'err', text: (err as Error).message });
    }
  };

  const handleQuickAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ id: number }>('/api/customers', {
        method: 'POST',
        body: JSON.stringify({ name: newCustName, phone: newCustPhone }),
      });
      await onRefreshData();
      setCustomerId(res.id);
      setNewCustName('');
      setNewCustPhone('');
      setShowQuickCust(false);
    } catch (err) {
      setStatusMsg({ type: 'err', text: (err as Error).message });
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
      {/* Left: Catalog & Filters */}
      <div className="xl:col-span-7 space-y-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={t.searchProducts}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <button
              onClick={onOpenAIScanner}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-3.5 py-2 text-xs font-semibold hover:opacity-90 whitespace-nowrap shrink-0"
            >
              <Camera className="w-4 h-4" />
              AI Scan (F4)
            </button>

            {heldSales.length > 0 && (
              <button
                onClick={() => setShowHeldModal(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 px-3 py-2 text-xs font-medium whitespace-nowrap shrink-0"
              >
                <PlayCircle className="w-4 h-4" />
                Held ({heldSales.length})
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-xs"
            >
              <option value="ALL">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {lang === 'bn' ? c.name_bn : c.name}
                </option>
              ))}
            </select>

            <select
              value={brandFilter}
              onChange={(e) => setBrandFilter(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 text-xs"
            >
              <option value="ALL">All Brands</option>
              {brands.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5">
          {filteredProducts.map((p) => {
            const out = p.current_stock <= 0;
            const low = p.current_stock > 0 && p.current_stock <= p.min_stock_alert;
            return (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                className="text-left bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden hover:border-teal-600 transition-colors flex flex-col"
              >
                <ProductImage src={p.image_url} alt={p.name} category={p.category_name} className="w-full h-28" />
                <div className="p-3 flex-1 flex flex-col justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-white line-clamp-1">
                      {lang === 'bn' && p.name_bn ? p.name_bn : p.name}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {p.generic_name || p.brand || p.sku}
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800">
                    <span className="font-mono text-xs font-bold tabular-nums text-teal-700 dark:text-teal-400">
                      {formatBDT(p.retail_price)}
                    </span>
                    <span
                      className={`text-[11px] font-mono tabular-nums ${
                        out ? 'text-red-600' : low ? 'text-amber-600' : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {p.current_stock} {p.unit}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: Cart & Checkout */}
      <div className="xl:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4 sticky top-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 flex items-center gap-2">
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : '')}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs"
            >
              <option value="">{t.walkInCustomer}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.phone}) · Due: ৳{c.current_due}
                </option>
              ))}
            </select>
            <button
              onClick={() => setShowQuickCust(!showQuickCust)}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
              title="Add Customer"
            >
              <UserPlus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {showQuickCust && (
          <form onSubmit={handleQuickAddCustomer} className="grid grid-cols-3 gap-2 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <input
              required
              placeholder="Name"
              value={newCustName}
              onChange={(e) => setNewCustName(e.target.value)}
              className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
            />
            <input
              required
              placeholder="Phone"
              value={newCustPhone}
              onChange={(e) => setNewCustPhone(e.target.value)}
              className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
            />
            <button type="submit" className="rounded bg-teal-700 text-white text-xs font-medium px-2 py-1">
              Save
            </button>
          </form>
        )}

        {statusMsg && (
          <div
            className={`rounded-lg px-3 py-2 text-xs ${
              statusMsg.type === 'ok'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
            }`}
          >
            {statusMsg.text}
          </div>
        )}

        {/* Cart Items */}
        <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {cart.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">
              Cart is empty. Click a product or scan a barcode to start billing.
            </div>
          ) : (
            cart.map((item, idx) => (
              <div key={`${item.product.id}-${item.unit}`} className="py-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">{item.product.name}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <select
                      value={item.unit}
                      onChange={(e) => {
                        const nextUnit = e.target.value as CartItem['unit'];
                        const mult = getMultiplier(item.product, nextUnit);
                        setCart((prev) =>
                          prev.map((c, i) =>
                            i === idx
                              ? { ...c, unit: nextUnit, unit_multiplier: mult, unit_price: Number((item.product.retail_price * mult).toFixed(2)) }
                              : c
                          )
                        );
                      }}
                      className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-1.5 py-0.5 text-[11px]"
                    >
                      <option value="Piece">Piece</option>
                      <option value="Tablet">Tablet</option>
                      <option value="Strip">Strip (x{item.product.units_per_strip})</option>
                      <option value="Box">Box (x{item.product.units_per_strip * item.product.strips_per_box})</option>
                      <option value="Bottle">Bottle</option>
                    </select>
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums">@ {formatBDT(item.unit_price)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() =>
                      setCart((prev) =>
                        prev
                          .map((c, i) => (i === idx ? { ...c, quantity: c.quantity - 1 } : c))
                          .filter((c) => c.quantity > 0)
                      )
                    }
                    className="w-6 h-6 rounded border border-slate-200 dark:border-slate-700 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="w-7 text-center font-mono text-xs tabular-nums">{item.quantity}</span>
                  <button
                    onClick={() =>
                      setCart((prev) => prev.map((c, i) => (i === idx ? { ...c, quantity: c.quantity + 1 } : c)))
                    }
                    className="w-6 h-6 rounded border border-slate-200 dark:border-slate-700 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                  <div className="w-20 text-right font-mono text-xs font-semibold tabular-nums">
                    {formatBDT(item.quantity * item.unit_price)}
                  </div>
                  <button
                    onClick={() => setCart((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-slate-400 hover:text-red-600 p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Totals & Discounts */}
        <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-slate-500">{t.subtotal}</span>
            <span className="font-mono font-medium tabular-nums">{formatBDT(subtotal)}</span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">{t.discount}</span>
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as 'FIXED' | 'PERCENT')}
                className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-1.5 py-0.5 text-[11px]"
              >
                <option value="FIXED">৳</option>
                <option value="PERCENT">%</option>
              </select>
            </div>
            <input
              type="number"
              min={0}
              value={discountValue}
              onChange={(e) => setDiscountValue(Number(e.target.value))}
              className="w-24 text-right font-mono rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1 text-xs"
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500">{t.vat} (%)</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={vatPercent}
                onChange={(e) => setVatPercent(Number(e.target.value))}
                className="w-16 text-right font-mono rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1 text-xs"
              />
              <span className="font-mono w-20 text-right tabular-nums">{formatBDT(vatAmount)}</span>
            </div>
          </div>

          <div className="flex justify-between text-base font-bold pt-2 border-t border-slate-200 dark:border-slate-800">
            <span>{t.grandTotal}</span>
            <span className="font-mono text-teal-700 dark:text-teal-400 tabular-nums">{formatBDT(grandTotal)}</span>
          </div>
        </div>

        {/* Payment Method */}
        <div className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
          <div className="grid grid-cols-5 gap-1">
            {(
              [
                { k: 'CASH', l: 'Cash' },
                { k: 'CARD', l: 'Card' },
                { k: 'MOBILE_BANKING', l: 'bKash' },
                { k: 'SPLIT', l: 'Split' },
                { k: 'CREDIT', l: 'Due' },
              ] as const
            ).map((pm) => (
              <button
                key={pm.k}
                onClick={() => setPaymentMethod(pm.k)}
                className={`py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                  paymentMethod === pm.k
                    ? 'bg-teal-700 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                {pm.l}
              </button>
            ))}
          </div>

          {paymentMethod === 'SPLIT' ? (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <label className="text-[11px] text-slate-500">Cash (৳)</label>
                <input
                  type="number"
                  min={0}
                  value={splitCash}
                  onChange={(e) => setSplitCash(Number(e.target.value))}
                  className="w-full font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5"
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500">Card / Mobile (৳)</label>
                <input
                  type="number"
                  min={0}
                  value={splitDigital}
                  onChange={(e) => setSplitDigital(Number(e.target.value))}
                  className="w-full font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-slate-500 font-medium">
                  {lang === 'bn' ? 'কাস্টমার প্রদত্ত টাকা (৳)' : 'Customer Tendered (৳)'}
                </span>
                <input
                  type="number"
                  min={0}
                  placeholder={String(grandTotal)}
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      submitSale('COMPLETED');
                    }
                  }}
                  className="w-36 text-right font-mono text-sm font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              {/* Quick Cash Tender Denominations */}
              <div className="flex flex-wrap gap-1.5 justify-end">
                {[50, 100, 500, 1000].map((note) => (
                  <button
                    key={note}
                    type="button"
                    onClick={() => setPaidAmount(String(note))}
                    className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-[11px] font-mono font-semibold text-slate-700 dark:text-slate-300 transition-colors"
                  >
                    ৳{note}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPaidAmount(String(grandTotal))}
                  className="px-2 py-0.5 rounded bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 text-[11px] font-medium hover:bg-teal-100 transition-colors"
                >
                  {lang === 'bn' ? 'পুরো টাকা (Exact)' : 'Exact'}
                </button>
              </div>
            </div>
          )}

          {/* Automatic Change Return / Due Display Card */}
          {changeAmount > 0 && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">
                  {lang === 'bn' ? 'কাস্টমার ফেরত পাবে (Change Return):' : 'Change Return to Customer:'}
                </span>
                <span className="font-mono text-xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {formatBDT(changeAmount)}
                </span>
              </div>
              <div className="text-[11px] text-emerald-700 dark:text-emerald-300 flex justify-between pt-1 border-t border-emerald-200/60 dark:border-emerald-800/60">
                <span>{lang === 'bn' ? 'মোট বিল:' : 'Total:'} {formatBDT(grandTotal)}</span>
                <span>{lang === 'bn' ? 'প্রদত্ত:' : 'Tendered:'} {formatBDT(effectiveTendered)}</span>
                <span>{lang === 'bn' ? 'বাকি:' : 'Due:'} ৳০.০০</span>
              </div>
            </div>
          )}

          {dueAmount > 0 && (
            <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 flex justify-between items-center">
              <span className="text-xs font-semibold">
                {lang === 'bn' ? 'বকেয়া থাকবে (Balance Due):' : 'Balance Due:'}
              </span>
              <span className="font-mono text-base font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                {formatBDT(dueAmount)}
              </span>
            </div>
          )}

          {changeAmount === 0 && dueAmount === 0 && (
            <div className="flex justify-between text-xs font-mono tabular-nums text-slate-500">
              <span>{t.paidAmount}: {formatBDT(effectivePaid)}</span>
              <span className="text-emerald-600">{lang === 'bn' ? 'পরিশোধিত (Paid)' : 'Paid'}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 pt-1">
          <button
            type="button"
            onClick={() => openCashDrawer('Manual button')}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title={lang === 'bn' ? 'ক্যাশড্রয়ার খুলুন (F9 / Enter)' : 'Open Cash Drawer (F9 / Enter)'}
          >
            <Archive className="w-3.5 h-3.5 text-teal-600" />
            <span>{lang === 'bn' ? 'ক্যাশড্রয়ার' : 'Drawer'}</span>
          </button>
          <button
            disabled={cart.length === 0 || submitting}
            onClick={() => submitSale('HELD')}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <PauseCircle className="w-4 h-4" />
            {t.holdSale}
          </button>
          <button
            disabled={cart.length === 0 || submitting}
            onClick={() => submitSale('COMPLETED')}
            className="rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white py-2.5 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
          >
            {submitting ? '...' : (
              <>
                <span>{t.completeSale}</span>
                <span className="text-[10px] opacity-75 font-mono">(Enter)</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Cash Drawer Opened Notification Pill */}
      {drawerNotice && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-teal-800 text-white shadow-2xl px-4 py-2.5 text-xs font-semibold flex items-center gap-2 border border-teal-600 animate-pulse">
          <Archive className="w-4 h-4 text-teal-300" />
          <span>{drawerNotice}</span>
        </div>
      )}

      {/* Held Sales Modal */}
      {showHeldModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-semibold text-sm">Held Sales Queue</h3>
              <button onClick={() => setShowHeldModal(false)} className="text-xs text-slate-500">
                Close
              </button>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {heldSales.map((hs) => (
                <div
                  key={hs.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-slate-800"
                >
                  <div>
                    <div className="text-xs font-semibold">{hs.invoice_no}</div>
                    <div className="text-[11px] text-slate-500">
                      {hs.customer_name} · {formatBDT(hs.total)}
                    </div>
                  </div>
                  <button
                    onClick={() => handleResumeHeld(hs)}
                    className="px-3 py-1.5 rounded-lg bg-teal-700 text-white text-xs font-medium"
                  >
                    Resume & Pay
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
