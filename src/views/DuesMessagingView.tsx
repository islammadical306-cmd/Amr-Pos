import React, { useEffect, useState } from 'react';
import { Printer, Wallet } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { queueOfflineOperation } from '../lib/offlineDb';
import { formatBDT, type Lang } from '../i18n';
import type { Customer, ShopSettings } from '../types';
import { BulkSmsWorkspace } from '../components/BulkSmsWorkspace';

interface DuesMessagingViewProps {
  mode: 'dues' | 'messaging';
  lang: Lang;
  isOnline: boolean;
  customers: Customer[];
  settings?: ShopSettings | null;
  canManageGateways?: boolean;
  onRefresh: () => Promise<void>;
}

const TEMPLATES = {
  due_reminder: {
    en: (name: string, due: number) => `Dear ${name}, your current due balance at AmarCare Pharmacy & Retail is ${formatBDT(due)}. Please settle at your convenience. Thank you.`,
    bn: (name: string, due: number) => `প্রিয় ${name}, আমারকেয়ার ফার্মেসি ও রিটেইলে আপনার বর্তমান বাকি ${formatBDT(due)}। অনুগ্রহ করে সুবিধামতো পরিশোধ করুন। ধন্যবাদ।`,
  },
  payment_confirm: {
    en: (name: string, amt: number) => `Dear ${name}, we received your payment of ${formatBDT(amt)}. Thank you for shopping with AmarCare!`,
    bn: (name: string, amt: number) => `প্রিয় ${name}, আপনার ${formatBDT(amt)} পেমেন্ট সফলভাবে গ্রহণ করা হয়েছে। ধন্যবাদ!`,
  },
  promo_offer: {
    en: (name: string) => `Hi ${name}, enjoy 10% OFF healthcare & daily essentials this week using code WELCOME10 at AmarCare!`,
    bn: (name: string) => `হ্যালো ${name}, এই সপ্তাহে WELCOME10 কোড ব্যবহার করে সব পণ্যে ১০% ছাড় উপভোগ করুন!`,
  },
};

export const DuesMessagingView: React.FC<DuesMessagingViewProps> = ({
  mode,
  lang,
  isOnline,
  customers,
  settings = null,
  canManageGateways = false,
  onRefresh,
}) => {
  const [payments, setPayments] = useState<Array<Record<string, unknown>>>([]);
  const [selectedCustId, setSelectedCustId] = useState<number | ''>('');
  const [amount, setAmount] = useState('');
  const [payMethod, setPayMethod] = useState('CASH');
  const [note, setNote] = useState('');
  const [autoSendConfirm, setAutoSendConfirm] = useState(true);
  const [receipt, setReceipt] = useState<{ receipt_no: string; customer_name: string; amount: number; method: string; date: string } | null>(null);
  const [statusMsg, setStatusMsg] = useState('');

  const loadLogs = async () => {
    if (!isOnline || mode !== 'dues') return;
    try {
      const p = await apiFetch<Array<Record<string, unknown>>>('/api/dues/payments');
      setPayments(p);
    } catch {
      // ignore offline
    }
  };

  useEffect(() => {
    loadLogs();
  }, [mode, isOnline]);

  const dueCustomers = customers.filter((c) => c.current_due > 0);

  const handleCollectDue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustId || Number(amount) <= 0) return;
    const cust = customers.find((c) => c.id === selectedCustId);
    const clientTxId = `due-${Date.now()}`;
    const payload = {
      client_tx_id: clientTxId,
      customer_id: Number(selectedCustId),
      amount: Number(amount),
      payment_method: payMethod,
      note,
      created_at: new Date().toISOString(),
    };

    try {
      let receiptNo = `OFF-RCP-${String(Date.now()).slice(-4)}`;
      if (isOnline) {
        const res = await apiFetch<{ receipt_no: string }>('/api/dues/collect', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        receiptNo = res.receipt_no;
        if (autoSendConfirm && cust) {
          await apiFetch('/api/messages/send', {
            method: 'POST',
            body: JSON.stringify({
              customer_id: cust.id,
              channel: 'SMS',
              template_key: 'payment_confirm',
              message_body: TEMPLATES.payment_confirm.bn(cust.name, Number(amount)),
              is_promotional: false,
            }),
          });
        }
      } else {
        await queueOfflineOperation({ id: clientTxId, type: 'DUE_PAYMENT', payload, createdAt: new Date().toISOString() });
      }
      setReceipt({
        receipt_no: receiptNo,
        customer_name: cust?.name || '',
        amount: Number(amount),
        method: payMethod,
        date: new Date().toLocaleString(),
      });
      setAmount('');
      setNote('');
      await Promise.all([onRefresh(), loadLogs()]);
    } catch (err) {
      setStatusMsg((err as Error).message);
    }
  };

  if (mode === 'messaging') {
    return (
      <BulkSmsWorkspace
        lang={lang}
        isOnline={isOnline}
        customers={customers}
        settings={settings}
        canManageGateways={canManageGateways}
      />
    );
  }

  return (
    <div className="space-y-5">
      {statusMsg && <div className="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs">{statusMsg}</div>}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <form onSubmit={handleCollectDue} className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 text-xs">
          <h2 className="font-display font-semibold text-sm flex items-center gap-2">
            <Wallet className="w-4 h-4 text-teal-700" />
            Collect Customer Due
          </h2>
          <select required value={selectedCustId} onChange={(e) => setSelectedCustId(Number(e.target.value))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2">
            <option value="">Select Customer with Due</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.phone}) · Due: {formatBDT(c.current_due)}
              </option>
            ))}
          </select>
          <input required type="number" min={1} step="0.01" placeholder="Collected Amount (৳)" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
          <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2">
            <option value="CASH">Cash</option>
            <option value="MOBILE_BANKING">bKash / Nagad</option>
            <option value="CARD">Card</option>
          </select>
          <input placeholder="Note / Reference" value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={autoSendConfirm} onChange={(e) => setAutoSendConfirm(e.target.checked)} />
            <span>Send automatic SMS payment confirmation</span>
          </label>
          <button type="submit" className="w-full py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold">
            Record Payment & Print Receipt
          </button>
        </form>

        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
          <h3 className="font-display font-semibold text-sm">Customers with Outstanding Dues ({dueCustomers.length})</h3>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-72 overflow-y-auto text-xs">
            {dueCustomers.map((c) => (
              <div key={c.id} className="py-2.5 flex items-center justify-between">
                <div>
                  <div className="font-semibold">{c.name}</div>
                  <div className="text-[11px] text-slate-500">{c.phone}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold text-amber-600 tabular-nums">{formatBDT(c.current_due)}</span>
                  <button
                    onClick={() => {
                      setSelectedCustId(c.id);
                      setAmount(String(c.current_due));
                    }}
                    className="px-2.5 py-1 rounded bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-[11px]"
                  >
                    Collect
                  </button>
                </div>
              </div>
            ))}
            {!dueCustomers.length && <div className="py-6 text-center text-slate-400">Zero outstanding customer dues.</div>}
          </div>
        </div>
      </div>

      {/* Printable Payment Receipt */}
      {receipt && (
        <div className="bg-white dark:bg-slate-900 border border-teal-600 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="font-mono">
            <div className="font-bold text-sm">Payment Receipt · {receipt.receipt_no}</div>
            <div>Customer: {receipt.customer_name} · Paid: {formatBDT(receipt.amount)} ({receipt.method}) · {receipt.date}</div>
          </div>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-700 text-white font-semibold no-print">
            <Printer className="w-3.5 h-3.5" /> Print Receipt
          </button>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 font-display font-semibold text-sm">Recent Due Collections</div>
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="py-2.5 px-4">Receipt</th>
              <th className="py-2.5 px-3">Customer</th>
              <th className="py-2.5 px-3">Method</th>
              <th className="py-2.5 px-3 text-right">Amount</th>
              <th className="py-2.5 px-4">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {payments.map((p) => (
              <tr key={String(p.id)}>
                <td className="py-2 px-4 font-mono">{String(p.receipt_no)}</td>
                <td className="py-2 px-3">{String(p.customer_name)}</td>
                <td className="py-2 px-3">{String(p.payment_method)}</td>
                <td className="py-2 px-3 text-right font-mono font-semibold text-emerald-600 tabular-nums">{formatBDT(Number(p.amount))}</td>
                <td className="py-2 px-4 font-mono text-[11px] text-slate-500">{String(p.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
