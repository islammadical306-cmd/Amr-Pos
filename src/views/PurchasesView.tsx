import React, { useEffect, useState } from 'react';
import { Building2, Plus, RotateCcw, Search, Truck, Wallet } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatBDT, type Lang } from '../i18n';
import type { Product, Purchase, Supplier } from '../types';

interface PurchasesViewProps {
  lang: Lang;
  products: Product[];
  initialTab?: 'purchases' | 'suppliers';
  onRefreshCatalog: () => Promise<void>;
}

export const PurchasesView: React.FC<PurchasesViewProps> = ({
  lang,
  products,
  initialTab = 'purchases',
  onRefreshCatalog,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'purchases' | 'suppliers'>(initialTab);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [error, setError] = useState('');
  const [supplierSearch, setSupplierSearch] = useState('');

  // New purchase form
  const [supplierId, setSupplierId] = useState<string>('');
  const [additionalCharges, setAdditionalCharges] = useState<number>(0);
  const [paidAmount, setPaidAmount] = useState<string>('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Array<{ product_id: number; batch_number: string; expiry_date: string; quantity: number; unit_cost: number }>>([]);

  // Supplier form
  const [supName, setSupName] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supCompany, setSupCompany] = useState('');

  useEffect(() => {
    if (initialTab) {
      setActiveSubTab(initialTab);
    }
  }, [initialTab]);

  const loadData = async () => {
    try {
      const [s, p] = await Promise.all([apiFetch<Supplier[]>('/api/suppliers'), apiFetch<Purchase[]>('/api/purchases')]);
      setSuppliers(s);
      setPurchases(p);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const addLine = () => {
    if (!products.length) return;
    const first = products[0];
    setLines((prev) => [
      ...prev,
      {
        product_id: first.id,
        batch_number: `B-${Date.now().toString().slice(-4)}`,
        expiry_date: '',
        quantity: 10,
        unit_cost: first.purchase_price,
      },
    ]);
  };

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unit_cost, 0);
  const total = subtotal + Number(additionalCharges || 0);

  const handleCreatePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/api/purchases', {
        method: 'POST',
        body: JSON.stringify({
          supplier_id: supplierId ? Number(supplierId) : null,
          additional_charges: additionalCharges,
          paid_amount: paidAmount === '' ? total : Number(paidAmount),
          note,
          items: lines,
        }),
      });
      setLines([]);
      setAdditionalCharges(0);
      setPaidAmount('');
      setNote('');
      await Promise.all([loadData(), onRefreshCatalog()]);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/suppliers', { method: 'POST', body: JSON.stringify({ name: supName, phone: supPhone, company: supCompany }) });
      setSupName('');
      setSupPhone('');
      setSupCompany('');
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handlePaySupplier = async (sup: Supplier) => {
    const amt = Math.min(sup.total_due, sup.total_due);
    if (amt <= 0) return;
    try {
      await apiFetch(`/api/suppliers/${sup.id}/pay`, { method: 'POST', body: JSON.stringify({ amount: amt }) });
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handlePurchaseReturn = async (purchaseId: number, itemId: number) => {
    try {
      await apiFetch(`/api/purchases/${purchaseId}/return`, {
        method: 'POST',
        body: JSON.stringify({ purchase_item_id: itemId, return_qty: 1 }),
      });
      await Promise.all([loadData(), onRefreshCatalog()]);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const filteredSuppliers = suppliers.filter(
    (s) =>
      s.name.toLowerCase().includes(supplierSearch.toLowerCase()) ||
      (s.company && s.company.toLowerCase().includes(supplierSearch.toLowerCase())) ||
      (s.phone && s.phone.includes(supplierSearch))
  );

  const totalSupplierDues = suppliers.reduce((sum, s) => sum + Number(s.total_due || 0), 0);

  return (
    <div className="space-y-6">
      {/* Top Header Card with SubTab Switcher */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800 flex items-center justify-center text-teal-700 dark:text-teal-400">
            {activeSubTab === 'suppliers' ? <Building2 className="w-5 h-5" /> : <Truck className="w-5 h-5" />}
          </div>
          <div>
            <h1 className="font-display font-bold text-base text-slate-900 dark:text-white">
              {activeSubTab === 'suppliers'
                ? lang === 'bn'
                  ? 'সরবরাহকারী ম্যানেজমেন্ট ও দেনা-পাওনা'
                  : 'Suppliers Management & Payables'
                : lang === 'bn'
                ? 'ক্রয় / স্টক এন্ট্রি'
                : 'Purchases & Stock In'}
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {activeSubTab === 'suppliers'
                ? lang === 'bn'
                  ? 'সরবরাহকারীদের তালিকা, পাওনা বকেয়া ও বিল পরিশোধ হিসেব।'
                  : 'Manage suppliers directory, purchase payables, and balance settlements.'
                : lang === 'bn'
                ? 'নতুন মালামাল ক্রয় চালান এন্ট্রি করুন, ব্যাচ ও মেয়াদ ট্র্যাক করুন এবং স্টক বৃদ্ধি করুন।'
                : 'Record vendor purchase invoices with batch numbers, expiry dates, and automatic inventory updates.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={() => setActiveSubTab('purchases')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeSubTab === 'purchases'
                ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <Truck className="w-3.5 h-3.5" />
            <span>{lang === 'bn' ? 'ক্রয় / স্টক এন্ট্রি' : 'Purchases & Stock'}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('suppliers')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeSubTab === 'suppliers'
                ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>{lang === 'bn' ? 'সরবরাহকারী' : 'Suppliers'}</span>
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 p-3 text-xs text-red-700">{error}</div>}

      {/* VIEW 1: PURCHASES & STOCK IN */}
      {activeSubTab === 'purchases' && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* New Purchase Invoice Form */}
            <form onSubmit={handleCreatePurchase} className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display font-semibold text-sm flex items-center gap-2">
                  <Truck className="w-4 h-4 text-teal-700" />
                  {lang === 'bn' ? 'নতুন ক্রয় চালান (স্বয়ংক্রিয় স্টক আপডেট)' : 'New Purchase Invoice (Auto Stock Update)'}
                </h2>
                <button type="button" onClick={addLine} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-xs font-medium">
                  <Plus className="w-3.5 h-3.5" />
                  {lang === 'bn' ? 'আইটেম যোগ করুন' : 'Add Item'}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2">
                  <option value="">{lang === 'bn' ? 'সরবরাহকারী নির্বাচন করুন' : 'Select Supplier'}</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.company})</option>
                  ))}
                </select>
                <input placeholder={lang === 'bn' ? 'চালান নোট / মন্তব্য' : 'Invoice Note'} value={note} onChange={(e) => setNote(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto">
                {lines.map((ln, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 text-xs items-center p-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <select
                      value={ln.product_id}
                      onChange={(e) => {
                        const pid = Number(e.target.value);
                        const p = products.find((x) => x.id === pid);
                        setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, product_id: pid, unit_cost: p?.purchase_price || 0 } : x)));
                      }}
                      className="col-span-4 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5"
                    >
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <input
                      placeholder="Batch"
                      value={ln.batch_number}
                      onChange={(e) => setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, batch_number: e.target.value } : x)))}
                      className="col-span-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5"
                    />
                    <input
                      type="date"
                      value={ln.expiry_date}
                      onChange={(e) => setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, expiry_date: e.target.value } : x)))}
                      className="col-span-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5"
                    />
                    <input
                      type="number"
                      min={1}
                      placeholder="Qty"
                      value={ln.quantity}
                      onChange={(e) => setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, quantity: Number(e.target.value) } : x)))}
                      className="col-span-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 font-mono"
                    />
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Rate"
                      value={ln.unit_cost}
                      onChange={(e) => setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, unit_cost: Number(e.target.value) } : x)))}
                      className="col-span-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 font-mono"
                    />
                  </div>
                ))}
                {lines.length === 0 && (
                  <div className="text-xs text-slate-400 py-6 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
                    {lang === 'bn' ? '"আইটেম যোগ করুন" বাটনে ক্লিক করে পণ্য ও ক্রয়মূল্য এন্ট্রি করুন।' : 'Click "Add Item" to enter purchased stock & batch details.'}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3 text-xs pt-2 border-t border-slate-200 dark:border-slate-800">
                <div>
                  <label className="text-[11px] text-slate-500">{lang === 'bn' ? 'অতিরিক্ত খরচ (৳)' : 'Additional Charges (৳)'}</label>
                  <input type="number" min={0} value={additionalCharges} onChange={(e) => setAdditionalCharges(Number(e.target.value))} className="w-full font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5" />
                </div>
                <div>
                  <label className="text-[11px] text-slate-500">{lang === 'bn' ? 'পরিশোধিত টাকা (৳)' : 'Paid Amount (৳)'}</label>
                  <input type="number" min={0} placeholder={String(total)} value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} className="w-full font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5" />
                </div>
                <div className="flex flex-col justify-end text-right">
                  <div className="text-[11px] text-slate-500">{lang === 'bn' ? 'মোট ক্রয়মূল্য' : 'Total Purchase'}</div>
                  <div className="font-mono font-bold text-sm text-teal-700 dark:text-teal-400 tabular-nums">{formatBDT(total)}</div>
                </div>
              </div>

              <button disabled={!lines.length} type="submit" className="w-full py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-xs font-semibold shadow-md transition-colors">
                {lang === 'bn' ? 'ক্রয় চালান সংরক্ষণ করুন ও স্টক বৃদ্ধি করুন' : 'Save Purchase & Update Stock'}
              </button>
            </form>

            {/* Quick Supplier Payables Summary */}
            <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display font-semibold text-sm">{lang === 'bn' ? 'সরবরাহকারী সংক্ষেপ' : 'Suppliers & Dues'}</h3>
                <button
                  type="button"
                  onClick={() => setActiveSubTab('suppliers')}
                  className="text-xs text-teal-700 dark:text-teal-400 font-medium hover:underline"
                >
                  {lang === 'bn' ? 'সকল দেখুন →' : 'View all →'}
                </button>
              </div>

              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200">
                <div className="text-[11px] text-amber-700 dark:text-amber-400">{lang === 'bn' ? 'মোট সরবরাহকারী বাকি' : 'Total Supplier Payables'}</div>
                <div className="font-mono font-bold text-base text-amber-800 dark:text-amber-300 mt-1">
                  {formatBDT(totalSupplierDues)}
                </div>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-72 overflow-y-auto">
                {suppliers.slice(0, 6).map((s) => (
                  <div key={s.id} className="py-2.5 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-white">{s.name}</div>
                      <div className="text-[11px] text-slate-500">{s.company}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-amber-600 tabular-nums">{formatBDT(s.total_due)}</span>
                      {s.total_due > 0 && (
                        <button onClick={() => handlePaySupplier(s)} className="px-2 py-0.5 rounded bg-teal-700 text-white text-[10px]">
                          {lang === 'bn' ? 'পরিশোধ' : 'Pay'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Purchase History */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 font-display font-semibold text-sm">
              {lang === 'bn' ? 'পূর্ববর্তী মালামাল ক্রয়ের ইতিহাস' : 'Purchase History'}
            </div>
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-4">{lang === 'bn' ? 'চালান নং' : 'Invoice'}</th>
                  <th className="py-2.5 px-3">{lang === 'bn' ? 'সরবরাহকারী' : 'Supplier'}</th>
                  <th className="py-2.5 px-3 text-right">{lang === 'bn' ? 'মোট বিল' : 'Total'}</th>
                  <th className="py-2.5 px-3 text-right">{lang === 'bn' ? 'পরিশোধ' : 'Paid'}</th>
                  <th className="py-2.5 px-3 text-right">{lang === 'bn' ? 'বাকি' : 'Due'}</th>
                  <th className="py-2.5 px-4">{lang === 'bn' ? 'পণ্য ও রিটার্ন' : 'Items / Return'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {purchases.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2.5 px-4 font-mono font-medium">{p.invoice_no}</td>
                    <td className="py-2.5 px-3">{p.supplier_name || (lang === 'bn' ? 'সরাসরি ক্রয়' : 'Direct')}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatBDT(p.total)}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatBDT(p.paid_amount)}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-amber-600 tabular-nums">{formatBDT(p.due_amount)}</td>
                    <td className="py-2.5 px-4 space-y-1">
                      {p.items.map((it) => (
                        <div key={it.id} className="flex items-center justify-between gap-2 text-[11px]">
                          <span>{it.product_name} (x{it.quantity - it.returned_qty})</span>
                          {it.quantity - it.returned_qty > 0 && (
                            <button
                              onClick={() => handlePurchaseReturn(p.id, it.id)}
                              className="inline-flex items-center gap-1 text-red-600 hover:underline"
                            >
                              <RotateCcw className="w-3 h-3" /> {lang === 'bn' ? 'ফেরত ১' : 'Return 1'}
                            </button>
                          )}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
                {purchases.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-slate-400">
                      {lang === 'bn' ? 'কোনো ক্রয় রেকর্ড নেই।' : 'No purchase records found.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* VIEW 2: SUPPLIERS DIRECTORY */}
      {activeSubTab === 'suppliers' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Add Supplier Form */}
          <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm">
            <h3 className="font-display font-semibold text-sm text-slate-900 dark:text-white flex items-center gap-2">
              <Building2 className="w-4 h-4 text-teal-700" />
              <span>{lang === 'bn' ? 'নতুন সরবরাহকারী যোগ করুন' : 'Add New Supplier'}</span>
            </h3>
            <form onSubmit={handleAddSupplier} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">
                  {lang === 'bn' ? 'সরবরাহকারীর নাম *' : 'Supplier Name *'}
                </label>
                <input
                  required
                  placeholder={lang === 'bn' ? 'যেমন: মেসার্স রহিম ট্রেডার্স' : 'Name'}
                  value={supName}
                  onChange={(e) => setSupName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2"
                />
              </div>

              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">
                  {lang === 'bn' ? 'কোম্পানি / প্রতিষ্ঠান' : 'Company'}
                </label>
                <input
                  placeholder={lang === 'bn' ? 'যেমন: স্কয়ার ফার্মাসিউটিক্যালস' : 'Company'}
                  value={supCompany}
                  onChange={(e) => setSupCompany(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2"
                />
              </div>

              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">
                  {lang === 'bn' ? 'মোবাইল নম্বর' : 'Phone'}
                </label>
                <input
                  placeholder="017xxxxxxxx"
                  value={supPhone}
                  onChange={(e) => setSupPhone(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 font-mono"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-semibold shadow-md transition-colors"
              >
                {lang === 'bn' ? 'সরবরাহকারী সংরক্ষণ করুন' : 'Save Supplier'}
              </button>
            </form>
          </div>

          {/* Suppliers Table & Payables */}
          <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm flex flex-col">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={supplierSearch}
                  onChange={(e) => setSupplierSearch(e.target.value)}
                  placeholder={lang === 'bn' ? 'সরবরাহকারীর নাম বা ফোন দিয়ে খুঁজুন...' : 'Search supplier...'}
                  className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div className="text-xs font-mono px-3 py-1 bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 rounded-lg">
                {lang === 'bn' ? `মোট পাওনা: ${formatBDT(totalSupplierDues)}` : `Total Due: ${formatBDT(totalSupplierDues)}`}
              </div>
            </div>

            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-3 px-4">{lang === 'bn' ? 'সরবরাহকারী' : 'Supplier'}</th>
                    <th className="py-3 px-3">{lang === 'bn' ? 'কোম্পানি' : 'Company'}</th>
                    <th className="py-3 px-3">{lang === 'bn' ? 'ফোন নম্বর' : 'Phone'}</th>
                    <th className="py-3 px-3 text-right">{lang === 'bn' ? 'বকেয়া পাওনা' : 'Total Due'}</th>
                    <th className="py-3 px-4 text-center">{lang === 'bn' ? 'অ্যাকশন' : 'Action'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {filteredSuppliers.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">{s.name}</td>
                      <td className="py-3 px-3 text-slate-600 dark:text-slate-300">{s.company || '—'}</td>
                      <td className="py-3 px-3 font-mono text-slate-500">{s.phone || '—'}</td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-amber-600 tabular-nums">
                        {formatBDT(s.total_due)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {s.total_due > 0 ? (
                          <button
                            type="button"
                            onClick={() => handlePaySupplier(s)}
                            className="px-3 py-1 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold shadow-sm transition-colors"
                          >
                            {lang === 'bn' ? 'বিল পরিশোধ' : 'Settle'}
                          </button>
                        ) : (
                          <span className="text-slate-400 text-[11px]">{lang === 'bn' ? 'পরিশোধিত' : 'Cleared'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredSuppliers.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center py-10 text-xs text-slate-400">
                        {lang === 'bn' ? 'কোনো সরবরাহকারী পাওয়া যায়নি।' : 'No suppliers found.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
