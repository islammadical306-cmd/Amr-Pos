import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  Download,
  Filter,
  History,
  Info,
  Layers,
  Printer,
  Receipt,
  RotateCcw,
  Search,
  User,
  Users,
  Wallet,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatBDT, type Lang } from '../i18n';
import type { Customer, Sale, ShopSettings, Supplier } from '../types';

interface LedgerViewProps {
  lang: Lang;
  isOnline: boolean;
  customers: Customer[];
  sales: Sale[];
  settings: ShopSettings | null;
  onRefresh: () => Promise<void>;
}

interface CustomerLedgerData {
  customer: Customer;
  sales: Array<{
    id: number;
    invoice_no: string;
    total: number;
    paid_amount: number;
    due_amount: number;
    payment_method: string;
    status: string;
    created_at: string;
  }>;
  payments: Array<{
    id: number;
    receipt_no: string;
    amount: number;
    payment_method: string;
    note?: string;
    created_at: string;
  }>;
}

interface SupplierLedgerData {
  supplier: Supplier;
  purchases: Array<{
    id: number;
    invoice_no: string;
    total: number;
    paid_amount: number;
    due_amount: number;
    note?: string;
    created_at: string;
  }>;
}

interface LedgerEntry {
  id: string;
  date: string;
  type: 'DEBIT' | 'CREDIT';
  particulars: string;
  reference: string;
  debit: number;
  credit: number;
  balance: number;
  method?: string;
}

export const LedgerView: React.FC<LedgerViewProps> = ({
  lang,
  isOnline,
  customers,
  sales,
  settings,
  onRefresh,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'customer' | 'supplier' | 'cash'>('customer');

  // Customer Ledger State
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [custLedgerData, setCustLedgerData] = useState<CustomerLedgerData | null>(null);
  const [custLoading, setCustLoading] = useState(false);
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('CASH');
  const [payNote, setPayNote] = useState('');
  const [paySubmitting, setPaySubmitting] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Supplier Ledger State
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null);
  const [supLedgerData, setSupLedgerData] = useState<SupplierLedgerData | null>(null);
  const [supLoading, setSupLoading] = useState(false);
  const [supPayAmount, setSupPayAmount] = useState('');
  const [supPayModalOpen, setSupPayModalOpen] = useState(false);

  // Cash Ledger State
  const [cashFrom, setCashFrom] = useState(new Date().toISOString().slice(0, 10));
  const [cashTo, setCashTo] = useState(new Date().toISOString().slice(0, 10));
  const [cashExpenses, setCashExpenses] = useState<Array<{ id: number; title: string; category: string; amount: number; payment_method: string; created_at: string }>>([]);
  const [duePaymentsAll, setDuePaymentsAll] = useState<Array<{ id: number; customer_name: string; receipt_no: string; amount: number; payment_method: string; created_at: string }>>([]);
  const [cashLoading, setCashLoading] = useState(false);

  // Load suppliers
  const loadSuppliers = async () => {
    try {
      const data = await apiFetch<Supplier[]>('/api/suppliers');
      setSuppliers(data);
      if (data.length > 0 && !selectedSupplierId) {
        setSelectedSupplierId(data[0].id);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadSuppliers();
  }, []);

  // Default first customer
  useEffect(() => {
    if (customers.length > 0 && !selectedCustomerId) {
      const firstDue = customers.find((c) => c.total_due > 0) || customers[0];
      setSelectedCustomerId(firstDue.id);
    }
  }, [customers, selectedCustomerId]);

  // Load Customer Ledger when selectedCustomerId changes
  const loadCustomerLedger = async (cid: number) => {
    setCustLoading(true);
    setErrorMsg('');
    try {
      const data = await apiFetch<CustomerLedgerData>(`/api/customers/${cid}/ledger`);
      setCustLedgerData(data);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setCustLoading(false);
    }
  };

  useEffect(() => {
    if (selectedCustomerId) {
      loadCustomerLedger(selectedCustomerId);
    }
  }, [selectedCustomerId]);

  // Load Supplier Ledger when selectedSupplierId changes
  const loadSupplierLedger = async (sid: number) => {
    setSupLoading(true);
    setErrorMsg('');
    try {
      const data = await apiFetch<SupplierLedgerData>(`/api/suppliers/${sid}/ledger`);
      setSupLedgerData(data);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSupLoading(false);
    }
  };

  useEffect(() => {
    if (selectedSupplierId) {
      loadSupplierLedger(selectedSupplierId);
    }
  }, [selectedSupplierId]);

  // Load Daily Cash Data
  const loadCashData = async () => {
    setCashLoading(true);
    try {
      const [exp, dps] = await Promise.all([
        apiFetch<Array<{ id: number; title: string; category: string; amount: number; payment_method: string; created_at: string }>>('/api/expenses'),
        apiFetch<Array<{ id: number; customer_name: string; receipt_no: string; amount: number; payment_method: string; created_at: string }>>('/api/dues/payments'),
      ]);
      setCashExpenses(exp);
      setDuePaymentsAll(dps);
    } catch {
      // ignore
    } finally {
      setCashLoading(false);
    }
  };

  useEffect(() => {
    if (activeSubTab === 'cash') {
      loadCashData();
    }
  }, [activeSubTab]);

  // Handle Customer Due Collection
  const handleCollectCustomerDue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomerId || Number(payAmount) <= 0) return;
    setPaySubmitting(true);
    setErrorMsg('');
    try {
      await apiFetch('/api/dues/pay', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: selectedCustomerId,
          amount: Number(payAmount),
          payment_method: payMethod,
          note: payNote,
        }),
      });
      setFeedbackMsg(lang === 'bn' ? 'সফলভাবে বকেয়া টাকা জমা করা হয়েছে!' : 'Due payment collected successfully!');
      setPayModalOpen(false);
      setPayAmount('');
      setPayNote('');
      await Promise.all([loadCustomerLedger(selectedCustomerId), onRefresh()]);
      setTimeout(() => setFeedbackMsg(''), 2500);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setPaySubmitting(false);
    }
  };

  // Handle Supplier Payment Settle
  const handleSettleSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplierId || Number(supPayAmount) <= 0) return;
    try {
      await apiFetch(`/api/suppliers/${selectedSupplierId}/pay`, {
        method: 'POST',
        body: JSON.stringify({ amount: Number(supPayAmount) }),
      });
      setSupPayModalOpen(false);
      setSupPayAmount('');
      await Promise.all([loadSupplierLedger(selectedSupplierId), loadSuppliers()]);
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  // Compute Customer Chronological Ledger entries
  const customerLedgerEntries = useMemo(() => {
    if (!custLedgerData) return [];
    const entries: Array<{
      date: string;
      type: 'DEBIT' | 'CREDIT';
      particulars: string;
      reference: string;
      debit: number;
      credit: number;
      timestamp: number;
      method?: string;
    }> = [];

    // Sales (Debit to customer account)
    for (const s of custLedgerData.sales || []) {
      entries.push({
        date: s.created_at,
        type: 'DEBIT',
        particulars: lang === 'bn' ? `পণ্য বিক্রয় চালান (${s.payment_method})` : `Sales Invoice (${s.payment_method})`,
        reference: s.invoice_no,
        debit: Number(s.total),
        credit: Number(s.paid_amount), // Paid at time of sale
        timestamp: new Date(s.created_at).getTime(),
        method: s.payment_method,
      });
    }

    // Direct Due Payments (Credit)
    for (const p of custLedgerData.payments || []) {
      entries.push({
        date: p.created_at,
        type: 'CREDIT',
        particulars: lang === 'bn' ? `বকেয়া কিস্তি জমা (${p.payment_method})` : `Due Installment Paid (${p.payment_method})`,
        reference: p.receipt_no,
        debit: 0,
        credit: Number(p.amount),
        timestamp: new Date(p.created_at).getTime(),
        method: p.payment_method,
      });
    }

    // Sort ascending by date to calculate running balance
    entries.sort((a, b) => a.timestamp - b.timestamp);

    let runningBalance = 0;
    const computed: LedgerEntry[] = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      // Balance changes by (Debit - Credit)
      runningBalance += e.debit - e.credit;
      computed.push({
        id: `entry-${i}`,
        date: e.date,
        type: e.type,
        particulars: e.particulars,
        reference: e.reference,
        debit: e.debit,
        credit: e.credit,
        balance: Math.max(0, runningBalance),
        method: e.method,
      });
    }

    // Return descending for display
    return computed.reverse();
  }, [custLedgerData, lang]);

  // Compute Supplier Chronological Ledger entries
  const supplierLedgerEntries = useMemo(() => {
    if (!supLedgerData) return [];
    const entries: Array<{
      date: string;
      particulars: string;
      reference: string;
      payable: number;
      paid: number;
      due: number;
      timestamp: number;
    }> = [];

    for (const p of supLedgerData.purchases || []) {
      entries.push({
        date: p.created_at,
        particulars: lang === 'bn' ? 'মালামাল ক্রয় চালান' : 'Purchase Invoice',
        reference: p.invoice_no,
        payable: Number(p.total),
        paid: Number(p.paid_amount),
        due: Number(p.due_amount),
        timestamp: new Date(p.created_at).getTime(),
      });
    }

    entries.sort((a, b) => b.timestamp - a.timestamp);
    return entries;
  }, [supLedgerData, lang]);

  // Compute Daily Cash Book Entries
  const cashBookData = useMemo(() => {
    const fromTime = new Date(`${cashFrom}T00:00:00`).getTime();
    const toTime = new Date(`${cashTo}T23:59:59`).getTime();

    // Inflows (Cash Sales + Due Payments)
    let totalCashSales = 0;
    let totalDueCollected = 0;
    const inflows: Array<{ time: string; desc: string; ref: string; amount: number; method: string }> = [];

    for (const s of sales) {
      const t = new Date(s.created_at).getTime();
      if (t >= fromTime && t <= toTime) {
        if (s.paid_amount > 0 && s.status !== 'CANCELLED') {
          totalCashSales += s.paid_amount;
          inflows.push({
            time: s.created_at,
            desc: lang === 'bn' ? `বিক্রয় রসিদ (${s.customer_name})` : `Sale Receipt (${s.customer_name})`,
            ref: s.invoice_no,
            amount: s.paid_amount,
            method: s.payment_method,
          });
        }
      }
    }

    for (const dp of duePaymentsAll) {
      const t = new Date(dp.created_at).getTime();
      if (t >= fromTime && t <= toTime) {
        totalDueCollected += dp.amount;
        inflows.push({
          time: dp.created_at,
          desc: lang === 'bn' ? `বাকি আদায় (${dp.customer_name})` : `Due Collection (${dp.customer_name})`,
          ref: dp.receipt_no,
          amount: dp.amount,
          method: dp.payment_method,
        });
      }
    }

    // Outflows (Expenses)
    let totalExpenses = 0;
    const outflows: Array<{ time: string; desc: string; category: string; amount: number; method: string }> = [];

    for (const ex of cashExpenses) {
      const t = new Date(ex.created_at).getTime();
      if (t >= fromTime && t <= toTime) {
        totalExpenses += ex.amount;
        outflows.push({
          time: ex.created_at,
          desc: ex.title,
          category: ex.category,
          amount: ex.amount,
          method: ex.payment_method,
        });
      }
    }

    const totalCashIn = totalCashSales + totalDueCollected;
    const totalCashOut = totalExpenses;
    const netCash = totalCashIn - totalCashOut;

    return {
      totalCashIn,
      totalCashOut,
      netCash,
      inflows: inflows.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()),
      outflows: outflows.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()),
    };
  }, [sales, duePaymentsAll, cashExpenses, cashFrom, cashTo, lang]);

  // Filtered customer list for sidebar/dropdown
  const filteredCustomers = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
      (c.phone && c.phone.includes(customerSearch))
  );

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800 flex items-center justify-center text-teal-700 dark:text-teal-400">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-display font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2">
                <span>{lang === 'bn' ? 'লেজার ও খাতা খতিয়ান' : 'General Ledger & Accounts Book'}</span>
                <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-teal-100 text-teal-800 dark:bg-teal-950/70 dark:text-teal-300">
                  Double-Entry
                </span>
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {lang === 'bn'
                  ? 'কাস্টমারের বাকি ও কেনাকাটার হিসাব, সরবরাহকারীর প্রদেয় বিল এবং দোকানের দৈনিক জমা-খরচের পূর্ণাঙ্গ খতিয়ান।'
                  : 'Customer statements, supplier payables, and daily cash-in / cash-out bookkeeping.'}
              </p>
            </div>
          </div>

          {/* Sub-tab Navigation */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setActiveSubTab('customer')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeSubTab === 'customer'
                  ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>{lang === 'bn' ? 'কাস্টমার খাতা' : 'Customer Ledger'}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSubTab('supplier')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeSubTab === 'supplier'
                  ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>{lang === 'bn' ? 'সরবরাহকারী খাতা' : 'Supplier Ledger'}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSubTab('cash')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeSubTab === 'cash'
                  ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <Wallet className="w-3.5 h-3.5" />
              <span>{lang === 'bn' ? 'দৈনিক ক্যাশ লেজার' : 'Daily Cash Book'}</span>
            </button>
          </div>
        </div>
      </div>

      {feedbackMsg && (
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 p-3 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedbackMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 p-3 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* ============================================================== */}
      {/* 1. CUSTOMER LEDGER (কাস্টমার খাতা)                             */}
      {/* ============================================================== */}
      {activeSubTab === 'customer' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Customer Selection Sidebar */}
          <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-col h-[680px]">
            <div className="space-y-3 pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <span className="font-display font-semibold text-xs text-slate-700 dark:text-slate-300">
                  {lang === 'bn' ? 'কাস্টমার নির্বাচন করুন' : 'Select Customer'}
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  {filteredCustomers.length} {lang === 'bn' ? 'জন' : 'found'}
                </span>
              </div>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder={lang === 'bn' ? 'নাম বা মোবাইল নম্বর লিখুন...' : 'Search customer...'}
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60 mt-2 pr-1">
              {filteredCustomers.map((c) => {
                const isSelected = selectedCustomerId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedCustomerId(c.id)}
                    className={`w-full text-left p-2.5 rounded-xl transition-all flex items-center justify-between gap-2 mt-1 ${
                      isSelected
                        ? 'bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-xs text-slate-900 dark:text-white truncate">{c.name}</div>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">{c.phone || 'No Phone'}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div
                        className={`font-mono text-xs font-bold ${
                          c.total_due > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'
                        }`}
                      >
                        {formatBDT(c.total_due)}
                      </div>
                      <div className="text-[10px] text-slate-400">{lang === 'bn' ? 'বাকি' : 'Due'}</div>
                    </div>
                  </button>
                );
              })}
              {filteredCustomers.length === 0 && (
                <div className="text-center text-xs text-slate-400 py-8">
                  {lang === 'bn' ? 'কোন কাস্টমার পাওয়া যায়নি।' : 'No customers matched.'}
                </div>
              )}
            </div>
          </div>

          {/* Customer Ledger Statement Sheet */}
          <div className="lg:col-span-8 space-y-4">
            {custLedgerData?.customer ? (
              <>
                {/* Customer Account Summary Header */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="font-display font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
                        <span>{custLedgerData.customer.name}</span>
                        {custLedgerData.customer.code && (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                            ID: {custLedgerData.customer.code}
                          </span>
                        )}
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {custLedgerData.customer.phone} · {custLedgerData.customer.address || (lang === 'bn' ? 'ঠিকানা নেই' : 'No address')}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {custLedgerData.customer.total_due > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setPayAmount(String(custLedgerData.customer.total_due));
                            setPayModalOpen(true);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold shadow-sm transition-colors"
                        >
                          <CreditCard className="w-3.5 h-3.5" />
                          <span>{lang === 'bn' ? 'বাকি জমা করুন' : 'Collect Payment'}</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => window.print()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>{lang === 'bn' ? 'স্টেটমেন্ট প্রিন্ট' : 'Print Statement'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Summary Metric Badges */}
                  <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800">
                      <div className="text-[11px] text-slate-500">{lang === 'bn' ? 'মোট কেনাকাটা (ডেবিট)' : 'Total Purchases (Debit)'}</div>
                      <div className="font-mono font-bold text-sm text-slate-900 dark:text-white mt-1 tabular-nums">
                        {formatBDT(custLedgerData.customer.total_spent || custLedgerData.sales.reduce((s, it) => s + it.total, 0))}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-800">
                      <div className="text-[11px] text-emerald-700 dark:text-emerald-300">{lang === 'bn' ? 'মোট পরিশোধ (ক্রেডিট)' : 'Total Paid (Credit)'}</div>
                      <div className="font-mono font-bold text-sm text-emerald-700 dark:text-emerald-300 mt-1 tabular-nums">
                        {formatBDT(
                          (custLedgerData.sales.reduce((s, it) => s + it.paid_amount, 0)) +
                            (custLedgerData.payments.reduce((s, it) => s + it.amount, 0))
                        )}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-amber-50/60 dark:bg-amber-950/40 border border-amber-200/60 dark:border-amber-800">
                      <div className="text-[11px] text-amber-700 dark:text-amber-300">{lang === 'bn' ? 'বর্তমান বকেয়া (ব্যালেন্স)' : 'Current Balance Due'}</div>
                      <div className="font-mono font-bold text-sm text-amber-700 dark:text-amber-300 mt-1 tabular-nums">
                        {formatBDT(custLedgerData.customer.total_due)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Ledger Transactions Table */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
                  <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <span className="font-display font-semibold text-xs text-slate-900 dark:text-white">
                      {lang === 'bn' ? 'খতিয়ান বিবরণী (লেজার ট্রানজেকশন)' : 'Ledger Account Statement'}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {customerLedgerEntries.length} {lang === 'bn' ? 'টি এন্ট্রি' : 'transactions'}
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                        <tr>
                          <th className="py-2.5 px-4">{lang === 'bn' ? 'তারিখ ও সময়' : 'Date & Time'}</th>
                          <th className="py-2.5 px-3">{lang === 'bn' ? 'বিবরণ' : 'Particulars'}</th>
                          <th className="py-2.5 px-3">{lang === 'bn' ? 'রেফারেন্স' : 'Ref #'}</th>
                          <th className="py-2.5 px-3 text-right">{lang === 'bn' ? 'ডেবিট (বিক্রয়)' : 'Debit (৳)'}</th>
                          <th className="py-2.5 px-3 text-right">{lang === 'bn' ? 'ক্রেডিট (জমা)' : 'Credit (৳)'}</th>
                          <th className="py-2.5 px-4 text-right">{lang === 'bn' ? 'ব্যালেন্স (বাকি)' : 'Balance (৳)'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                        {customerLedgerEntries.map((row) => (
                          <tr key={row.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                            <td className="py-2.5 px-4 font-mono text-[11px] text-slate-600 dark:text-slate-400 whitespace-nowrap">
                              {String(row.date).slice(0, 16)}
                            </td>
                            <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-white">
                              {row.particulars}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-[11px] text-teal-700 dark:text-teal-400">
                              {row.reference}
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
                        {customerLedgerEntries.length === 0 && (
                          <tr>
                            <td colSpan={6} className="text-center py-8 text-xs text-slate-400">
                              {lang === 'bn' ? 'এই কাস্টমারের কোনো লেজার রেকর্ড পাওয়া যায়নি।' : 'No transaction records found.'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center text-xs text-slate-400">
                {custLoading
                  ? lang === 'bn' ? 'লেজার লোড হচ্ছে...' : 'Loading ledger...'
                  : lang === 'bn' ? 'অনুগ্রহ করে বাম পাশ থেকে একজন কাস্টমার নির্বাচন করুন।' : 'Select a customer from the left to view ledger.'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 2. SUPPLIER LEDGER (সরবরাহকারী খাতা)                           */}
      {/* ============================================================== */}
      {activeSubTab === 'supplier' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Supplier Selection Sidebar */}
          <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-col h-[680px]">
            <div className="pb-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <span className="font-display font-semibold text-xs text-slate-700 dark:text-slate-300">
                {lang === 'bn' ? 'সরবরাহকারী নির্বাচন' : 'Suppliers Directory'}
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                {suppliers.length} {lang === 'bn' ? 'জন' : 'suppliers'}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60 mt-2 pr-1">
              {suppliers.map((s) => {
                const isSelected = selectedSupplierId === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelectedSupplierId(s.id)}
                    className={`w-full text-left p-2.5 rounded-xl transition-all flex items-center justify-between gap-2 mt-1 ${
                      isSelected
                        ? 'bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-xs text-slate-900 dark:text-white truncate">{s.name}</div>
                      <div className="text-[11px] text-slate-500 truncate">{s.company} · {s.phone}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div
                        className={`font-mono text-xs font-bold ${
                          s.total_due > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'
                        }`}
                      >
                        {formatBDT(s.total_due)}
                      </div>
                      <div className="text-[10px] text-slate-400">{lang === 'bn' ? 'পাওনা' : 'Payable'}</div>
                    </div>
                  </button>
                );
              })}
              {suppliers.length === 0 && (
                <div className="text-center text-xs text-slate-400 py-8">
                  {lang === 'bn' ? 'কোন সরবরাহকারী পাওয়া যায়নি।' : 'No suppliers registered.'}
                </div>
              )}
            </div>
          </div>

          {/* Supplier Ledger Statement Sheet */}
          <div className="lg:col-span-8 space-y-4">
            {supLedgerData?.supplier ? (
              <>
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="font-display font-bold text-base text-slate-900 dark:text-white">
                        {supLedgerData.supplier.name} ({supLedgerData.supplier.company})
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {supLedgerData.supplier.phone} · {supLedgerData.supplier.address || (lang === 'bn' ? 'ঠিকানা নেই' : 'No address')}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {supLedgerData.supplier.total_due > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setSupPayAmount(String(supLedgerData.supplier.total_due));
                            setSupPayModalOpen(true);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold shadow-sm transition-colors"
                        >
                          <CreditCard className="w-3.5 h-3.5" />
                          <span>{lang === 'bn' ? 'পেমেন্ট পরিশোধ' : 'Settle Due'}</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => window.print()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>{lang === 'bn' ? 'প্রিন্ট' : 'Print'}</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/60 dark:border-slate-800">
                      <div className="text-[11px] text-slate-500">{lang === 'bn' ? 'মোট ক্রয় (বিল)' : 'Total Purchases'}</div>
                      <div className="font-mono font-bold text-sm text-slate-900 dark:text-white mt-1 tabular-nums">
                        {formatBDT(supLedgerData.purchases.reduce((s, it) => s + it.total, 0))}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-800">
                      <div className="text-[11px] text-emerald-700 dark:text-emerald-300">{lang === 'bn' ? 'মোট পরিশোধ' : 'Total Paid'}</div>
                      <div className="font-mono font-bold text-sm text-emerald-700 dark:text-emerald-300 mt-1 tabular-nums">
                        {formatBDT(supLedgerData.purchases.reduce((s, it) => s + it.paid_amount, 0))}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-amber-50/60 dark:bg-amber-950/40 border border-amber-200/60 dark:border-amber-800">
                      <div className="text-[11px] text-amber-700 dark:text-amber-300">{lang === 'bn' ? 'বর্তমান প্রদেয় (বাকি)' : 'Payable Due'}</div>
                      <div className="font-mono font-bold text-sm text-amber-700 dark:text-amber-300 mt-1 tabular-nums">
                        {formatBDT(supLedgerData.supplier.total_due)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
                  <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <span className="font-display font-semibold text-xs text-slate-900 dark:text-white">
                      {lang === 'bn' ? 'ক্রয় চালান ও পরিশোধ তালিকা' : 'Purchases & Payment Logs'}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {supplierLedgerEntries.length} {lang === 'bn' ? 'টি চালান' : 'invoices'}
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                        <tr>
                          <th className="py-2.5 px-4">{lang === 'bn' ? 'তারিখ' : 'Date'}</th>
                          <th className="py-2.5 px-3">{lang === 'bn' ? 'চালান নং' : 'Invoice #'}</th>
                          <th className="py-2.5 px-3 text-right">{lang === 'bn' ? 'মোট বিল' : 'Total Bill'}</th>
                          <th className="py-2.5 px-3 text-right">{lang === 'bn' ? 'পরিশোধ' : 'Paid'}</th>
                          <th className="py-2.5 px-4 text-right">{lang === 'bn' ? 'বাকি' : 'Due'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                        {supplierLedgerEntries.map((row, i) => (
                          <tr key={i} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                            <td className="py-2.5 px-4 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                              {String(row.date).slice(0, 10)}
                            </td>
                            <td className="py-2.5 px-3 font-mono font-medium text-teal-700 dark:text-teal-400">
                              {row.reference}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                              {formatBDT(row.payable)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                              {formatBDT(row.paid)}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-amber-600 dark:text-amber-400">
                              {formatBDT(row.due)}
                            </td>
                          </tr>
                        ))}
                        {supplierLedgerEntries.length === 0 && (
                          <tr>
                            <td colSpan={5} className="text-center py-8 text-xs text-slate-400">
                              {lang === 'bn' ? 'এই সরবরাহকারীর কোনো ক্রয় চালান পাওয়া যায়নি।' : 'No purchase records found.'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center text-xs text-slate-400">
                {supLoading
                  ? lang === 'bn' ? 'লোড হচ্ছে...' : 'Loading...'
                  : lang === 'bn' ? 'অনুগ্রহ করে বাম পাশ থেকে একজন সরবরাহকারী নির্বাচন করুন।' : 'Select a supplier from the left to view ledger.'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 3. DAILY CASH BOOK (দৈনিক ক্যাশ ও জমা-খরচ লেজার)                */}
      {/* ============================================================== */}
      {activeSubTab === 'cash' && (
        <div className="space-y-5">
          {/* Date Filter & Export Row */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-sm no-print">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500">{lang === 'bn' ? 'সময়কাল:' : 'Date Range:'}</span>
              <input
                type="date"
                value={cashFrom}
                onChange={(e) => setCashFrom(e.target.value)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono"
              />
              <span className="text-slate-400">{lang === 'bn' ? 'থেকে' : 'to'}</span>
              <input
                type="date"
                value={cashTo}
                onChange={(e) => setCashTo(e.target.value)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const today = new Date().toISOString().slice(0, 10);
                  setCashFrom(today);
                  setCashTo(today);
                }}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs"
              >
                {lang === 'bn' ? 'আজ' : 'Today'}
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-700 text-white text-xs font-semibold shadow-sm"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>{lang === 'bn' ? 'ক্যাশ শিট প্রিন্ট' : 'Print Cash Sheet'}</span>
              </button>
            </div>
          </div>

          {/* Cash In / Out Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 font-medium">
                  {lang === 'bn' ? 'মোট নগদ জমা (Cash In)' : 'Total Cash Inflow'}
                </span>
                <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center">
                  <ArrowDownLeft className="w-4 h-4" />
                </div>
              </div>
              <div className="font-mono font-bold text-xl text-emerald-600 dark:text-emerald-400 mt-2 tabular-nums">
                {formatBDT(cashBookData.totalCashIn)}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {lang === 'bn' ? 'বিক্রয় রসিদ + বাকি আদায়' : 'Sales receipts + dues collected'}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 font-medium">
                  {lang === 'bn' ? 'মোট নগদ খরচ (Cash Out)' : 'Total Cash Outflow'}
                </span>
                <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-950/60 text-red-600 flex items-center justify-center">
                  <ArrowUpRight className="w-4 h-4" />
                </div>
              </div>
              <div className="font-mono font-bold text-xl text-red-600 dark:text-red-400 mt-2 tabular-nums">
                {formatBDT(cashBookData.totalCashOut)}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {lang === 'bn' ? 'দোকানের বিবিধ খরচ' : 'Business operating expenses'}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 font-medium">
                  {lang === 'bn' ? 'নিট ক্যাশ ব্যালেন্স (Net Cash)' : 'Net Cash in Hand'}
                </span>
                <div className="w-8 h-8 rounded-lg bg-teal-100 dark:bg-teal-950/60 text-teal-600 flex items-center justify-center">
                  <Wallet className="w-4 h-4" />
                </div>
              </div>
              <div
                className={`font-mono font-bold text-xl mt-2 tabular-nums ${
                  cashBookData.netCash >= 0 ? 'text-teal-700 dark:text-teal-400' : 'text-red-600'
                }`}
              >
                {formatBDT(cashBookData.netCash)}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {lang === 'bn' ? 'নগদ জমা হতে খরচ বাদ দিয়ে' : 'Inflow minus outflow balance'}
              </div>
            </div>
          </div>

          {/* Breakdown Tables Side by Side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Inflows Table */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
              <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-emerald-50/40 dark:bg-emerald-950/20">
                <span className="font-display font-semibold text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                  <ArrowDownLeft className="w-3.5 h-3.5" />
                  {lang === 'bn' ? 'জমা তালিকা (Cash In)' : 'Cash Inflow Receipts'}
                </span>
                <span className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400">
                  {cashBookData.inflows.length} {lang === 'bn' ? 'টি' : 'items'}
                </span>
              </div>
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {cashBookData.inflows.map((it, i) => (
                      <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-4">
                          <div className="font-medium text-slate-900 dark:text-white">{it.desc}</div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            {String(it.time).slice(11, 16)} · {it.ref} ({it.method})
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-emerald-600 tabular-nums">
                          +{formatBDT(it.amount)}
                        </td>
                      </tr>
                    ))}
                    {cashBookData.inflows.length === 0 && (
                      <tr>
                        <td colSpan={2} className="text-center py-8 text-xs text-slate-400">
                          {lang === 'bn' ? 'নির্বাচিত দিনে কোনো নগদ জমা হয়নি।' : 'No cash inflows.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Outflows Table */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
              <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-red-50/40 dark:bg-red-950/20">
                <span className="font-display font-semibold text-xs text-red-800 dark:text-red-300 flex items-center gap-1.5">
                  <ArrowUpRight className="w-3.5 h-3.5" />
                  {lang === 'bn' ? 'খরচ তালিকা (Cash Out)' : 'Cash Outflow Expenses'}
                </span>
                <span className="text-[11px] font-mono text-red-700 dark:text-red-400">
                  {cashBookData.outflows.length} {lang === 'bn' ? 'টি' : 'items'}
                </span>
              </div>
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {cashBookData.outflows.map((it, i) => (
                      <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-4">
                          <div className="font-medium text-slate-900 dark:text-white">{it.desc}</div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            {String(it.time).slice(11, 16)} · {it.category} ({it.method})
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-red-600 tabular-nums">
                          -{formatBDT(it.amount)}
                        </td>
                      </tr>
                    ))}
                    {cashBookData.outflows.length === 0 && (
                      <tr>
                        <td colSpan={2} className="text-center py-8 text-xs text-slate-400">
                          {lang === 'bn' ? 'নির্বাচিত দিনে কোনো খরচ এন্ট্রি নেই।' : 'No expenses recorded.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Collect Payment Modal */}
      {payModalOpen && custLedgerData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form
            onSubmit={handleCollectCustomerDue}
            className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="font-display font-bold text-sm text-slate-900 dark:text-white">
                {lang === 'bn' ? 'বকেয়া টাকা জমা গ্রহণ' : 'Collect Customer Due'}
              </h3>
              <button
                type="button"
                onClick={() => setPayModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 text-xs text-amber-800 dark:text-amber-300">
              {lang === 'bn'
                ? `কাস্টমার ${custLedgerData.customer.name}-এর বর্তমান মোট বাকি: ${formatBDT(custLedgerData.customer.total_due)}`
                : `Current balance due for ${custLedgerData.customer.name}: ${formatBDT(custLedgerData.customer.total_due)}`}
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">
                  {lang === 'bn' ? 'জমা পরিমাণ (৳)' : 'Payment Amount (৳)'}
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  max={custLedgerData.customer.total_due}
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono font-bold text-base focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">
                  {lang === 'bn' ? 'পেমেন্ট মাধ্যম' : 'Payment Method'}
                </label>
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                >
                  <option value="CASH">{lang === 'bn' ? 'নগদ ক্যাশ (CASH)' : 'Cash'}</option>
                  <option value="BKASH">bKash</option>
                  <option value="NAGAD">Nagad</option>
                  <option value="ROCKET">Rocket</option>
                  <option value="CARD">{lang === 'bn' ? 'ব্যাংক কার্ড' : 'Card'}</option>
                </select>
              </div>

              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">
                  {lang === 'bn' ? 'নোট / মন্তব্য' : 'Payment Note'}
                </label>
                <input
                  type="text"
                  placeholder={lang === 'bn' ? 'যেমন: কিস্তি ১ পরিশোধ' : 'Optional note'}
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setPayModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold"
              >
                {lang === 'bn' ? 'বাতিল' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={paySubmitting || Number(payAmount) <= 0}
                className="px-5 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold disabled:opacity-50"
              >
                {paySubmitting ? (lang === 'bn' ? 'জমা হচ্ছে...' : 'Saving...') : (lang === 'bn' ? 'জমা নিশ্চিত করুন' : 'Confirm Payment')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Supplier Settle Modal */}
      {supPayModalOpen && supLedgerData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form
            onSubmit={handleSettleSupplier}
            className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="font-display font-bold text-sm text-slate-900 dark:text-white">
                {lang === 'bn' ? 'সরবরাহকারী বিল পরিশোধ' : 'Settle Supplier Due'}
              </h3>
              <button
                type="button"
                onClick={() => setSupPayModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 text-xs text-amber-800 dark:text-amber-300">
              {lang === 'bn'
                ? `সরবরাহকারী ${supLedgerData.supplier.name}-এর পাওনা: ${formatBDT(supLedgerData.supplier.total_due)}`
                : `Total payable due: ${formatBDT(supLedgerData.supplier.total_due)}`}
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-600 dark:text-slate-400 block mb-1">
                  {lang === 'bn' ? 'পরিশোধ পরিমাণ (৳)' : 'Pay Amount (৳)'}
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  max={supLedgerData.supplier.total_due}
                  value={supPayAmount}
                  onChange={(e) => setSupPayAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono font-bold text-base focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setSupPayModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold"
              >
                {lang === 'bn' ? 'বাতিল' : 'Cancel'}
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold"
              >
                {lang === 'bn' ? 'পরিশোধ নিশ্চিত করুন' : 'Confirm Payment'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
