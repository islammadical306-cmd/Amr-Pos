import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Edit2, History, PackagePlus, QrCode, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatBDT, type Lang } from '../i18n';
import type { AuthUser, Category, Product } from '../types';

interface InventoryViewProps {
  lang: Lang;
  user: AuthUser;
  products: Product[];
  categories: Category[];
  onRefresh: () => Promise<void>;
}

export const InventoryView: React.FC<InventoryViewProps> = ({ lang, user, products, categories, onRefresh }) => {
  const [tab, setTab] = useState<'catalog' | 'batches' | 'movements' | 'categories'>('catalog');
  const [search, setSearch] = useState('');
  const [movements, setMovements] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState('');

  const [showProdModal, setShowProdModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({
    name: '',
    name_bn: '',
    sku: '',
    barcode: '',
    category_id: '',
    brand: '',
    manufacturer: '',
    generic_name: '',
    strength: '',
    dosage_form: '',
    package_size: '',
    unit: 'Piece',
    units_per_strip: 1,
    strips_per_box: 1,
    purchase_price: 0,
    wholesale_price: 0,
    retail_price: 0,
    min_selling_price: 0,
    vat_percent: 0,
    min_stock_alert: 10,
    opening_stock: 0,
    batch_number: '',
    expiry_date: '',
    show_online: true,
    online_price: 0,
    description: '',
  });

  const [stockModal, setStockModal] = useState<Product | null>(null);
  const [stockType, setStockType] = useState<'STOCK_IN' | 'STOCK_OUT' | 'ADJUSTMENT' | 'DAMAGED'>('STOCK_IN');
  const [stockQty, setStockQty] = useState(1);
  const [stockBatch, setStockBatch] = useState('');
  const [stockExpiry, setStockExpiry] = useState('');
  const [stockNote, setStockNote] = useState('');

  const [qrModal, setQrModal] = useState<{ prod: Product; url: string } | null>(null);
  const [catName, setCatName] = useState('');
  const [catNameBn, setCatNameBn] = useState('');

  const canEdit = user.permissions.includes('edit_products');
  const canDelete = user.permissions.includes('delete_products');
  const canStock = user.permissions.includes('manage_stock');

  useEffect(() => {
    if (tab === 'movements') {
      apiFetch<Array<Record<string, unknown>>>('/api/stock-movements')
        .then(setMovements)
        .catch((e) => setError(e.message));
    }
  }, [tab]);

  const filtered = products.filter((p) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      (p.barcode || '').toLowerCase().includes(q) ||
      (p.generic_name || '').toLowerCase().includes(q) ||
      (p.brand || '').toLowerCase().includes(q)
    );
  });

  const openAdd = () => {
    setEditingId(null);
    setForm({
      name: '', name_bn: '', sku: `SKU-${Date.now().toString().slice(-5)}`, barcode: '', category_id: '',
      brand: '', manufacturer: '', generic_name: '', strength: '', dosage_form: '', package_size: '',
      unit: 'Piece', units_per_strip: 1, strips_per_box: 1, purchase_price: 0, wholesale_price: 0,
      retail_price: 0, min_selling_price: 0, vat_percent: 0, min_stock_alert: 10, opening_stock: 0,
      batch_number: '', expiry_date: '', show_online: true, online_price: 0, description: '',
    });
    setShowProdModal(true);
  };

  const openEdit = (p: Product) => {
    setEditingId(p.id);
    setForm({
      name: p.name, name_bn: p.name_bn || '', sku: p.sku, barcode: p.barcode || '',
      category_id: p.category_id ? String(p.category_id) : '', brand: p.brand || '',
      manufacturer: p.manufacturer || '', generic_name: p.generic_name || '', strength: p.strength || '',
      dosage_form: p.dosage_form || '', package_size: p.package_size || '', unit: p.unit || 'Piece',
      units_per_strip: p.units_per_strip || 1, strips_per_box: p.strips_per_box || 1,
      purchase_price: p.purchase_price, wholesale_price: p.wholesale_price, retail_price: p.retail_price,
      min_selling_price: p.min_selling_price, vat_percent: p.vat_percent, min_stock_alert: p.min_stock_alert,
      opening_stock: 0, batch_number: '', expiry_date: '', show_online: Boolean(p.show_online),
      online_price: p.online_price || p.retail_price, description: p.description || '',
    });
    setShowProdModal(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const payload = { ...form, category_id: form.category_id ? Number(form.category_id) : null };
      if (editingId) {
        await apiFetch(`/api/products/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/api/products', { method: 'POST', body: JSON.stringify(payload) });
      }
      setShowProdModal(false);
      await onRefresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await apiFetch(`/api/products/${id}`, { method: 'DELETE' });
      await onRefresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleStockAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockModal) return;
    try {
      await apiFetch(`/api/products/${stockModal.id}/stock-adjustment`, {
        method: 'POST',
        body: JSON.stringify({
          type: stockType,
          quantity: stockQty,
          batch_number: stockBatch,
          expiry_date: stockExpiry,
          note: stockNote,
        }),
      });
      setStockModal(null);
      setStockQty(1);
      setStockNote('');
      await onRefresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const showQR = async (p: Product) => {
    const url = await QRCode.toDataURL(JSON.stringify({ sku: p.sku, barcode: p.barcode, name: p.name }), { width: 220 });
    setQrModal({ prod: p, url });
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/categories', { method: 'POST', body: JSON.stringify({ name: catName, name_bn: catNameBn }) });
      setCatName('');
      setCatNameBn('');
      await onRefresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
          {(
            [
              { id: 'catalog', label: lang === 'bn' ? 'পণ্য তালিকা' : 'Product Catalog' },
              { id: 'batches', label: lang === 'bn' ? 'ব্যাচ ও মেয়াদ (FEFO)' : 'Batches & Expiry' },
              { id: 'movements', label: lang === 'bn' ? 'স্টক হিস্ট্রি' : 'Stock Movements' },
              { id: 'categories', label: lang === 'bn' ? 'ক্যাটাগরি' : 'Categories' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                tab === t.id ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter SKU, name, generic..."
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 pl-8 pr-3 py-1.5 text-xs"
            />
          </div>
          {canEdit && (
            <button
              onClick={openAdd}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0"
            >
              <PackagePlus className="w-3.5 h-3.5" />
              Add Product
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {tab === 'catalog' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-500">
              <tr>
                <th className="py-3 px-4 font-semibold">Product / Generic</th>
                <th className="py-3 px-3 font-semibold">SKU / Barcode</th>
                <th className="py-3 px-3 font-semibold text-right">Buy Price</th>
                <th className="py-3 px-3 font-semibold text-right">Retail Price</th>
                <th className="py-3 px-3 font-semibold text-right">Stock</th>
                <th className="py-3 px-3 font-semibold">Online</th>
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((p) => {
                const low = p.current_stock > 0 && p.current_stock <= p.min_stock_alert;
                const out = p.current_stock <= 0;
                return (
                  <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-2.5 px-4">
                      <div className="font-semibold text-slate-900 dark:text-white">{p.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {p.generic_name ? `${p.generic_name} · ` : ''}{p.brand || p.category_name || 'Retail'}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px]">
                      <div>{p.sku}</div>
                      <div className="text-slate-400">{p.barcode || '—'}</div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatBDT(p.purchase_price)}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold tabular-nums">{formatBDT(p.retail_price)}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      <span className={out ? 'text-red-600 font-bold' : low ? 'text-amber-600 font-semibold' : ''}>
                        {p.current_stock} {p.unit}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-[11px]">{p.show_online ? 'Visible' : 'POS Only'}</td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button onClick={() => showQR(p)} className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800" title="QR Code">
                          <QrCode className="w-3.5 h-3.5" />
                        </button>
                        {canStock && (
                          <button
                            onClick={() => {
                              setStockModal(p);
                              setStockType('STOCK_IN');
                            }}
                            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-teal-700 dark:text-teal-400"
                            title="Stock Adjustment"
                          >
                            <SlidersHorizontal className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canEdit && (
                          <button onClick={() => openEdit(p)} className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800" title="Edit">
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button onClick={() => handleDelete(p.id)} className="p-1.5 rounded hover:bg-red-50 text-red-600" title="Delete">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'batches' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-500">
              <tr>
                <th className="py-3 px-4">Product</th>
                <th className="py-3 px-3">Batch No.</th>
                <th className="py-3 px-3">Expiry Date (FEFO Order)</th>
                <th className="py-3 px-3 text-right">Remaining Qty</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.flatMap((p) =>
                (p.batches || []).map((b) => {
                  const daysLeft = b.expiry_date ? Math.ceil((new Date(b.expiry_date).getTime() - Date.now()) / 86400000) : null;
                  const status =
                    daysLeft === null
                      ? 'No Expiry'
                      : daysLeft < 0
                        ? 'Expired'
                        : daysLeft <= 60
                          ? `Near Expiry (${daysLeft}d)`
                          : 'Valid';
                  return (
                    <tr key={b.id}>
                      <td className="py-2.5 px-4 font-medium">{p.name}</td>
                      <td className="py-2.5 px-3 font-mono">{b.batch_number}</td>
                      <td className="py-2.5 px-3 font-mono">{b.expiry_date || '—'}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{b.quantity}</td>
                      <td className={`py-2.5 px-4 font-medium ${daysLeft !== null && daysLeft < 0 ? 'text-red-600' : daysLeft !== null && daysLeft <= 60 ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {status}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'movements' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-500">
              <tr>
                <th className="py-3 px-4">Time</th>
                <th className="py-3 px-3">Product</th>
                <th className="py-3 px-3">Type</th>
                <th className="py-3 px-3 text-right">Delta</th>
                <th className="py-3 px-3 text-right">Prev → New</th>
                <th className="py-3 px-4">Reference / Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {movements.map((m) => (
                <tr key={String(m.id)}>
                  <td className="py-2 px-4 font-mono text-[11px] text-slate-500">{String(m.created_at)}</td>
                  <td className="py-2 px-3 font-medium">{String(m.product_name)}</td>
                  <td className="py-2 px-3 font-mono text-[11px]">{String(m.type)}</td>
                  <td className={`py-2 px-3 text-right font-mono tabular-nums ${Number(m.quantity_delta) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {Number(m.quantity_delta) >= 0 ? `+${m.quantity_delta}` : String(m.quantity_delta)}
                  </td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums">
                    {String(m.previous_qty)} → {String(m.new_qty)}
                  </td>
                  <td className="py-2 px-4 text-slate-500">{String(m.reference_id || m.note || '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'categories' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <form onSubmit={handleAddCategory} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
            <h3 className="font-display font-semibold text-sm">Add Category</h3>
            <input
              required
              placeholder="Category Name (English)"
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs"
            />
            <input
              placeholder="Category Name (বাংলা)"
              value={catNameBn}
              onChange={(e) => setCatNameBn(e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs"
            />
            <button type="submit" className="px-4 py-2 rounded-lg bg-teal-700 text-white text-xs font-semibold">
              Save Category
            </button>
          </form>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-2">
            <h3 className="font-display font-semibold text-sm mb-2">Existing Categories</h3>
            {categories.map((c) => (
              <div key={c.id} className="flex justify-between py-2 border-b border-slate-100 dark:border-slate-800 text-xs">
                <span className="font-medium">{c.name}</span>
                <span className="text-slate-500">{c.name_bn}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add/Edit Product Modal */}
      {showProdModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveProduct}
            className="w-full max-w-2xl rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4 my-8"
          >
            <h3 className="font-display font-semibold text-base">{editingId ? 'Edit Product' : 'Add New Product'}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="sm:col-span-2">
                <label className="block text-[11px] text-slate-500 mb-1">Product Name *</label>
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Name (Bangla)</label>
                <input value={form.name_bn} onChange={(e) => setForm({ ...form, name_bn: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">SKU *</label>
                <input required value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Barcode</label>
                <input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Category</label>
                <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2">
                  <option value="">Select</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Brand</label>
                <input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Generic Medicine Name</label>
                <input value={form.generic_name} onChange={(e) => setForm({ ...form, generic_name: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Strength / Dosage Form</label>
                <input placeholder="e.g. 500mg Tablet" value={form.strength} onChange={(e) => setForm({ ...form, strength: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Base Unit</label>
                <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2">
                  <option value="Piece">Piece</option>
                  <option value="Tablet">Tablet</option>
                  <option value="Strip">Strip</option>
                  <option value="Box">Box</option>
                  <option value="Bottle">Bottle</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Tabs per Strip</label>
                <input type="number" min={1} value={form.units_per_strip} onChange={(e) => setForm({ ...form, units_per_strip: Number(e.target.value) })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Strips per Box</label>
                <input type="number" min={1} value={form.strips_per_box} onChange={(e) => setForm({ ...form, strips_per_box: Number(e.target.value) })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Purchase Price (৳)</label>
                <input type="number" step="0.01" value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: Number(e.target.value) })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Retail Price (৳)</label>
                <input type="number" step="0.01" value={form.retail_price} onChange={(e) => setForm({ ...form, retail_price: Number(e.target.value) })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Online Price (৳)</label>
                <input type="number" step="0.01" value={form.online_price} onChange={(e) => setForm({ ...form, online_price: Number(e.target.value) })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
              </div>

              {!editingId && (
                <>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Opening Stock</label>
                    <input type="number" min={0} value={form.opening_stock} onChange={(e) => setForm({ ...form, opening_stock: Number(e.target.value) })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Batch Number</label>
                    <input value={form.batch_number} onChange={(e) => setForm({ ...form, batch_number: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">Expiry Date</label>
                    <input type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
                  </div>
                </>
              )}

              <div className="sm:col-span-3 flex items-center gap-2 pt-1">
                <input type="checkbox" checked={form.show_online} onChange={(e) => setForm({ ...form, show_online: e.target.checked })} />
                <span>Show product on connected E-Commerce storefront</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowProdModal(false)} className="px-4 py-2 rounded-lg border text-xs">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-teal-700 text-white text-xs font-semibold">Save Product</button>
            </div>
          </form>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {stockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={handleStockAdjust} className="w-full max-w-md rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3 text-xs">
            <h3 className="font-display font-semibold text-sm flex items-center gap-2">
              <History className="w-4 h-4 text-teal-700" />
              Stock Adjustment · {stockModal.name}
            </h3>
            <select value={stockType} onChange={(e) => setStockType(e.target.value as typeof stockType)} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2">
              <option value="STOCK_IN">Stock In (+)</option>
              <option value="STOCK_OUT">Stock Out (-)</option>
              <option value="DAMAGED">Damaged / Expired Write-off (-)</option>
              <option value="ADJUSTMENT">Audit Adjustment (-)</option>
            </select>
            <input type="number" min={1} required value={stockQty} onChange={(e) => setStockQty(Number(e.target.value))} placeholder="Quantity" className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
            {stockType === 'STOCK_IN' && (
              <div className="grid grid-cols-2 gap-2">
                <input placeholder="Batch Number" value={stockBatch} onChange={(e) => setStockBatch(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
                <input type="date" value={stockExpiry} onChange={(e) => setStockExpiry(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
              </div>
            )}
            <input placeholder="Reason / Audit Note" value={stockNote} onChange={(e) => setStockNote(e.target.value)} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setStockModal(null)} className="px-3.5 py-2 rounded-lg border">Cancel</button>
              <button type="submit" className="px-3.5 py-2 rounded-lg bg-teal-700 text-white font-semibold">Record Movement</button>
            </div>
          </form>
        </div>
      )}

      {/* QR Code Modal */}
      {qrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 text-center space-y-3">
            <h3 className="font-display font-semibold text-sm">{qrModal.prod.name}</h3>
            <img src={qrModal.url} alt="Product QR" className="w-44 h-44 mx-auto rounded border border-slate-200" />
            <div className="text-xs font-mono text-slate-500">SKU: {qrModal.prod.sku}</div>
            <button onClick={() => setQrModal(null)} className="w-full py-2 rounded-lg bg-slate-900 text-white text-xs font-medium">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
