import React, { useEffect, useState } from 'react';
import { Plus, RotateCcw, Truck } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatBDT, type Lang } from '../i18n';
import type { Product, Purchase, Supplier } from '../types';

interface PurchasesViewProps {
  lang: Lang;
  products: Product[];
  onRefreshCatalog: () => Promise<void>;
}

export const PurchasesView: React.FC<PurchasesViewProps> = ({ products, onRefreshCatalog }) => {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [error, setError] = useState('');

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

  return (
    <div className="space-y-6">
      {error && <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 p-3 text-xs text-red-700">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* New Purchase Invoice */}
        <form onSubmit={handleCreatePurchase} className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-semibold text-sm flex items-center gap-2">
              <Truck className="w-4 h-4 text-teal-700" />
              New Purchase Invoice (Auto Stock Update)
            </h2>
            <button type="button" onClick={addLine} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-xs font-medium">
              <Plus className="w-3.5 h-3.5" />
              Add Item
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2">
              <option value="">Select Supplier</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.company})</option>
              ))}
            </select>
            <input placeholder="Invoice Note" value={note} onChange={(e) => setNote(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
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
                  value={ln.quantity}
                  onChange={(e) => setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, quantity: Number(e.target.value) } : x)))}
                  className="col-span-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 font-mono"
                />
                <input
                  type="number"
                  step="0.01"
                  value={ln.unit_cost}
                  onChange={(e) => setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, unit_cost: Number(e.target.value) } : x)))}
                  className="col-span-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 font-mono"
                />
              </div>
            ))}
            {lines.length === 0 && <div className="text-xs text-slate-400 py-4 text-center">Click "Add Item" to enter purchased stock & batch details.</div>}
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs pt-2 border-t border-slate-200 dark:border-slate-800">
            <div>
              <label className="text-[11px] text-slate-500">Additional Charges (৳)</label>
              <input type="number" min={0} value={additionalCharges} onChange={(e) => setAdditionalCharges(Number(e.target.value))} className="w-full font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5" />
            </div>
            <div>
              <label className="text-[11px] text-slate-500">Paid Amount (৳)</label>
              <input type="number" min={0} placeholder={String(total)} value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} className="w-full font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5" />
            </div>
            <div className="flex flex-col justify-end text-right">
              <div className="text-[11px] text-slate-500">Total Purchase</div>
              <div className="font-mono font-bold text-sm text-teal-700 dark:text-teal-400 tabular-nums">{formatBDT(total)}</div>
            </div>
          </div>

          <button disabled={!lines.length} type="submit" className="w-full py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-xs font-semibold">
            Save Purchase & Update Stock
          </button>
        </form>

        {/* Suppliers */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <h3 className="font-display font-semibold text-sm">Suppliers & Dues</h3>
          <form onSubmit={handleAddSupplier} className="grid grid-cols-3 gap-2 text-xs">
            <input required placeholder="Name" value={supName} onChange={(e) => setSupName(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5" />
            <input placeholder="Company" value={supCompany} onChange={(e) => setSupCompany(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5" />
            <input placeholder="Phone" value={supPhone} onChange={(e) => setSupPhone(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5" />
            <button type="submit" className="col-span-3 py-1.5 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-medium">
              Add Supplier
            </button>
          </form>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-64 overflow-y-auto">
            {suppliers.map((s) => (
              <div key={s.id} className="py-2.5 flex items-center justify-between text-xs">
                <div>
                  <div className="font-semibold">{s.name}</div>
                  <div className="text-[11px] text-slate-500">{s.company} · {s.phone}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-amber-600 tabular-nums">{formatBDT(s.total_due)}</span>
                  {s.total_due > 0 && (
                    <button onClick={() => handlePaySupplier(s)} className="px-2.5 py-1 rounded bg-teal-700 text-white text-[11px]">
                      Settle
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
          Purchase History
        </div>
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="py-2.5 px-4">Invoice</th>
              <th className="py-2.5 px-3">Supplier</th>
              <th className="py-2.5 px-3 text-right">Total</th>
              <th className="py-2.5 px-3 text-right">Paid</th>
              <th className="py-2.5 px-3 text-right">Due</th>
              <th className="py-2.5 px-4">Items / Return</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {purchases.map((p) => (
              <tr key={p.id}>
                <td className="py-2.5 px-4 font-mono font-medium">{p.invoice_no}</td>
                <td className="py-2.5 px-3">{p.supplier_name || 'Direct'}</td>
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
                          <RotateCcw className="w-3 h-3" /> Return 1
                        </button>
                      )}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
