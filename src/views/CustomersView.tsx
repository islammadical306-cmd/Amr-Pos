import React, { useState } from 'react';
import { FileText, Search, UserPlus } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatBDT, type Lang } from '../i18n';
import type { Customer } from '../types';

interface CustomersViewProps {
  lang: Lang;
  customers: Customer[];
  onRefresh: () => Promise<void>;
}

export const CustomersView: React.FC<CustomersViewProps> = ({ customers, onRefresh }) => {
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [ledger, setLedger] = useState<{ customer: Customer; sales: Array<Record<string, unknown>>; payments: Array<Record<string, unknown>> } | null>(null);
  const [error, setError] = useState('');

  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search) ||
      c.code.toLowerCase().includes(search.toLowerCase())
  );

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/api/customers', { method: 'POST', body: JSON.stringify({ name, phone, address }) });
      setName('');
      setPhone('');
      setAddress('');
      await onRefresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const toggleConsent = async (c: Customer, field: 'opt_out_marketing' | 'consent_sms' | 'consent_whatsapp') => {
    try {
      await apiFetch(`/api/customers/${c.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...c,
          [field]: c[field] ? 0 : 1,
        }),
      });
      await onRefresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const openLedger = async (id: number) => {
    try {
      const data = await apiFetch<typeof ledger>(`/api/customers/${id}/ledger`);
      setLedger(data);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <h2 className="font-display font-semibold text-sm flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-teal-700" />
          Add Customer Profile
        </h2>
        {error && <div className="text-xs text-red-600">{error}</div>}
        <form onSubmit={handleAdd} className="space-y-3 text-xs">
          <input required placeholder="Customer Name *" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
          <input required placeholder="Mobile Number (+880...) *" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
          <input placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
          <button type="submit" className="w-full py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold">
            Save Customer
          </button>
        </form>
      </div>

      <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <h3 className="font-display font-semibold text-sm">Customer Directory ({filtered.length})</h3>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or phone..." className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 pl-8 pr-3 py-1.5 text-xs" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-2.5 px-4">Customer</th>
                <th className="py-2.5 px-3 text-right">Purchases</th>
                <th className="py-2.5 px-3 text-right">Paid</th>
                <th className="py-2.5 px-3 text-right">Current Due</th>
                <th className="py-2.5 px-3">Consent</th>
                <th className="py-2.5 px-4 text-right">Statement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td className="py-2.5 px-4">
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-[11px] text-slate-500 font-mono">{c.code} · {c.phone}</div>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatBDT(c.total_purchases)}</td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatBDT(c.total_payments)}</td>
                  <td className={`py-2.5 px-3 text-right font-mono font-semibold tabular-nums ${c.current_due > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {formatBDT(c.current_due)}
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <button onClick={() => toggleConsent(c, 'consent_sms')} className={`px-2 py-0.5 rounded border ${c.consent_sms ? 'border-teal-600 text-teal-700' : 'border-slate-300 text-slate-400'}`}>
                        SMS
                      </button>
                      <button onClick={() => toggleConsent(c, 'consent_whatsapp')} className={`px-2 py-0.5 rounded border ${c.consent_whatsapp ? 'border-emerald-600 text-emerald-700' : 'border-slate-300 text-slate-400'}`}>
                        WA
                      </button>
                      <button onClick={() => toggleConsent(c, 'opt_out_marketing')} className={`px-2 py-0.5 rounded border ${c.opt_out_marketing ? 'border-red-500 text-red-600' : 'border-slate-300 text-slate-500'}`}>
                        {c.opt_out_marketing ? 'Opted-Out' : 'Promo OK'}
                      </button>
                    </div>
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <button onClick={() => openLedger(c.id)} className="inline-flex items-center gap-1 text-teal-700 dark:text-teal-400 font-medium hover:underline">
                      <FileText className="w-3.5 h-3.5" /> Ledger
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Customer Ledger Modal */}
      {ledger && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-display font-bold text-base">{ledger.customer.name} · Statement</h3>
                <div className="text-xs text-slate-500">{ledger.customer.code} · {ledger.customer.phone} · Due: {formatBDT(ledger.customer.current_due)}</div>
              </div>
              <button onClick={() => setLedger(null)} className="text-xs px-3 py-1 rounded border">Close</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <h4 className="font-semibold mb-2">Invoices</h4>
                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {ledger.sales.map((s) => (
                    <div key={String(s.id)} className="p-2 rounded border border-slate-200 dark:border-slate-800 flex justify-between">
                      <div>
                        <div className="font-mono font-medium">{String(s.invoice_no)}</div>
                        <div className="text-[11px] text-slate-500">{String(s.created_at).slice(0, 10)}</div>
                      </div>
                      <div className="text-right font-mono">
                        <div>{formatBDT(Number(s.total))}</div>
                        {Number(s.due_amount) > 0 && <div className="text-amber-600 text-[11px]">Due {formatBDT(Number(s.due_amount))}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="font-semibold mb-2">Due Payment History</h4>
                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {ledger.payments.map((p) => (
                    <div key={String(p.id)} className="p-2 rounded border border-slate-200 dark:border-slate-800 flex justify-between">
                      <div>
                        <div className="font-mono font-medium">{String(p.receipt_no)}</div>
                        <div className="text-[11px] text-slate-500">{String(p.payment_method)}</div>
                      </div>
                      <div className="font-mono font-semibold text-emerald-600">{formatBDT(Number(p.amount))}</div>
                    </div>
                  ))}
                  {!ledger.payments.length && <div className="text-slate-400">No due payments recorded yet.</div>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
