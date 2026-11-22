import React, { useState } from 'react';
import { Edit2, FileText, Search, Trash2, UserPlus, X } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatBDT, type Lang } from '../i18n';
import type { Customer } from '../types';

interface CustomersViewProps {
  lang: Lang;
  customers: Customer[];
  onRefresh: () => Promise<void>;
}

export const CustomersView: React.FC<CustomersViewProps> = ({ lang, customers, onRefresh }) => {
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [ledger, setLedger] = useState<{ customer: Customer; sales: Array<Record<string, unknown>>; payments: Array<Record<string, unknown>> } | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search) ||
      c.code.toLowerCase().includes(search.toLowerCase())
  );

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    try {
      await apiFetch('/api/customers', { method: 'POST', body: JSON.stringify({ name: name.trim(), phone: phone.trim(), address: address.trim() }) });
      setName('');
      setPhone('');
      setAddress('');
      setSuccessMsg(lang === 'bn' ? '✓ নতুন কাস্টমার সফলভাবে যুক্ত হয়েছে!' : '✓ Customer added successfully!');
      await onRefresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const startEdit = (c: Customer) => {
    setEditingCustomer(c);
    setEditName(c.name);
    setEditPhone(c.phone);
    setEditAddress(c.address || '');
    setEditEmail(c.email || '');
    setError('');
    setSuccessMsg('');
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer) return;
    setError('');
    setSuccessMsg('');
    try {
      await apiFetch(`/api/customers/${editingCustomer.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...editingCustomer,
          name: editName.trim(),
          phone: editPhone.trim(),
          address: editAddress.trim(),
          email: editEmail.trim(),
        }),
      });
      setEditingCustomer(null);
      setSuccessMsg(lang === 'bn' ? '✓ কাস্টমারের তথ্য সফলভাবে সংশোধন করা হয়েছে!' : '✓ Customer updated successfully!');
      await onRefresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDelete = async (c: Customer) => {
    const confirmPrompt = lang === 'bn'
      ? `আপনি কি নিশ্চিত যে কাস্টমার "${c.name}" (${c.phone}) কে মুছে ফেলতে চান?`
      : `Are you sure you want to permanently delete customer "${c.name}"?`;
    if (!window.confirm(confirmPrompt)) return;
    setError('');
    setSuccessMsg('');
    try {
      await apiFetch(`/api/customers/${c.id}`, { method: 'DELETE' });
      setSuccessMsg(lang === 'bn' ? '✓ কাস্টমার সফলভাবে মুছে ফেলা হয়েছে।' : '✓ Customer deleted successfully.');
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
    <div className="space-y-4">
      {error && (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-600 hover:opacity-75">✕</button>
        </div>
      )}
      {successMsg && (
        <div className="p-3 rounded-xl bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 text-xs text-teal-800 dark:text-teal-200 flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg('')} className="text-teal-600 hover:opacity-75">✕</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Add Customer Form */}
        <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-sm">
          <h2 className="font-display font-semibold text-sm flex items-center gap-2 text-slate-900 dark:text-white">
            <UserPlus className="w-4 h-4 text-teal-700" />
            {lang === 'bn' ? 'নতুন কাস্টমার প্রোফাইল যুক্ত করুন' : 'Add Customer Profile'}
          </h2>
          <form onSubmit={handleAdd} className="space-y-3 text-xs">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                {lang === 'bn' ? 'কাস্টমারের নাম *' : 'Customer Name *'}
              </label>
              <input
                required
                placeholder={lang === 'bn' ? 'যেমন: মোহাম্মদ করিম' : 'Customer Name *'}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                {lang === 'bn' ? 'মোবাইল নম্বর *' : 'Mobile Number (+880...) *'}
              </label>
              <input
                required
                placeholder="01700000000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                {lang === 'bn' ? 'ঠিকানা (ঐচ্ছিক)' : 'Address (Optional)'}
              </label>
              <input
                placeholder={lang === 'bn' ? 'যেমন: ধানমন্ডি, ঢাকা' : 'Address'}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold transition-colors"
            >
              {lang === 'bn' ? 'কাস্টমার সংরক্ষণ করুন' : 'Save Customer'}
            </button>
          </form>
        </div>

        {/* Customer Directory Table */}
        <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display font-semibold text-sm text-slate-900 dark:text-white">
                {lang === 'bn' ? `কাস্টমার তালিকা (${filtered.length})` : `Customer Directory (${filtered.length})`}
              </h3>
              <p className="text-[11px] text-slate-500">
                {lang === 'bn' ? 'ভুল এন্ট্রি হলে ডানপাশের এডিট/মুছুন বাটন ব্যবহার করুন' : 'Edit or delete incorrect entries using action buttons'}
              </p>
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={lang === 'bn' ? 'নাম বা ফোন নম্বর খুঁজুন...' : 'Search name or phone...'}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-4 font-medium">{lang === 'bn' ? 'কাস্টমার' : 'Customer'}</th>
                  <th className="py-2.5 px-3 text-right font-medium">{lang === 'bn' ? 'মোট ক্রয়' : 'Purchases'}</th>
                  <th className="py-2.5 px-3 text-right font-medium">{lang === 'bn' ? 'পরিশোধিত' : 'Paid'}</th>
                  <th className="py-2.5 px-3 text-right font-medium">{lang === 'bn' ? 'বাকি বকেয়া' : 'Current Due'}</th>
                  <th className="py-2.5 px-3 font-medium">{lang === 'bn' ? 'সম্মতি' : 'Consent'}</th>
                  <th className="py-2.5 px-4 text-right font-medium">{lang === 'bn' ? 'অ্যাকশন' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-950/50">
                    <td className="py-2.5 px-4">
                      <div className="font-semibold text-slate-900 dark:text-white">{c.name}</div>
                      <div className="text-[11px] text-slate-500 font-mono">{c.code} · {c.phone}</div>
                      {c.address && <div className="text-[10px] text-slate-400 truncate max-w-xs">{c.address}</div>}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatBDT(c.total_purchases)}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatBDT(c.total_payments)}</td>
                    <td className={`py-2.5 px-3 text-right font-mono font-semibold tabular-nums ${c.current_due > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {formatBDT(c.current_due)}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1 text-[10px]">
                        <button
                          onClick={() => toggleConsent(c, 'consent_sms')}
                          title="SMS Consent"
                          className={`px-1.5 py-0.5 rounded border ${c.consent_sms ? 'border-teal-600 text-teal-700 bg-teal-50 dark:bg-teal-950' : 'border-slate-300 text-slate-400'}`}
                        >
                          SMS
                        </button>
                        <button
                          onClick={() => toggleConsent(c, 'consent_whatsapp')}
                          title="WhatsApp Consent"
                          className={`px-1.5 py-0.5 rounded border ${c.consent_whatsapp ? 'border-emerald-600 text-emerald-700 bg-emerald-50 dark:bg-emerald-950' : 'border-slate-300 text-slate-400'}`}
                        >
                          WA
                        </button>
                        <button
                          onClick={() => toggleConsent(c, 'opt_out_marketing')}
                          title="Promo SMS"
                          className={`px-1.5 py-0.5 rounded border ${c.opt_out_marketing ? 'border-red-500 text-red-600 bg-red-50 dark:bg-red-950' : 'border-slate-300 text-slate-500'}`}
                        >
                          {c.opt_out_marketing ? 'Opt-Out' : 'Promo'}
                        </button>
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5 justify-end">
                        {/* Edit / সংশোধন Button */}
                        <button
                          type="button"
                          onClick={() => startEdit(c)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-teal-700 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/30 text-[11px] font-medium"
                          title={lang === 'bn' ? 'কাস্টমারের তথ্য সংশোধন করুন' : 'Edit Customer'}
                        >
                          <Edit2 className="w-3 h-3" />
                          <span>{lang === 'bn' ? 'সংশোধন' : 'Edit'}</span>
                        </button>

                        {/* Delete / মুছুন Button */}
                        <button
                          type="button"
                          onClick={() => handleDelete(c)}
                          className="p-1 rounded-md border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-red-600 hover:border-red-200 dark:hover:border-red-900"
                          title={lang === 'bn' ? 'ভুল এন্ট্রি মুছুন' : 'Delete'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>

                        {/* Statement / Ledger Button */}
                        <button
                          type="button"
                          onClick={() => openLedger(c.id)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 text-[11px] font-medium"
                          title={lang === 'bn' ? 'লেজার হিসাব দেখুন' : 'Ledger'}
                        >
                          <FileText className="w-3 h-3" />
                          <span>{lang === 'bn' ? 'হিসাব' : 'Ledger'}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400 text-xs">
                      {lang === 'bn' ? 'কোনো কাস্টমার পাওয়া যায়নি।' : 'No customer records found.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Edit Customer Modal */}
      {editingCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="font-display font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-teal-700" />
                {lang === 'bn' ? 'কাস্টমারের তথ্য সংশোধন / এডিট' : 'Edit Customer Information'}
              </h3>
              <button
                type="button"
                onClick={() => setEditingCustomer(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdate} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {lang === 'bn' ? 'কাস্টমারের নাম *' : 'Customer Name *'}
                </label>
                <input
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Customer Name"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white font-medium focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {lang === 'bn' ? 'মোবাইল নম্বর *' : 'Mobile Phone *'}
                </label>
                <input
                  required
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="01700000000"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {lang === 'bn' ? 'ঠিকানা' : 'Address'}
                </label>
                <input
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                  placeholder="Address"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {lang === 'bn' ? 'ইমেইল (যদি থাকে)' : 'Email (Optional)'}
                </label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="customer@email.com"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingCustomer(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium"
                >
                  {lang === 'bn' ? 'বাতিল' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold transition-colors"
                >
                  {lang === 'bn' ? 'সংশোধন সংরক্ষণ করুন' : 'Update Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Customer Ledger Modal */}
      {ledger && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="w-full max-w-2xl rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xl">
            <div className="flex justify-between items-start border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <h3 className="font-display font-bold text-base text-slate-900 dark:text-white">
                  {ledger.customer.name} · {lang === 'bn' ? 'লেজার হিসাব বিবরণী' : 'Account Statement'}
                </h3>
                <div className="text-xs text-slate-500 font-mono">
                  {ledger.customer.code} · {ledger.customer.phone} · {lang === 'bn' ? 'বর্তমান বাকি' : 'Current Due'}:{' '}
                  <span className="font-semibold text-amber-600">{formatBDT(ledger.customer.current_due)}</span>
                </div>
              </div>
              <button
                onClick={() => setLedger(null)}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {lang === 'bn' ? 'বন্ধ করুন' : 'Close'}
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <h4 className="font-semibold mb-2 text-slate-800 dark:text-slate-200">
                  {lang === 'bn' ? 'বিক্রয় ইনভয়েসসমূহ' : 'Sales Invoices'}
                </h4>
                <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                  {ledger.sales.map((s) => (
                    <div key={String(s.id)} className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 flex justify-between bg-slate-50/50 dark:bg-slate-950/40">
                      <div>
                        <div className="font-mono font-medium text-slate-900 dark:text-white">{String(s.invoice_no)}</div>
                        <div className="text-[11px] text-slate-500">{String(s.created_at).slice(0, 10)}</div>
                      </div>
                      <div className="text-right font-mono">
                        <div>{formatBDT(Number(s.total))}</div>
                        {Number(s.due_amount) > 0 && <div className="text-amber-600 text-[11px]">Due {formatBDT(Number(s.due_amount))}</div>}
                      </div>
                    </div>
                  ))}
                  {!ledger.sales.length && <div className="text-slate-400 py-4 text-center">কোনো ইনভয়েস পাওয়া যায়নি।</div>}
                </div>
              </div>
              <div>
                <h4 className="font-semibold mb-2 text-slate-800 dark:text-slate-200">
                  {lang === 'bn' ? 'বাকি পরিশোধের ইতিহাস' : 'Due Payment History'}
                </h4>
                <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                  {ledger.payments.map((p) => (
                    <div key={String(p.id)} className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 flex justify-between bg-slate-50/50 dark:bg-slate-950/40">
                      <div>
                        <div className="font-mono font-medium text-slate-900 dark:text-white">{String(p.receipt_no)}</div>
                        <div className="text-[11px] text-slate-500">{String(p.payment_method)}</div>
                      </div>
                      <div className="font-mono font-semibold text-emerald-600">{formatBDT(Number(p.amount))}</div>
                    </div>
                  ))}
                  {!ledger.payments.length && <div className="text-slate-400 py-4 text-center">কোনো বকেয়া পরিশোধের রেকর্ড নেই।</div>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

