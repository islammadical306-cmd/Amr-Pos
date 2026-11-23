import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  FileText,
  History,
  MessageSquare,
  Package,
  Phone,
  Printer,
  Receipt,
  RotateCcw,
  Send,
  User,
  Wallet,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { readOfflineCatalog } from '../lib/offlineDb';
import { formatBDT, type Lang } from '../i18n';
import type { Customer, ShopSettings } from '../types';

export interface CustomerDueHistoryModalProps {
  customerId: number | null;
  lang: Lang;
  isOnline: boolean;
  settings?: ShopSettings | null;
  onClose: () => void;
  onRefresh?: () => Promise<void>;
  onCollectPayment?: (customer: Customer) => void;
}

interface DueInvoice {
  id: number;
  invoice_no: string;
  total: number;
  paid_amount: number;
  due_amount: number;
  payment_method: string;
  status: string;
  created_at: string;
  items?: Array<{
    product_name: string;
    quantity: number;
    unit_price: number;
    line_total: number;
  }>;
}

interface DuePayment {
  id: number;
  receipt_no: string;
  amount: number;
  payment_method: string;
  note?: string;
  created_at: string;
}

interface LedgerData {
  customer: Customer;
  sales: DueInvoice[];
  payments: DuePayment[];
}

export const CustomerDueHistoryModal: React.FC<CustomerDueHistoryModalProps> = ({
  customerId,
  lang,
  isOnline,
  settings,
  onClose,
  onRefresh,
  onCollectPayment,
}) => {
  const [data, setData] = useState<LedgerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'invoices' | 'payments' | 'ledger'>('invoices');
  const [sendingSms, setSendingSms] = useState(false);
  const [smsMsg, setSmsMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Quick collect payment inside modal
  const [showCollectForm, setShowCollectForm] = useState(false);
  const [collectAmount, setCollectAmount] = useState('');
  const [collectMethod, setCollectMethod] = useState('CASH');
  const [collectNote, setCollectNote] = useState('');
  const [collectSubmitting, setCollectSubmitting] = useState(false);

  const loadCustomerData = async () => {
    if (!customerId) return;
    setLoading(true);
    setErrorMsg('');
    try {
      if (isOnline) {
        const res = await apiFetch<LedgerData>(`/api/customers/${customerId}/ledger`);
        setData(res);
      } else {
        // Offline fallback from local IndexedDB
        const offline = await readOfflineCatalog();
        const foundCust = offline.customers.find((c) => c.id === customerId);
        if (foundCust) {
          const custSales = (offline.sales || [])
            .filter((s) => s.customer_id === customerId)
            .map((s) => ({
              id: s.id,
              invoice_no: s.invoice_no,
              total: s.total,
              paid_amount: s.paid_amount,
              due_amount: s.due_amount,
              payment_method: s.payment_method,
              status: s.status,
              created_at: s.created_at,
              items: s.items || [],
            }));
          setData({
            customer: foundCust,
            sales: custSales,
            payments: [],
          });
        }
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (customerId) {
      loadCustomerData();
    }
  }, [customerId, isOnline]);

  // Compute only due invoices
  const dueInvoices = useMemo(() => {
    if (!data?.sales) return [];
    return data.sales.filter((s) => Number(s.due_amount) > 0 && s.status !== 'CANCELLED');
  }, [data]);

  // Compute full chronological running ledger
  const chronologicalLedger = useMemo(() => {
    if (!data) return [];
    const entries: Array<{
      date: string;
      ref: string;
      type: 'SALE' | 'PAYMENT';
      particulars: string;
      debit: number;
      credit: number;
      timestamp: number;
    }> = [];

    // Sales
    for (const s of data.sales || []) {
      entries.push({
        date: s.created_at,
        ref: s.invoice_no,
        type: 'SALE',
        particulars: lang === 'bn' ? `পণ্য বিক্রয় চালান (${s.payment_method})` : `Sale Invoice (${s.payment_method})`,
        debit: Number(s.total || 0),
        credit: Number(s.paid_amount || 0),
        timestamp: new Date(s.created_at).getTime(),
      });
    }

    // Installments / Payments
    for (const p of data.payments || []) {
      entries.push({
        date: p.created_at,
        ref: p.receipt_no,
        type: 'PAYMENT',
        particulars: lang === 'bn' ? `বকেয়া কিস্তি জমা (${p.payment_method})` : `Due Collection (${p.payment_method})`,
        debit: 0,
        credit: Number(p.amount || 0),
        timestamp: new Date(p.created_at).getTime(),
      });
    }

    // Sort ascending to calculate balance
    entries.sort((a, b) => a.timestamp - b.timestamp);

    let runningBalance = 0;
    const computed = entries.map((e, idx) => {
      runningBalance += e.debit - e.credit;
      return {
        id: `entry-${idx}`,
        ...e,
        balance: Math.max(0, runningBalance),
      };
    });

    return computed.reverse();
  }, [data, lang]);

  if (!customerId) return null;

  // Handle Quick Payment
  const handleQuickCollect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data?.customer || Number(collectAmount) <= 0) return;
    setCollectSubmitting(true);
    try {
      await apiFetch('/api/dues/collect', {
        method: 'POST',
        body: JSON.stringify({
          client_tx_id: `due-${Date.now()}`,
          customer_id: data.customer.id,
          amount: Number(collectAmount),
          payment_method: collectMethod,
          note: collectNote,
          created_at: new Date().toISOString(),
        }),
      });
      setCollectAmount('');
      setCollectNote('');
      setShowCollectForm(false);
      setSmsMsg(lang === 'bn' ? 'সফলভাবে বকেয়া টাকা জমা করা হয়েছে!' : 'Payment collected successfully!');
      await Promise.all([loadCustomerData(), onRefresh?.()]);
      setTimeout(() => setSmsMsg(''), 3000);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setCollectSubmitting(false);
    }
  };

  // Send SMS Reminder
  const handleSendReminderSms = async () => {
    if (!data?.customer) return;
    const due = data.customer.current_due || 0;
    if (due <= 0) {
      setSmsMsg(lang === 'bn' ? 'এই কাস্টমারের কোনো বকেয়া নেই।' : 'Customer has zero outstanding due.');
      return;
    }
    setSendingSms(true);
    try {
      const shopName = settings?.shop_name || 'AmarPOS';
      const text =
        lang === 'bn'
          ? `প্রিয় ${data.customer.name}, ${shopName}-এ আপনার বর্তমান বকেয়া বাকি ${formatBDT(due)}। অনুগ্রহ করে সুবিধামতো পরিশোধ করুন। ধন্যবাদ।`
          : `Dear ${data.customer.name}, your due at ${shopName} is ${formatBDT(due)}. Please settle at your convenience.`;

      await apiFetch('/api/messages/send', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: data.customer.id,
          channel: 'SMS',
          template_key: 'due_reminder',
          message_body: text,
          is_promotional: false,
        }),
      });
      setSmsMsg(lang === 'bn' ? 'কাস্টমারের মোবাইলে বাকি রিমাইন্ডার SMS পাঠানো হয়েছে!' : 'Due reminder SMS sent successfully!');
      setTimeout(() => setSmsMsg(''), 3000);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSendingSms(false);
    }
  };

  const cust = data?.customer;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-4xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-teal-50/60 dark:bg-teal-950/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-teal-600 text-white flex items-center justify-center shadow-md">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
                <span>{cust?.name || (lang === 'bn' ? 'কাস্টমার বাকি হিস্টোরি' : 'Customer Due History')}</span>
                {cust?.code && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    ID: {cust.code}
                  </span>
                )}
              </h2>
              <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                {cust?.phone && (
                  <span className="flex items-center gap-1 font-mono">
                    <Phone className="w-3 h-3 text-slate-400" /> {cust.phone}
                  </span>
                )}
                {cust?.address && <span>· {cust.address}</span>}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 text-xs font-semibold shadow-sm"
              title="স্টেটমেন্ট প্রিন্ট করুন"
            >
              <Printer className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{lang === 'bn' ? 'প্রিন্ট' : 'Print'}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Feedback / Error Alerts */}
        {smsMsg && (
          <div className="mx-6 mt-4 p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{smsMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="mx-6 mt-4 p-3 rounded-2xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button onClick={() => setErrorMsg('')} className="text-red-500 hover:text-red-700">✕</button>
          </div>
        )}

        {/* Quick Top Metrics Cards */}
        <div className="p-6 pb-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800">
            <div className="text-[11px] text-slate-500 font-medium">
              {lang === 'bn' ? 'মোট কেনাকাটা (Invoiced)' : 'Total Purchases'}
            </div>
            <div className="font-mono font-bold text-base text-slate-900 dark:text-white mt-1 tabular-nums">
              {formatBDT(cust?.total_purchases || cust?.total_spent || data?.sales.reduce((s, it) => s + Number(it.total || 0), 0))}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {data?.sales.length || 0} {lang === 'bn' ? 'টি বিক্রয় চালান' : 'invoices'}
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-800">
            <div className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">
              {lang === 'bn' ? 'মোট পরিশোধিত টাকা (Paid)' : 'Total Paid Amount'}
            </div>
            <div className="font-mono font-bold text-base text-emerald-700 dark:text-emerald-300 mt-1 tabular-nums">
              {formatBDT(
                (data?.sales.reduce((s, it) => s + Number(it.paid_amount || 0), 0) || 0) +
                  (data?.payments.reduce((s, it) => s + Number(it.amount || 0), 0) || 0)
              )}
            </div>
            <div className="text-[10px] text-emerald-600/80 mt-0.5">
              {data?.payments.length || 0} {lang === 'bn' ? 'বার কিস্তি জমা' : 'installments'}
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-amber-50/80 dark:bg-amber-950/50 border border-amber-200/80 dark:border-amber-800">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-amber-700 dark:text-amber-300 font-semibold">
                {lang === 'bn' ? 'বর্তমান মোট বকেয়া (Due)' : 'Outstanding Due Balance'}
              </span>
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
            </div>
            <div className="font-mono font-bold text-lg text-amber-600 dark:text-amber-400 mt-1 tabular-nums">
              {formatBDT(cust?.current_due ?? cust?.total_due ?? 0)}
            </div>
            <div className="flex items-center justify-between mt-1 text-[11px]">
              <span className="text-amber-700/80 font-medium">
                {dueInvoices.length} {lang === 'bn' ? 'টি চালানে বাকি আছে' : 'due invoices'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setCollectAmount(String(cust?.current_due ?? cust?.total_due ?? 0));
                  setShowCollectForm(!showCollectForm);
                }}
                className="text-teal-700 dark:text-teal-400 font-bold hover:underline"
              >
                {showCollectForm ? (lang === 'bn' ? 'ফর্ম বন্ধ' : 'Close') : (lang === 'bn' ? 'টাকা জমা নিন →' : 'Collect →')}
              </button>
            </div>
          </div>
        </div>

        {/* Quick Collect Payment Dropdown Panel */}
        {showCollectForm && (
          <form
            onSubmit={handleQuickCollect}
            className="mx-6 mb-3 p-4 rounded-2xl bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 space-y-3 text-xs"
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-teal-950 dark:text-teal-100 flex items-center gap-1.5">
                <Wallet className="w-4 h-4 text-teal-700" />
                {lang === 'bn' ? 'বকেয়া টাকা জমা গ্রহণ করুন' : 'Collect Customer Due'}
              </span>
              <span className="text-[11px] text-teal-700 dark:text-teal-300 font-mono">
                {lang === 'bn' ? 'বাকি:' : 'Due:'} {formatBDT(cust?.current_due ?? 0)}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] text-slate-600 dark:text-slate-400 block mb-1">
                  {lang === 'bn' ? 'জমার পরিমাণ (৳) *' : 'Amount (৳) *'}
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  max={cust?.current_due || 9999999}
                  value={collectAmount}
                  onChange={(e) => setCollectAmount(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono font-bold text-sm focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div>
                <label className="text-[11px] text-slate-600 dark:text-slate-400 block mb-1">
                  {lang === 'bn' ? 'পেমেন্ট মাধ্যম' : 'Payment Method'}
                </label>
                <select
                  value={collectMethod}
                  onChange={(e) => setCollectMethod(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                >
                  <option value="CASH">{lang === 'bn' ? 'ক্যাশ (Cash)' : 'Cash'}</option>
                  <option value="BKASH">bKash</option>
                  <option value="NAGAD">Nagad</option>
                  <option value="CARD">{lang === 'bn' ? 'ব্যাংক কার্ড' : 'Card'}</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] text-slate-600 dark:text-slate-400 block mb-1">
                  {lang === 'bn' ? 'নোট / মন্তব্য' : 'Note'}
                </label>
                <input
                  type="text"
                  placeholder={lang === 'bn' ? 'যেমন: কিস্তি জমা' : 'Optional note'}
                  value={collectNote}
                  onChange={(e) => setCollectNote(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowCollectForm(false)}
                className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold"
              >
                {lang === 'bn' ? 'বাতিল' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={collectSubmitting || Number(collectAmount) <= 0}
                className="px-4 py-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold shadow-md disabled:opacity-50"
              >
                {collectSubmitting ? (lang === 'bn' ? 'জমা হচ্ছে...' : 'Saving...') : (lang === 'bn' ? 'জমা নিশ্চিত করুন' : 'Confirm Payment')}
              </button>
            </div>
          </form>
        )}

        {/* View Selection Tabs */}
        <div className="px-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 bg-slate-50/50 dark:bg-slate-950/50">
          <div className="flex gap-2 py-2">
            <button
              type="button"
              onClick={() => setActiveTab('invoices')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'invoices'
                  ? 'bg-teal-700 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>{lang === 'bn' ? 'বাকি চালানসমূহ' : 'Due Invoices'}</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${activeTab === 'invoices' ? 'bg-white/20' : 'bg-slate-200 dark:bg-slate-800'}`}>
                {dueInvoices.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('payments')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'payments'
                  ? 'bg-teal-700 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Receipt className="w-3.5 h-3.5" />
              <span>{lang === 'bn' ? 'কিস্তি জমার হিস্টোরি' : 'Payment Logs'}</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${activeTab === 'payments' ? 'bg-white/20' : 'bg-slate-200 dark:bg-slate-800'}`}>
                {data?.payments.length || 0}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('ledger')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'ledger'
                  ? 'bg-teal-700 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>{lang === 'bn' ? 'সম্পূর্ণ খতিয়ান লেজার' : 'Full Ledger'}</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSendReminderSms}
              disabled={sendingSms || (cust?.current_due || 0) <= 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-semibold shadow-sm transition-colors"
              title="কাস্টমারকে বাকি রিমাইন্ডার SMS পাঠান"
            >
              <Send className={`w-3.5 h-3.5 ${sendingSms ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{lang === 'bn' ? 'বাকি রিমাইন্ডার SMS' : 'Send Reminder'}</span>
            </button>
          </div>
        </div>

        {/* Tab Content List */}
        <div className="p-6 flex-1 overflow-y-auto space-y-4">
          {loading ? (
            <div className="py-16 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2">
              <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
              <span>{lang === 'bn' ? 'বাকি তথ্য ও চালান হিস্টোরি লোড হচ্ছে...' : 'Loading due history...'}</span>
            </div>
          ) : (
            <>
              {/* TAB 1: DUE INVOICES */}
              {activeTab === 'invoices' && (
                <div className="space-y-3">
                  {dueInvoices.map((inv) => (
                    <div
                      key={inv.id}
                      className="border border-slate-200 dark:border-slate-800 rounded-2xl p-4 bg-white dark:bg-slate-900 space-y-3 shadow-sm hover:border-teal-500 transition-colors"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-xs text-slate-900 dark:text-white">
                            {inv.invoice_no}
                          </span>
                          <span className="text-[11px] text-slate-400 font-mono">
                            · {String(inv.created_at).slice(0, 16)}
                          </span>
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                            {lang === 'bn' ? 'বাকি চালান' : 'Due Invoice'}
                          </span>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <span className="text-[10px] text-slate-400 block">{lang === 'bn' ? 'বাকি টাকা' : 'Due Amount'}</span>
                            <span className="font-mono font-bold text-sm text-red-600 dark:text-red-400 tabular-nums">
                              {formatBDT(inv.due_amount)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Items summary */}
                      {inv.items && inv.items.length > 0 && (
                        <div className="bg-slate-50 dark:bg-slate-950/50 rounded-xl p-3 space-y-1.5 text-xs">
                          <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                            <Package className="w-3.5 h-3.5 text-teal-600" />
                            <span>{lang === 'bn' ? 'এই চালানে কেনা পণ্যসমূহ:' : 'Purchased Items in this Invoice:'}</span>
                          </div>
                          <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                            {inv.items.map((it, idx) => (
                              <div key={idx} className="py-1 flex items-center justify-between text-[11px]">
                                <span className="font-medium text-slate-800 dark:text-slate-200">
                                  {it.product_name} <span className="font-mono text-slate-500">x{it.quantity}</span>
                                </span>
                                <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                                  {formatBDT(it.line_total)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between text-xs text-slate-500 pt-1">
                        <div className="space-x-3">
                          <span>{lang === 'bn' ? 'মোট বিল:' : 'Total:'} <strong className="font-mono text-slate-800 dark:text-slate-200">{formatBDT(inv.total)}</strong></span>
                          <span>·</span>
                          <span>{lang === 'bn' ? 'নগদ পরিশোধিত:' : 'Paid:'} <strong className="font-mono text-emerald-600">{formatBDT(inv.paid_amount)}</strong></span>
                        </div>
                        <div className="font-mono text-[11px]">
                          {lang === 'bn' ? 'মাধ্যম:' : 'Method:'} {inv.payment_method}
                        </div>
                      </div>
                    </div>
                  ))}

                  {dueInvoices.length === 0 && (
                    <div className="py-12 text-center text-xs text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                      {lang === 'bn'
                        ? 'এই কাস্টমারের কোনো বকেয়া বাকি চালান নেই।'
                        : 'No pending due invoices found for this customer.'}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: PAYMENTS LOG */}
              {activeTab === 'payments' && (
                <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="py-2.5 px-4">{lang === 'bn' ? 'রসিদ নং' : 'Receipt #'}</th>
                        <th className="py-2.5 px-3">{lang === 'bn' ? 'তারিখ ও সময়' : 'Date & Time'}</th>
                        <th className="py-2.5 px-3">{lang === 'bn' ? 'পেমেন্ট মাধ্যম' : 'Method'}</th>
                        <th className="py-2.5 px-3">{lang === 'bn' ? 'নোট / বিবরণ' : 'Note'}</th>
                        <th className="py-2.5 px-4 text-right">{lang === 'bn' ? 'জমা পরিমাণ' : 'Amount Paid'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {data?.payments.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-3 px-4 font-mono font-medium text-teal-700 dark:text-teal-400">
                            {p.receipt_no}
                          </td>
                          <td className="py-3 px-3 font-mono text-[11px] text-slate-500">
                            {String(p.created_at).slice(0, 16)}
                          </td>
                          <td className="py-3 px-3">
                            <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                              {p.payment_method}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-slate-600 dark:text-slate-400">
                            {p.note || '—'}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                            +{formatBDT(p.amount)}
                          </td>
                        </tr>
                      ))}
                      {(!data?.payments || data.payments.length === 0) && (
                        <tr>
                          <td colSpan={5} className="py-12 text-center text-xs text-slate-400">
                            {lang === 'bn' ? 'এখনো কোনো কিস্তি জমার হিস্টোরি পাওয়া যায়নি।' : 'No payment installment records found.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* TAB 3: COMPLETE CHRONOLOGICAL LEDGER */}
              {activeTab === 'ledger' && (
                <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="py-2.5 px-4">{lang === 'bn' ? 'তারিখ' : 'Date'}</th>
                        <th className="py-2.5 px-3">{lang === 'bn' ? 'বিবরণ' : 'Particulars'}</th>
                        <th className="py-2.5 px-3">{lang === 'bn' ? 'রেফারেন্স #' : 'Ref #'}</th>
                        <th className="py-2.5 px-3 text-right">{lang === 'bn' ? 'ডেবিট (বিল)' : 'Debit (৳)'}</th>
                        <th className="py-2.5 px-3 text-right">{lang === 'bn' ? 'ক্রেডিট (জমা)' : 'Credit (৳)'}</th>
                        <th className="py-2.5 px-4 text-right">{lang === 'bn' ? 'বাকি ব্যালেন্স' : 'Balance (৳)'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {chronologicalLedger.map((row) => (
                        <tr key={row.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500">
                            {String(row.date).slice(0, 16)}
                          </td>
                          <td className="py-2.5 px-3 font-medium text-slate-800 dark:text-slate-200">
                            {row.particulars}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-teal-700 dark:text-teal-400">
                            {row.ref}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                            {row.debit > 0 ? formatBDT(row.debit) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                            {row.credit > 0 ? formatBDT(row.credit) : '—'}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-amber-600 dark:text-amber-400">
                            {formatBDT(row.balance)}
                          </td>
                        </tr>
                      ))}
                      {chronologicalLedger.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-12 text-center text-xs text-slate-400">
                            {lang === 'bn' ? 'কোনো লেনদেন রেকর্ড পাওয়া যায়নি।' : 'No transactions recorded.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="text-slate-500">
            {lang === 'bn' ? 'দোকান:' : 'Store:'}{' '}
            <strong className="text-slate-800 dark:text-slate-200">{settings?.shop_name || 'AmarPOS'}</strong>
          </div>
          <div className="flex items-center gap-2">
            {cust && cust.current_due > 0 && onCollectPayment && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onCollectPayment(cust);
                }}
                className="px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-semibold shadow-sm transition-colors"
              >
                {lang === 'bn' ? 'বাকি আদায় করুন' : 'Collect Due'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold shadow-sm"
            >
              {lang === 'bn' ? 'বন্ধ করুন' : 'Close'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
