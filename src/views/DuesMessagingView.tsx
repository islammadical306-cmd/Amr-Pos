import React, { useEffect, useState } from 'react';
import { History, Printer, Wallet } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { queueOfflineOperation } from '../lib/offlineDb';
import { formatBDT, type Lang } from '../i18n';
import type { Customer, ShopSettings } from '../types';
import { BulkSmsWorkspace } from '../components/BulkSmsWorkspace';
import { CustomerDueHistoryModal } from '../components/CustomerDueHistoryModal';

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
    en: (name: string, due: number) => `Dear ${name}, your current due balance at Islam Medical & E-Center is ${formatBDT(due)}. Please settle at your convenience. Thank you.`,
    bn: (name: string, due: number) => `প্রিয় ${name}, ইসলাম মেডিকেল এন্ড ই-সেন্টারে আপনার বর্তমান বাকি ${formatBDT(due)}। অনুগ্রহ করে সুবিধামতো পরিশোধ করুন। ধন্যবাদ।`,
  },
  payment_confirm: {
    en: (name: string, amt: number) => `Dear ${name}, we received your payment of ${formatBDT(amt)}. Thank you for shopping with Islam Medical & E-Center!`,
    bn: (name: string, amt: number) => `প্রিয় ${name}, আপনার ${formatBDT(amt)} পেমেন্ট সফলভাবে গ্রহণ করা হয়েছে। ধন্যবাদ! — ইসলাম মেডিকেল এন্ড ই-সেন্টার`,
  },
  promo_offer: {
    en: (name: string) => `Hi ${name}, enjoy healthcare & daily essentials at Islam Medical & E-Center!`,
    bn: (name: string) => `হ্যালো ${name}, ইসলাম মেডিকেল এন্ড ই-সেন্টারে স্বাস্থ্যসেবা ও ঔষধ সামগ্রীতে বিশেষ সুবিধা গ্রহণ করুন!`,
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
  const [historyCustomerId, setHistoryCustomerId] = useState<number | null>(null);

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
            {lang === 'bn' ? 'বকেয়া টাকা জমা গ্রহণ' : 'Collect Customer Due'}
          </h2>
          <select required value={selectedCustId} onChange={(e) => setSelectedCustId(Number(e.target.value))} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2">
            <option value="">{lang === 'bn' ? 'বকেয়া থাকা কাস্টমার নির্বাচন করুন' : 'Select Customer with Due'}</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.phone}) · {lang === 'bn' ? 'বাকি:' : 'Due:'} {formatBDT(c.current_due)}
              </option>
            ))}
          </select>

          {/* Quick Check Customer Due History Banner */}
          {selectedCustId ? (
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-teal-50/70 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 text-[11px]">
              <span className="text-teal-900 dark:text-teal-200 font-medium">
                {lang === 'bn' ? 'বর্তমান মোট বাকি:' : 'Outstanding Due:'}{' '}
                <strong className="font-mono text-amber-600 font-bold">
                  {formatBDT(customers.find((c) => c.id === selectedCustId)?.current_due)}
                </strong>
              </span>
              <button
                type="button"
                onClick={() => setHistoryCustomerId(Number(selectedCustId))}
                className="inline-flex items-center gap-1 text-teal-700 dark:text-teal-400 font-bold hover:underline"
              >
                <History className="w-3.5 h-3.5" />
                <span>{lang === 'bn' ? 'সকল বাকি হিস্টোরি দেখুন →' : 'View Due History →'}</span>
              </button>
            </div>
          ) : null}

          <input required type="number" min={1} step="0.01" placeholder={lang === 'bn' ? 'আদায়কৃত টাকার পরিমাণ (৳)' : 'Collected Amount (৳)'} value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
          <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2">
            <option value="CASH">{lang === 'bn' ? 'নগদ ক্যাশ (Cash)' : 'Cash'}</option>
            <option value="MOBILE_BANKING">bKash / Nagad</option>
            <option value="CARD">{lang === 'bn' ? 'ব্যাংক কার্ড' : 'Card'}</option>
          </select>
          <input placeholder={lang === 'bn' ? 'নোট / রেফারেন্স (ঐচ্ছিক)' : 'Note / Reference'} value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={autoSendConfirm} onChange={(e) => setAutoSendConfirm(e.target.checked)} />
            <span>{lang === 'bn' ? 'স্বয়ংক্রিয় পেমেন্ট নিশ্চিতকরণ SMS পাঠান' : 'Send automatic SMS payment confirmation'}</span>
          </label>
          <button type="submit" className="w-full py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold">
            {lang === 'bn' ? 'টাকা জমা নিশ্চিত করুন ও রসিদ প্রিন্ট' : 'Record Payment & Print Receipt'}
          </button>
        </form>

        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-semibold text-sm">
              {lang === 'bn' ? `বকেয়া কাস্টমার তালিকা (${dueCustomers.length} জন)` : `Customers with Outstanding Dues (${dueCustomers.length})`}
            </h3>
            <span className="text-[11px] font-mono text-amber-600 font-bold">
              {lang === 'bn' ? 'মোট বকেয়া:' : 'Total Due:'} {formatBDT(dueCustomers.reduce((s, it) => s + Number(it.current_due || 0), 0))}
            </span>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-80 overflow-y-auto text-xs pr-1">
            {dueCustomers.map((c) => (
              <div key={c.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-semibold">{c.name}</div>
                  <div className="text-[11px] text-slate-500 font-mono">{c.phone || 'No phone'}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-amber-600 tabular-nums">{formatBDT(c.current_due)}</span>

                  {/* Button 1: Check Full Due History */}
                  <button
                    type="button"
                    onClick={() => setHistoryCustomerId(c.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-teal-300 dark:border-teal-700 bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/40 text-[11px] font-semibold transition-colors shadow-2xs"
                    title={lang === 'bn' ? 'এই কাস্টমারের সকল বাকি চালান ও খতিয়ান চেক করুন' : 'Check complete due history & invoices'}
                  >
                    <History className="w-3.5 h-3.5" />
                    <span>{lang === 'bn' ? 'বাকি হিস্টোরি' : 'Due History'}</span>
                  </button>

                  {/* Button 2: Collect Due */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCustId(c.id);
                      setAmount(String(c.current_due));
                    }}
                    className="px-2.5 py-1 rounded bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-[11px] font-medium hover:bg-slate-800"
                  >
                    {lang === 'bn' ? 'আদায়' : 'Collect'}
                  </button>
                </div>
              </div>
            ))}
            {!dueCustomers.length && (
              <div className="py-8 text-center text-slate-400">
                {lang === 'bn' ? 'কোনো কাস্টমারের বকেয়া বাকি নেই।' : 'Zero outstanding customer dues.'}
              </div>
            )}
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
      {historyCustomerId && (
        <CustomerDueHistoryModal
          customerId={historyCustomerId}
          lang={lang}
          isOnline={isOnline}
          settings={settings}
          onClose={() => setHistoryCustomerId(null)}
          onRefresh={onRefresh}
          onCollectPayment={(cust) => {
            setSelectedCustId(cust.id);
            setAmount(String(cust.current_due));
          }}
        />
      )}
    </div>
  );
};
